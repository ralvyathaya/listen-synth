/* presets.js — built-in + user presets. User-saved presets become
   WebMCP tools automatically (dynamic registration). */
(function () {
  const KEY = "listen-synth:presets:v1";

  const BUILT_IN = [
    {
      name: "Dark Pluck", builtin: true,
      patch: {
        oscA: { wave: "sawtooth", octave: 0, detune: 0, level: 0.8 },
        oscB: { wave: "square", octave: -1, detune: 5, level: 0.4 },
        sub: { level: 0.3 },
        filter: { cutoff: 900, resonance: 4, envAmount: 2500 },
        env: { attack: 0.003, decay: 0.22, sustain: 0.25, release: 0.3 },
        lfo: { wave: "sine", rate: 1.2, toCutoff: 300, toPitch: 0 },
        fx: { delayTime: 0.3, delayFeedback: 0.35, delayMix: 0.15, reverbMix: 0.2 },
        master: 0.8,
      },
    },
    {
      name: "Glass Pad", builtin: true,
      patch: {
        oscA: { wave: "triangle", octave: 1, detune: -6, level: 0.6 },
        oscB: { wave: "sine", octave: 1, detune: 6, level: 0.6 },
        sub: { level: 0.1 },
        filter: { cutoff: 3500, resonance: 0.8, envAmount: 800 },
        env: { attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.6 },
        lfo: { wave: "sine", rate: 0.5, toCutoff: 600, toPitch: 3 },
        fx: { delayTime: 0.45, delayFeedback: 0.45, delayMix: 0.3, reverbMix: 0.55 },
        master: 0.8,
      },
    },
    {
      name: "Wobble Bass", builtin: true,
      patch: {
        oscA: { wave: "sawtooth", octave: -1, detune: 0, level: 0.9 },
        oscB: { wave: "sawtooth", octave: -1, detune: 10, level: 0.8 },
        sub: { level: 0.6 },
        filter: { cutoff: 300, resonance: 8, envAmount: 1200 },
        env: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.25 },
        lfo: { wave: "sine", rate: 4.5, toCutoff: 900, toPitch: 0 },
        fx: { delayTime: 0.25, delayFeedback: 0.2, delayMix: 0.05, reverbMix: 0.08 },
        master: 0.85,
      },
    },
    {
      name: "E. Piano", builtin: true,
      patch: {
        oscA: { wave: "sine", octave: 0, detune: 0, level: 0.85 },
        oscB: { wave: "triangle", octave: 1, detune: 4, level: 0.28 },
        sub: { level: 0.05 },
        filter: { cutoff: 4500, resonance: 0.6, envAmount: 900 },
        env: { attack: 0.002, decay: 0.5, sustain: 0.25, release: 0.7 },
        lfo: { wave: "sine", rate: 5.2, toCutoff: 0, toPitch: 4 },
        fx: { delayTime: 0.32, delayFeedback: 0.25, delayMix: 0.12, reverbMix: 0.3 },
        master: 0.82,
      },
    },
    {
      name: "Soft Strings", builtin: true,
      patch: {
        oscA: { wave: "sawtooth", octave: 0, detune: -8, level: 0.5 },
        oscB: { wave: "sawtooth", octave: 0, detune: 8, level: 0.5 },
        sub: { level: 0.1 },
        filter: { cutoff: 2600, resonance: 0.9, envAmount: 600 },
        env: { attack: 0.4, decay: 0.6, sustain: 0.8, release: 1.2 },
        lfo: { wave: "sine", rate: 0.6, toCutoff: 300, toPitch: 2 },
        fx: { delayTime: 0.4, delayFeedback: 0.3, delayMix: 0.1, reverbMix: 0.5 },
        master: 0.78,
      },
    },
    {
      name: "Brass Stab", builtin: true,
      patch: {
        oscA: { wave: "sawtooth", octave: 0, detune: 0, level: 0.85 },
        oscB: { wave: "square", octave: 0, detune: 6, level: 0.4 },
        sub: { level: 0.15 },
        filter: { cutoff: 2200, resonance: 2.5, envAmount: 3000 },
        env: { attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.2 },
        lfo: { wave: "sine", rate: 0.8, toCutoff: 150, toPitch: 0 },
        fx: { delayTime: 0.28, delayFeedback: 0.2, delayMix: 0.08, reverbMix: 0.22 },
        master: 0.8,
      },
    },
    {
      name: "Music Box", builtin: true,
      patch: {
        oscA: { wave: "sine", octave: 2, detune: 0, level: 0.7 },
        oscB: { wave: "triangle", octave: 3, detune: 2, level: 0.2 },
        sub: { level: 0 },
        filter: { cutoff: 9000, resonance: 0.5, envAmount: 2000 },
        env: { attack: 0.001, decay: 0.6, sustain: 0.05, release: 1.0 },
        lfo: { wave: "sine", rate: 0.3, toCutoff: 0, toPitch: 0 },
        fx: { delayTime: 0.5, delayFeedback: 0.4, delayMix: 0.2, reverbMix: 0.45 },
        master: 0.75,
      },
    },
  ];

  function loadUser() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
  }
  function saveUser(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {} }

  function all() { return [...BUILT_IN, ...loadUser()]; }

  function flattenPatch(p) {
    // deep patch object -> flat { "oscA.wave": "sawtooth", ... }
    const out = {};
    (function walk(obj, prefix) {
      for (const k in obj) {
        if (k.startsWith("_")) continue;
        const v = obj[k];
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, path);
        else out[path] = v;
      }
    })(p, "");
    return out;
  }

  function applyPreset(preset) {
    const flat = flattenPatch(preset.patch);
    const applied = Synth.applyMany(flat);
    Activity.log("human", "load_preset", preset.name);
    return applied;
  }

  function saveCurrent(name) {
    const list = loadUser();
    const clean = JSON.parse(JSON.stringify(Synth.patch, (k, v) => (k.startsWith("_") ? undefined : v)));
    const preset = { name, builtin: false, patch: clean };
    const i = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) list[i] = preset; else list.push(preset);
    saveUser(list);
    return preset;
  }

  function deleteUser(name) {
    saveUser(loadUser().filter((p) => p.name !== name));
  }

  window.Presets = { all, applyPreset, saveCurrent, deleteUser, flattenPatch };
})();
