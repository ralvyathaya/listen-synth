/* audio.js — the LISTEN synthesizer engine (Web Audio API).

   Signal chain:
     oscA + oscB + sub ──> filter (lowpass) ──> vca (ADSR) ──> dry ─┬─> analyser ─> destination
                                                                    ├─> delay ─> feedback ─┐
                                                                    └─> convolver (reverb) ┘

   The star: analyzeSound() runs FFT + time-domain reads on the live
   AnalyserNode and returns STRUCTURED AUDIO FEATURES — this is what lets
   the agent literally hear what the synth is doing. */
(function () {
  let ctx = null;
  let master, analyser, oscA, oscB, sub, filter, vca;
  let delay, delayFeedback, delayMix, convolver, reverbMix, dry;
  let lfo, lfoGainCutoff, lfoGainPitchA, lfoGainPitchB;
  let noiseBuffer = null, impulseBuffer = null;

  /* The single source of truth for the patch — human UI and WebMCP tools
     both read/write this. (Shared context = the whole point.) */
  const patch = {
    oscA: { wave: "sawtooth", octave: 0, detune: 0, level: 0.8 },
    oscB: { wave: "square", octave: 0, detune: 7, level: 0.5 },
    sub:  { level: 0.0 },
    filter: { cutoff: 4000, resonance: 1.0, envAmount: 2000 },
    env: { attack: 0.01, decay: 0.25, sustain: 0.6, release: 0.4 },
    lfo: { wave: "sine", rate: 1.5, toCutoff: 0, toPitch: 0 },
    fx: { delayTime: 0.28, delayFeedback: 0.3, delayMix: 0.0, reverbMix: 0.0 },
    master: 0.8,
  };

  const activeNotes = new Map(); // midi -> { stop() }
  const listeners = new Set();

  function now() { return ctx.currentTime; }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function emit(topic) {
    listeners.forEach((fn) => { try { fn(topic, patch); } catch (e) { console.error(e); } });
  }

  /* ---------------- init ---------------- */
  function ensureCtx() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain(); master.gain.value = patch.master;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.82;

    dry = ctx.createGain(); dry.gain.value = 1;

    // voice chain
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = patch.filter.cutoff;
    filter.Q.value = patch.filter.resonance;

    vca = ctx.createGain(); vca.gain.value = 0;

    // fx
    delay = ctx.createDelay(2.0); delay.delayTime.value = patch.fx.delayTime;
    delayFeedback = ctx.createGain(); delayFeedback.gain.value = patch.fx.delayFeedback;
    delayMix = ctx.createGain(); delayMix.gain.value = patch.fx.delayMix;

    convolver = ctx.createConvolver();
    reverbMix = ctx.createGain(); reverbMix.gain.value = patch.fx.reverbMix;
    impulseBuffer = buildImpulse(2.2, 3.2);
    convolver.buffer = impulseBuffer;

    // route: vca -> filter? no — standard: oscs -> filter -> vca -> {dry, delay, reverb}
    filter.connect(vca);
    vca.connect(dry); dry.connect(master);
    vca.connect(delay); delay.connect(delayFeedback); delayFeedback.connect(delay);
    delay.connect(delayMix); delayMix.connect(master);
    vca.connect(convolver); convolver.connect(reverbMix); reverbMix.connect(master);

    master.connect(analyser);
    analyser.connect(ctx.destination);

    // persistent oscillators (freerunning; we gate with vca)
    oscA = ctx.createOscillator(); oscB = ctx.createOscillator(); sub = ctx.createOscillator();
    const oscAGain = ctx.createGain(), oscBGain = ctx.createGain(), subGain = ctx.createGain();
    oscA.type = patch.oscA.wave; oscB.type = patch.oscB.wave; sub.type = "sine";
    oscAGain.gain.value = patch.oscA.level; oscBGain.gain.value = patch.oscB.level; subGain.gain.value = patch.sub.level;
    oscA.detune.value = patch.oscA.detune; oscB.detune.value = patch.oscB.detune;
    sub.frequency.value = 55;
    oscA.connect(oscAGain).connect(filter);
    oscB.connect(oscBGain).connect(filter);
    sub.connect(subGain).connect(filter);
    oscA.start(); oscB.start(); sub.start();

    // store gains for live param changes
    patch._gains = { oscAGain, oscBGain, subGain };

    // LFO
    lfo = ctx.createOscillator(); lfo.type = patch.lfo.wave; lfo.frequency.value = patch.lfo.rate;
    lfoGainCutoff = ctx.createGain(); lfoGainCutoff.gain.value = patch.lfo.toCutoff;
    lfoGainPitchA = ctx.createGain(); lfoGainPitchA.gain.value = patch.lfo.toPitch;
    lfoGainPitchB = ctx.createGain(); lfoGainPitchB.gain.value = patch.lfo.toPitch;
    lfo.connect(lfoGainCutoff).connect(filter.frequency);
    lfo.connect(lfoGainPitchA).connect(oscA.detune);
    lfo.connect(lfoGainPitchB).connect(oscB.detune);
    lfo.start();

    noiseBuffer = buildNoise();
    return true;
  }

  function buildImpulse(seconds, decay) {
    const rate = ctx.sampleRate, len = rate * seconds;
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function buildNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ---------------- param change tracking (for watch mode + diffs) ---------------- */
  const paramHistory = []; // { path, from, to, at, source }
  const MAX_HISTORY = 80;
  let lastApplySource = "unknown"; // "human" | "agent" — set by the caller layer

  function setApplySource(src) { lastApplySource = src; }

  function getParamValue(path) {
    const parts = path.split(".");
    let obj = patch;
    for (const k of parts) { if (obj == null) return undefined; obj = obj[k]; }
    return obj;
  }

  function recordParamChange(path, from, to) {
    paramHistory.push({ path, from, to, at: Date.now(), source: lastApplySource });
    if (paramHistory.length > MAX_HISTORY) paramHistory.shift();
    emit("paramchange");
  }

  function drainParamChanges(sinceMs = 0) {
    const out = paramHistory.filter((h) => h.at >= sinceMs);
    return out;
  }

  /* ---------------- param application (used by UI + tools) ---------------- */
  function applyParam(path, value) {
    // NOTE: do NOT auto-create the AudioContext here — it would fire autoplay
    // warnings on page load (before a user gesture). Instead, update the patch
    // state; the audio graph is built on first note/Enable-audio, and reads
    // current patch values then. Once ctx exists, we also ramp live params.
    const ctxReady = !!ctx;
    const set = (obj, key, v) => { obj[key] = v; };
    const p = patch;
    const ramp = (param, v, t = 0.02) => { if (ctxReady && param) param.setTargetAtTime(v, now(), t); };
    const before = getParamValue(path);

    switch (path) {
      case "oscA.wave": oscA.type = value; set(p.oscA, "wave", value); break;
      case "oscA.octave": set(p.oscA, "octave", value); retuneAll(); break;
      case "oscA.detune": ramp(oscA.detune, value); set(p.oscA, "detune", value); break;
      case "oscA.level": ramp(p._gains.oscAGain.gain, value); set(p.oscA, "level", value); break;

      case "oscB.wave": oscB.type = value; set(p.oscB, "wave", value); break;
      case "oscB.octave": set(p.oscB, "octave", value); retuneAll(); break;
      case "oscB.detune": ramp(oscB.detune, value); set(p.oscB, "detune", value); break;
      case "oscB.level": ramp(p._gains.oscBGain.gain, value); set(p.oscB, "level", value); break;

      case "sub.level": ramp(p._gains.subGain.gain, value); set(p.sub, "level", value); break;

      case "filter.cutoff": ramp(filter.frequency, value); set(p.filter, "cutoff", value); break;
      case "filter.resonance": ramp(filter.Q, value); set(p.filter, "resonance", value); break;
      case "filter.envAmount": set(p.filter, "envAmount", value); break;

      case "env.attack": set(p.env, "attack", value); break;
      case "env.decay": set(p.env, "decay", value); break;
      case "env.sustain": set(p.env, "sustain", value); break;
      case "env.release": set(p.env, "release", value); break;

      case "lfo.wave": lfo.type = value; set(p.lfo, "wave", value); break;
      case "lfo.rate": ramp(lfo.frequency, value); set(p.lfo, "rate", value); break;
      case "lfo.toCutoff": ramp(lfoGainCutoff.gain, value); set(p.lfo, "toCutoff", value); break;
      case "lfo.toPitch": ramp(lfoGainPitchA.gain, value); ramp(lfoGainPitchB.gain, value); set(p.lfo, "toPitch", value); break;

      case "fx.delayTime": ramp(delay.delayTime, value, 0.05); set(p.fx, "delayTime", value); break;
      case "fx.delayFeedback": ramp(delayFeedback.gain, value); set(p.fx, "delayFeedback", value); break;
      case "fx.delayMix": ramp(delayMix.gain, value); set(p.fx, "delayMix", value); break;
      case "fx.reverbMix": ramp(reverbMix.gain, value); set(p.fx, "reverbMix", value); break;

      case "master": ramp(master.gain, value); set(p, "master", value); break;
      default: throw new Error(`Unknown param "${path}"`);
    }
    recordParamChange(path, before, value);
    emit("patch");
  }

  function applyMany(entries) {
    const applied = [];
    for (const [path, value] of Object.entries(entries)) {
      try { applyParam(path, value); applied.push(path); } catch (e) { /* skip unknown */ }
    }
    return applied;
  }

  /* ---------------- notes ---------------- */
  let currentMidi = null;
  function retuneAll() {
    if (currentMidi == null) return;
    const f = midiToFreq(currentMidi);
    oscA.frequency.setTargetAtTime(f * Math.pow(2, patch.oscA.octave), now(), 0.005);
    oscB.frequency.setTargetAtTime(f * Math.pow(2, patch.oscB.octave), now(), 0.005);
    sub.frequency.setTargetAtTime(f / 2, now(), 0.005);
  }

  function noteOn(midi, velocity = 0.9) {
    if (!ensureCtx()) return false;
    if (ctx.state === "suspended") ctx.resume();
    const t = now();
    currentMidi = midi;
    retuneAll();

    // ADSR in
    const g = vca.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    const peak = velocity * 0.9;
    g.linearRampToValueAtTime(peak, t + Math.max(0.001, patch.env.attack));
    g.linearRampToValueAtTime(peak * patch.env.sustain, t + patch.env.attack + patch.env.decay);

    // filter envelope
    const fe = filter.frequency;
    fe.cancelScheduledValues(t);
    fe.setValueAtTime(Math.max(40, patch.filter.cutoff), t);
    fe.linearRampToValueAtTime(Math.min(16000, patch.filter.cutoff + patch.filter.envAmount), t + patch.env.attack);
    fe.linearRampToValueAtTime(Math.max(60, patch.filter.cutoff + patch.filter.envAmount * patch.env.sustain), t + patch.env.attack + patch.env.decay);

    activeNotes.set(midi, { startedAt: t });
    emit("noteon");
    return true;
  }

  function noteOff(midi) {
    if (!ctx || !activeNotes.has(midi)) return;
    const t = now();
    const g = vca.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + Math.max(0.01, patch.env.release));
    activeNotes.delete(midi);
    if (activeNotes.size === 0) currentMidi = null;
    emit("noteoff");
  }

  function playNote(midi, durMs = 400, velocity = 0.9) {
    const ok = noteOn(midi, velocity);
    if (!ok) return false;
    setTimeout(() => noteOff(midi), durMs);
    return true;
  }

  function playChord(midis, durMs = 800) {
    if (!ensureCtx()) return false;
    // Polyphony-lite: trigger the shared voice once at the root, and fake the
    // chord by scheduling quick arpeggio if needed. For a single-voice synth,
    // play notes as a fast strum so it's musically pleasing.
    midis.forEach((m, i) => setTimeout(() => playNote(m, durMs), i * 30));
    return true;
  }

  /* ---------------- scheduled note (for the composer + offline bounce) ----------------
     Trigger a note at an absolute AudioContext time with explicit duration.
     Works on the live context; the offline renderer reuses the same envelope logic. */
  function scheduleNoteOn(midi, when, velocity = 0.9, targetCtx = null) {
    const C = targetCtx || ctx;
    if (!C) return false;
    const f = midiToFreq(midi);
    // freerun oscs are shared; for scheduling we retune at the given time
    oscA.frequency.setValueAtTime(f * Math.pow(2, patch.oscA.octave), when);
    oscB.frequency.setValueAtTime(f * Math.pow(2, patch.oscB.octave), when);
    sub.frequency.setValueAtTime(f / 2, when);

    const g = vca.gain;
    const peak = velocity * 0.9;
    g.setValueAtTime(0.0001, when);
    g.linearRampToValueAtTime(peak, when + Math.max(0.001, patch.env.attack));
    g.linearRampToValueAtTime(peak * patch.env.sustain, when + patch.env.attack + patch.env.decay);

    const fe = filter.frequency;
    fe.setValueAtTime(Math.max(40, patch.filter.cutoff), when);
    fe.linearRampToValueAtTime(Math.min(16000, patch.filter.cutoff + patch.filter.envAmount), when + patch.env.attack);
    fe.linearRampToValueAtTime(Math.max(60, patch.filter.cutoff + patch.filter.envAmount * patch.env.sustain), when + patch.env.attack + patch.env.decay);
    return true;
  }

  function scheduleNoteOff(when, targetCtx = null) {
    const C = targetCtx || ctx;
    if (!C) return;
    const g = vca.gain;
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(0.0001, when + Math.max(0.01, patch.env.release));
  }

  /* ============================================================
     analyzeSound — THE DIFFERENTIATOR. The agent's ear.
     Reads the live AnalyserNode and returns structured features.
     ============================================================ */
  function analyzeSound() {
    if (!ctx || !analyser) return { error: "Audio not started yet — press Enable audio or play a note." };

    const freqBins = analyser.frequencyBinCount;
    const freq = new Float32Array(freqBins);
    const time = new Float32Array(analyser.fftSize);
    analyser.getFloatFrequencyData(freq);   // dB values
    analyser.getFloatTimeDomainData(time);

    const sampleRate = ctx.sampleRate;
    const binHz = sampleRate / analyser.fftSize;

    // convert dB -> linear magnitude
    const mag = new Float32Array(freqBins);
    for (let i = 0; i < freqBins; i++) mag[i] = Math.pow(10, freq[i] / 20);

    const totalMag = mag.reduce((a, b) => a + b, 0) || 1e-9;

    // RMS (loudness proxy) from time domain
    let sumSq = 0, peak = 0;
    for (let i = 0; i < time.length; i++) { sumSq += time[i] * time[i]; peak = Math.max(peak, Math.abs(time[i])); }
    const rms = Math.sqrt(sumSq / time.length);

    // Spectral centroid (brightness), in Hz
    let centroidNum = 0;
    for (let i = 0; i < freqBins; i++) centroidNum += i * binHz * mag[i];
    const centroidHz = centroidNum / totalMag;

    // Spectral rolloff (85% energy point)
    let cum = 0, rolloffHz = 0;
    const target = totalMag * 0.85;
    for (let i = 0; i < freqBins; i++) { cum += mag[i]; if (cum >= target) { rolloffHz = i * binHz; break; } }

    // Low / mid / high band energy split
    const band = (lo, hi) => {
      let e = 0;
      for (let i = Math.floor(lo / binHz); i < Math.min(freqBins, Math.ceil(hi / binHz)); i++) e += mag[i] * mag[i];
      return e;
    };
    const lowE = band(20, 250), midE = band(250, 2000), highE = band(2000, 12000);
    const bandTotal = (lowE + midE + highE) || 1e-9;

    // Harmonicity: energy near integer multiples of an estimated fundamental.
    // Estimate f0 as the strongest peak below 1200 Hz.
    let f0Bin = 0, f0Mag = 0;
    for (let i = Math.floor(40 / binHz); i < Math.floor(1200 / binHz); i++) {
      if (mag[i] > f0Mag) { f0Mag = mag[i]; f0Bin = i; }
    }
    const f0Hz = f0Bin * binHz;
    let harmonicE = 0, totalHarmonicE = 0;
    if (f0Hz > 40) {
      for (let h = 1; h <= 10; h++) {
        const center = Math.round((f0Hz * h) / binHz);
        const win = Math.max(2, Math.round(15 / binHz));
        for (let i = Math.max(0, center - win); i < Math.min(freqBins, center + win); i++) harmonicE += mag[i] * mag[i];
      }
      totalHarmonicE = band(40, 8000);
    }
    const harmonicity = totalHarmonicE > 0 ? Math.min(1, harmonicE / totalHarmonicE) : 0;

    // Movement: is the spectral shape changing? (LFO / envelope / playing)
    const prev = analyzeSound._prevCentroid || centroidHz;
    const movement = Math.abs(centroidHz - prev) / Math.max(prev, 1);
    analyzeSound._prevCentroid = centroidHz;

    // Zero-crossing roughness of time signal (noisiness vs tonal)
    let zc = 0;
    for (let i = 1; i < time.length; i++) if ((time[i - 1] < 0) !== (time[i] < 0)) zc++;
    const zcr = zc / time.length;

    // Map numbers -> human/agent-friendly descriptors
    const brightness = centroidHz < 400 ? "dark" : centroidHz < 1200 ? "warm" : centroidHz < 3000 ? "present" : "bright";
    const thickness = (lowE / bandTotal) > 0.45 ? "thick" : (lowE / bandTotal) > 0.25 ? "balanced" : "thin";
    const tone = harmonicity > 0.6 ? "harmonic" : zcr > 0.08 ? "noisy" : "inharmonic";
    const attacky = peak > 0 && rms > 0 ? (peak / (rms * 4) > 1.2 ? "punchy" : "smooth") : "silent";
    const moving = movement > 0.03 ? "moving" : "static";

    // ---- diff vs previous analysis: what changed since the agent last listened? ----
    const prevAnalysis = analyzeSound._last;
    let sinceLastCall = null;
    if (prevAnalysis) {
      const dCentroid = Math.round(centroidHz - prevAnalysis.brightness.centroidHz);
      const dRms = +(rms - prevAnalysis.loudness.rms).toFixed(4);
      const notes = [];
      if (Math.abs(dCentroid) > 150) notes.push(dCentroid > 0 ? `brightness rose ${dCentroid}Hz` : `brightness fell ${Math.abs(dCentroid)}Hz`);
      if (prevAnalysis.brightness.label !== brightness) notes.push(`character: ${prevAnalysis.brightness.label} → ${brightness}`);
      if (prevAnalysis.bassMidHigh.label !== thickness) notes.push(`body: ${prevAnalysis.bassMidHigh.label} → ${thickness}`);
      if (prevAnalysis.envelope.label !== attacky) notes.push(`envelope: ${prevAnalysis.envelope.label} → ${attacky}`);
      if (Math.abs(dRms) > 0.02) notes.push(dRms > 0 ? "got louder" : "got quieter");
      sinceLastCall = {
        centroidHzDelta: dCentroid,
        changed: notes.length > 0,
        notes,
        humanTouched: paramHistory.some((h) => h.source === "human" && h.at > (prevAnalysis._at || 0)),
      };
    }

    const analysis = {
      playing: activeNotes.size > 0 || rms > 0.005,
      loudness: { rms: +rms.toFixed(4), peak: +peak.toFixed(4) },
      brightness: { centroidHz: Math.round(centroidHz), label: brightness },
      spectralRolloffHz: Math.round(rolloffHz),
      bassMidHigh: {
        low: +(lowE / bandTotal).toFixed(3),
        mid: +(midE / bandTotal).toFixed(3),
        high: +(highE / bandTotal).toFixed(3),
        label: thickness,
      },
      estimatedFundamentalHz: Math.round(f0Hz),
      harmonicity: { value: +harmonicity.toFixed(3), label: tone },
      envelope: { label: attacky },
      movement: { value: +movement.toFixed(3), label: moving },
      sinceLastCall,
      summary: `${brightness}, ${thickness}, ${tone}, ${attacky}, ${moving}`,
    };
    analysis._at = Date.now();
    analyzeSound._last = analysis;
    return analysis;
  }

  /* expose visualizer data */
  function getAnalysers() { return { analyser, ctx }; }

  /* test hook: inject a fake ctx/analyser so analyzeSound's math can be
     unit-tested headlessly (where real audio output may be silent). */
  function _testInject(fakeCtx, fakeAnalyser) { ctx = fakeCtx; analyser = fakeAnalyser; }

  /* ---------------- plain-words descriptors (accessibility) ----------------
     Translate technical parameter values into everyday language so people
     who don't know synthesis (or use a screen reader) understand the sound. */
  const PLAIN = {
    "filter.cutoff": (v) => v < 200 ? "very dark & muffled" : v < 800 ? "dark" : v < 2000 ? "warm & rounded" : v < 5000 ? "open" : v < 10000 ? "bright" : "very bright & airy",
    "filter.resonance": (v) => v < 1 ? "natural" : v < 4 ? "slightly edgy" : v < 9 ? "squelchy" : "screaming resonance",
    "filter.envAmount": (v) => v < 200 ? "steady" : v < 2000 ? "a gentle snap" : v < 5000 ? "a punchy 'wow'" : "a dramatic sweep",
    "env.attack": (v) => v < 0.01 ? "instant, punchy start" : v < 0.1 ? "quick start" : v < 0.5 ? "a soft fade-in" : "a slow swell",
    "env.decay": (v) => v < 0.1 ? "very short" : v < 0.5 ? "a medium tail" : "a long fade",
    "env.sustain": (v) => v < 0.2 ? "plucky, dies fast" : v < 0.6 ? "holds a little" : "sustains fully",
    "env.release": (v) => v < 0.1 ? "stops immediately" : v < 0.6 ? "rings out briefly" : "a long, lingering tail",
    "lfo.rate": (v) => v < 0.5 ? "a very slow drift" : v < 2 ? "a slow sway" : v < 6 ? "a wobble" : "a fast flutter",
    "lfo.toCutoff": (v) => v < 100 ? "subtle movement" : v < 800 ? "a clear wobble" : "a big wobble",
    "lfo.toPitch": (v) => v < 3 ? "a touch of vibrato" : v < 15 ? "expressive vibrato" : "wild pitch wobble",
    "fx.delayMix": (v) => v < 0.1 ? "almost no echo" : v < 0.3 ? "a light echo" : "a spacious echo",
    "fx.reverbMix": (v) => v < 0.1 ? "dry, up close" : v < 0.35 ? "in a room" : "in a big hall",
    "sub.level": (v) => v < 0.1 ? "no deep bass" : v < 0.4 ? "a hint of deep bass" : "deep, rumbling bass",
    "oscA.detune": (v) => Math.abs(v) < 3 ? "in tune" : Math.abs(v) < 15 ? "slightly detuned, thick" : "heavily detuned",
    "oscB.detune": (v) => Math.abs(v) < 3 ? "in tune" : Math.abs(v) < 15 ? "slightly detuned, thick" : "heavily detuned",
    "oscA.wave": (v) => ({ sawtooth: "a buzzy saw wave", square: "a hollow square wave", triangle: "a soft triangle wave", sine: "a pure sine tone" }[v] || v),
    "oscB.wave": (v) => ({ sawtooth: "a buzzy saw wave", square: "a hollow square wave", triangle: "a soft triangle wave", sine: "a pure sine tone" }[v] || v),
    "master": (v) => v < 0.3 ? "quiet" : v < 0.7 ? "medium volume" : "loud",
  };

  function describeParamPlain(path, value) {
    const fn = PLAIN[path];
    return fn ? fn(value) : String(value);
  }

  function describeAllPlain() {
    const out = {};
    const walk = (obj, prefix) => {
      for (const k in obj) {
        if (k.startsWith("_")) continue;
        const v = obj[k];
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, path);
        else if (PLAIN[path]) out[path] = PLAIN[path](v);
      }
    };
    walk(patch, "");
    return out;
  }

  window.Synth = {
    patch,
    ensureCtx,
    get ctx() { return ctx; },
    applyParam, applyMany,
    noteOn, noteOff, playNote, playChord,
    scheduleNoteOn, scheduleNoteOff,
    analyzeSound,
    getAnalysers,
    _testInject,
    midiToFreq,
    setApplySource, drainParamChanges, getParamValue,
    describeParamPlain, describeAllPlain,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    isStarted: () => !!ctx,
  };
})();
