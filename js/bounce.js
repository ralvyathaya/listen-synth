/* bounce.js — render the synth (playing a pattern) to a downloadable WAV.
   Rebuilds the same signal chain in an OfflineAudioContext, schedules the
   active pattern, renders, and encodes 16-bit PCM stereo WAV. 44.1kHz. */
(function () {
  const SAMPLE_RATE = 44100;

  /* Build a fresh synth graph on a given (offline) context, applying a patch. */
  function buildOfflineGraph(C, patch) {
    const master = C.createGain(); master.gain.value = patch.master ?? 0.8;
    const filter = C.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = patch.filter.cutoff;
    filter.Q.value = patch.filter.resonance;
    const vca = C.createGain(); vca.gain.value = 0;

    const dry = C.createGain(); dry.gain.value = 1;
    filter.connect(vca); vca.connect(dry); dry.connect(master);

    // delay
    const delay = C.createDelay(2.0); delay.delayTime.value = patch.fx.delayTime;
    const dfb = C.createGain(); dfb.gain.value = patch.fx.delayFeedback;
    const dmix = C.createGain(); dmix.gain.value = patch.fx.delayMix;
    vca.connect(delay); delay.connect(dfb); dfb.connect(delay); delay.connect(dmix); dmix.connect(master);

    // reverb
    const conv = C.createConvolver(); conv.buffer = buildImpulse(C, 2.2, 3.2);
    const rmix = C.createGain(); rmix.gain.value = patch.fx.reverbMix;
    vca.connect(conv); conv.connect(rmix); rmix.connect(master);

    master.connect(C.destination);

    // oscs
    const oscA = C.createOscillator(), oscB = C.createOscillator(), sub = C.createOscillator();
    const gA = C.createGain(), gB = C.createGain(), gS = C.createGain();
    oscA.type = patch.oscA.wave; oscB.type = patch.oscB.wave; sub.type = "sine";
    gA.gain.value = patch.oscA.level; gB.gain.value = patch.oscB.level; gS.gain.value = patch.sub.level;
    oscA.detune.value = patch.oscA.detune; oscB.detune.value = patch.oscB.detune;
    oscA.connect(gA).connect(filter);
    oscB.connect(gB).connect(filter);
    sub.connect(gS).connect(filter);

    // LFO
    const lfo = C.createOscillator(); lfo.type = patch.lfo.wave; lfo.frequency.value = patch.lfo.rate;
    const lfoC = C.createGain(); lfoC.gain.value = patch.lfo.toCutoff;
    const lfoP = C.createGain(); lfoP.gain.value = patch.lfo.toPitch;
    lfo.connect(lfoC).connect(filter.frequency);
    lfo.connect(lfoP).connect(oscA.detune);
    lfo.connect(lfoP).connect(oscB.detune);

    return { oscA, oscB, sub, filter, vca, lfo, master };
  }

  function buildImpulse(C, seconds, decay) {
    const rate = C.sampleRate, len = rate * seconds;
    const buf = C.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function scheduleNote(g, patch, midi, when, velocity) {
    const f = midiToFreq(midi);
    g.oscA.frequency.setValueAtTime(f * Math.pow(2, patch.oscA.octave), when);
    g.oscB.frequency.setValueAtTime(f * Math.pow(2, patch.oscB.octave), when);
    g.sub.frequency.setValueAtTime(f / 2, when);
    const peak = velocity * 0.9;
    g.vca.gain.setValueAtTime(0.0001, when);
    g.vca.gain.linearRampToValueAtTime(peak, when + Math.max(0.001, patch.env.attack));
    g.vca.gain.linearRampToValueAtTime(peak * patch.env.sustain, when + patch.env.attack + patch.env.decay);
    g.filter.frequency.setValueAtTime(Math.max(40, patch.filter.cutoff), when);
    g.filter.frequency.linearRampToValueAtTime(Math.min(16000, patch.filter.cutoff + patch.filter.envAmount), when + patch.env.attack);
  }
  function scheduleOff(g, patch, when) {
    g.vca.gain.setValueAtTime(g.vca.gain.value, when);
    g.vca.gain.linearRampToValueAtTime(0.0001, when + Math.max(0.01, patch.env.release));
  }

  /* Render the active pattern (or a held note) to a WAV Blob. */
  async function renderToWav(opts = {}) {
    const pattern = opts.pattern || window.Composer?.getPattern();
    const bars = Math.max(1, Math.min(16, opts.bars || (pattern ? pattern.bars : 2) || 2));
    const bpm = (pattern && pattern.bpm) || opts.bpm || 120;
    const patch = JSON.parse(JSON.stringify(Synth.patch, (k, v) => (k.startsWith("_") ? undefined : v)));

    const sps = 60 / bpm / 4;             // seconds per 16th
    const totalSteps = 16 * bars;
    const tailS = Math.max(0.5, patch.env.release + 0.4);
    const durationS = totalSteps * sps + tailS;

    const C = new OfflineAudioContext(2, Math.ceil(durationS * SAMPLE_RATE), SAMPLE_RATE);
    const g = buildOfflineGraph(C, patch);
    g.oscA.start(0); g.oscB.start(0); g.sub.start(0); g.lfo.start(0);

    if (pattern && pattern.steps && pattern.steps.length) {
      // schedule pattern, looping across bars
      for (const n of pattern.steps) {
        if (n.step >= totalSteps) continue;
        const when = n.step * sps + 0.02;
        scheduleNote(g, patch, n.note, when, n.velocity);
        scheduleOff(g, patch, when + n.length * sps);
      }
    } else {
      // no pattern: render a held root note so the bounce isn't silent
      const root = opts.note ?? 45;
      scheduleNote(g, patch, root, 0.02, 0.9);
      scheduleOff(g, patch, durationS - tailS);
    }

    const buffer = await C.startRendering();
    const blob = bufferToWav(buffer);
    return { blob, durationS, bars, bpm, sampleRate: SAMPLE_RATE };
  }

  /* AudioBuffer -> 16-bit PCM stereo WAV Blob */
  function bufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const len = buffer.length * numCh * 2 + 44;
    const arr = new ArrayBuffer(len);
    const view = new DataView(arr);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

    writeStr(view, 0, "RIFF");
    view.setUint32(4, len - 8, true);
    writeStr(view, 8, "WAVE");
    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeStr(view, 36, "data");
    view.setUint32(40, len - 44, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arr], { type: "audio/wav" });
  }
  function writeStr(view, offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return url;
  }

  window.Bounce = { renderToWav, bufferToWav, downloadBlob, SAMPLE_RATE };
})();
