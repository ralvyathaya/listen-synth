/* composer.js — pattern sequencer + agent composition.
   A lookahead scheduler (Web Audio clock, not setTimeout) that plays a
   16-step pattern through the existing synth voice. The agent composes
   the pattern via compose_pattern; the user hears it live and can bounce it. */
(function () {
  const STEPS = 16;
  let pattern = null;        // { steps: [{step,note,velocity,length}], bpm, root, scale, vibe, bars }
  let playing = false;
  let currentStep = 0;
  let nextNoteTime = 0;
  let timerID = null;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_S = 0.12;
  const listeners = new Set();

  const SCALE_INTERVALS = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    pentatonic: [0, 3, 5, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  function emit(topic, data) { listeners.forEach((fn) => { try { fn(topic, data); } catch (e) {} }); }

  function secondsPerStep(bpm) { return 60 / bpm / 4; } // 16th notes

  /* Set the active pattern (from the agent or a template). */
  function setPattern(p) {
    pattern = normalizePattern(p);
    emit("pattern", pattern);
    return pattern;
  }

  function getPattern() { return pattern; }

  function normalizePattern(p) {
    const bpm = Math.max(60, Math.min(200, p.bpm || 120));
    const steps = Array.isArray(p.steps) ? p.steps : [];
    // clamp steps into the grid
    const clean = steps
      .filter((s) => s && typeof s.step === "number" && s.step >= 0 && s.step < STEPS * (p.bars || 1))
      .map((s) => ({
        step: s.step,
        note: typeof s.note === "number" ? s.note : 48,
        velocity: Math.max(0.1, Math.min(1, s.velocity ?? 0.9)),
        length: Math.max(0.1, s.length ?? 1), // in steps
      }));
    return {
      steps: clean,
      bpm,
      root: p.root ?? 45, // A2
      scale: p.scale || "minor",
      vibe: p.vibe || "",
      bars: p.bars || 1,
    };
  }

  function totalSteps() { return pattern ? STEPS * (pattern.bars || 1) : STEPS; }

  /* ---------- playback ---------- */
  function play() {
    if (!pattern || !pattern.steps.length) return false;
    if (!Synth.ensureCtx()) return false;
    if (Synth.ctx.state === "suspended") Synth.ctx.resume();
    if (playing) return true;
    playing = true;
    currentStep = 0;
    nextNoteTime = Synth.ctx.currentTime + 0.05;
    emit("playstate", true);
    scheduler();
    return true;
  }

  function stop() {
    playing = false;
    if (timerID) { clearTimeout(timerID); timerID = null; }
    emit("playstate", false);
    emit("step", -1);
  }

  function scheduler() {
    if (!playing) return;
    const sps = secondsPerStep(pattern.bpm);
    while (nextNoteTime < Synth.ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += sps;
      currentStep = (currentStep + 1) % totalSteps();
    }
    timerID = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function scheduleStep(step, time) {
    // find notes at this step
    const notes = pattern.steps.filter((s) => s.step === step);
    notes.forEach((n) => {
      const midi = n.note;
      const durS = n.length * secondsPerStep(pattern.bpm);
      Synth.scheduleNoteOn(midi, time, n.velocity);
      Synth.scheduleNoteOff(time + durS);
    });
    // UI: highlight current step (throttled to visual frame)
    const delay = Math.max(0, (time - Synth.ctx.currentTime) * 1000);
    setTimeout(() => { if (playing) emit("step", step); }, delay);
  }

  /* ---------- agent composition helper ----------
     Turn a vibe into a concrete pattern. The agent provides the creative
     intent; this gives it structure + musical guardrails. */
  function composeFromVibe(opts = {}) {
    const vibe = (opts.vibe || "").toLowerCase();
    const bars = Math.max(1, Math.min(4, opts.bars || 2));
    const root = opts.root ?? 45;
    const scale = opts.scale || (vibe.includes("happy") || vibe.includes("bright") ? "major" : "minor");
    const bpm = Math.max(70, Math.min(180, opts.bpm || (vibe.includes("techno") ? 128 : vibe.includes("house") ? 124 : vibe.includes("trap") ? 140 : 120)));
    const density = Math.max(0.1, Math.min(1, opts.density ?? (vibe.includes("sparse") || vibe.includes("minimal") ? 0.3 : vibe.includes("busy") ? 0.8 : 0.55)));
    const style = (opts.rhythmStyle || (vibe.includes("arp") ? "arp" : vibe.includes("pad") ? "pad" : "bass")).toLowerCase();
    const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.minor;
    const total = STEPS * bars;

    const steps = [];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (style === "bass") {
      // driving bass: root on beats, passing notes on off-16ths
      for (let s = 0; s < total; s++) {
        const beat = s % 4 === 0;
        const off = s % 2 === 1;
        if (beat || (off && Math.random() < density)) {
          const degree = beat ? 0 : pick([0, 0, 1, 2, 4]);
          const oct = Math.random() < 0.2 ? 12 : 0;
          steps.push({ step: s, note: root + intervals[degree % intervals.length] + oct, velocity: beat ? 0.95 : 0.7 + Math.random() * 0.2, length: off ? 0.5 : 1 });
        }
      }
    } else if (style === "arp") {
      // arpeggio: cycle chord tones up/down across 16ths
      const chord = [0, 1, 2].map((d) => intervals[d % intervals.length]);
      let i = 0;
      for (let s = 0; s < total; s++) {
        if (Math.random() < density + 0.2) {
          const oct = (Math.floor(i / chord.length) % 2) * 12;
          steps.push({ step: s, note: root + 12 + chord[i % chord.length] + oct, velocity: 0.75 + Math.random() * 0.2, length: 0.5 });
          i++;
        }
      }
    } else if (style === "pad") {
      // sparse sustained chords on bar starts
      for (let s = 0; s < total; s += STEPS) {
        [0, 2, 4].forEach((d) => {
          steps.push({ step: s, note: root + 12 + intervals[d % intervals.length], velocity: 0.7, length: STEPS * 0.9 });
        });
      }
    } else {
      // lead: melodic, syncopated
      for (let s = 0; s < total; s++) {
        if (Math.random() < density * 0.8) {
          const degree = pick([0, 1, 2, 3, 4, 5]);
          const oct = Math.random() < 0.5 ? 12 : 24;
          steps.push({ step: s, note: root + oct + intervals[degree % intervals.length], velocity: 0.7 + Math.random() * 0.25, length: pick([0.5, 1, 1, 2]) });
        }
      }
    }

    return setPattern({ steps, bpm, root, scale, vibe: opts.vibe || style, bars });
  }

  window.Composer = {
    setPattern, getPattern, composeFromVibe,
    play, stop, isPlaying: () => playing,
    STEPS, SCALE_INTERVALS,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
