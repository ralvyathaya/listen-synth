/* vital.js — export the current patch as a production-ready Vital preset.
   Vital (free, the most popular Serum alternative) stores presets as JSON in
   .vital files, so our 2-osc/sub/filter/ADSR/LFO/delay/reverb patch maps
   directly onto a real studio instrument. This is the artifact producers
   actually load into their DAW — not a loop, the SOUND itself. */
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* Vital's "Basic shapes" wavetable frame positions (0-255). */
  const WAVE_FRAME = { sine: 0, sawtooth: 85, square: 170, triangle: 255 };

  /* Vital stores filter cutoff in semitones (MIDI-note scale, ~8Hz..20kHz). */
  function hzToSemitone(hz) {
    return clamp(69 + 12 * Math.log2(Math.max(8, hz) / 440), 8, 136);
  }

  function patchToVital(patch, name, opts = {}) {
    const p = patch;
    const comments =
      `Designed in LISTEN with an AI agent that listened to its own output. ` +
      `Analysis: ${opts.vibe || "agent-designed sound"}. Reproduce + remix freely.`;

    const settings = {
      /* global */
      beats_per_minute: opts.bpm || 120,
      volume: clamp(p.master ?? 0.8, 0, 1),

      /* OSC 1 */
      osc_1_on: 1.0,
      osc_1_level: clamp(p.oscA.level, 0, 1),
      osc_1_wave_frame: WAVE_FRAME[p.oscA.wave] ?? 85,
      osc_1_transpose: (p.oscA.octave || 0) * 12,
      osc_1_tune: clamp((p.oscA.detune || 0) / 100, -1, 1), // Vital tune is in semitones (±1)
      osc_1_unison_voices: 1,
      osc_1_unison_detune: Math.abs(p.oscA.detune || 0) / 25,

      /* OSC 2 */
      osc_2_on: p.oscB.level > 0.02 ? 1.0 : 0.0,
      osc_2_level: clamp(p.oscB.level, 0, 1),
      osc_2_wave_frame: WAVE_FRAME[p.oscB.wave] ?? 170,
      osc_2_transpose: (p.oscB.octave || 0) * 12,
      osc_2_tune: clamp((p.oscB.detune || 0) / 100, -1, 1),
      osc_2_unison_voices: Math.abs(p.oscB.detune) > 6 ? 4 : 1,
      osc_2_unison_detune: Math.abs(p.oscB.detune || 0) / 25,

      /* SUB */
      sub_on: p.sub.level > 0.02 ? 1.0 : 0.0,
      sub_level: clamp(p.sub.level, 0, 1),

      /* FILTER (analog lowpass) */
      filter_1_on: 1.0,
      filter_1_model: 3.0, // analog-style 24dB lowpass
      filter_1_cutoff: hzToSemitone(p.filter.cutoff),
      filter_1_resonance: clamp(p.filter.resonance / 18, 0, 1),
      filter_1_drive: 0.0,

      /* ENV 1 (amp) */
      env_1_attack: clamp(p.env.attack, 0, 16),
      env_1_decay: clamp(p.env.decay, 0, 16),
      env_1_sustain: clamp(p.env.sustain, 0, 1),
      env_1_release: clamp(p.env.release, 0, 16),

      /* ENV 2 → filter envelope amount (Vital routes env2 to cutoff) */
      env_2_attack: clamp(p.env.attack, 0, 16),
      env_2_decay: clamp(p.env.decay, 0, 16),
      env_2_sustain: clamp(p.env.sustain, 0, 1),
      env_2_release: clamp(p.env.release, 0, 16),
      filter_1_env: clamp((p.filter.envAmount || 0) / 8000, 0, 1) * 48, // semitones of env travel

      /* LFO 1 (Hz, unsynced) */
      lfo_1_frequency: clamp(p.lfo.rate, 0.02, 25),
      lfo_1_sync_type: 0.0,

      /* DELAY (tempo-free) */
      delay_on: p.fx.delayMix > 0.02 ? 1.0 : 0.0,
      delay_dry_wet: clamp(p.fx.delayMix, 0, 1),
      delay_feedback: clamp(p.fx.delayFeedback, 0, 0.95),
      delay_frequency: clamp(1 / Math.max(0.05, p.fx.delayTime), 0.5, 12),
      delay_sync_type: 0.0,

      /* REVERB */
      reverb_on: p.fx.reverbMix > 0.02 ? 1.0 : 0.0,
      reverb_dry_wet: clamp(p.fx.reverbMix, 0, 1),
      reverb_decay_time: 2.2,
      reverb_size: 0.5,
    };

    return {
      author: "LISTEN · the synth your agent can hear",
      comments,
      preset_name: name || "listen_patch",
      preset_style: opts.style || "",
      settings,
      synth_version: "1.5.5",
    };
  }

  function exportVital(name, opts = {}) {
    const patch = JSON.parse(JSON.stringify(Synth.patch, (k, v) => (k.startsWith("_") ? undefined : v)));
    const vital = patchToVital(patch, name, opts);
    const json = JSON.stringify(vital, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const filename = `${(name || "listen_patch").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.vital`;
    return { blob, filename, vital };
  }

  window.Vital = { patchToVital, exportVital };
})();
