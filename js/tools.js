/* tools.js — the WebMCP layer for LISTEN.
   Core tools + dynamic preset tools. The agent can read the patch,
   change many params at once, play notes, and — crucially — LISTEN
   to its own output via analyze_sound. */
(function () {
  const result = (text, extra) => ({ content: [{ type: "text", text }], ...extra });
  const jsonResult = (obj) => result(JSON.stringify(obj, null, 2));
  const summarize = (o) => { try { const s = JSON.stringify(o); return s.length > 140 ? s.slice(0, 140) + "…" : s; } catch (_) { return ""; } };

  const mc = () => document.modelContext;
  const mirror = new Map();
  window.__toolRegistryMirror = { list: () => [...mirror.values()] };
  const presetControllers = new Map(); // preset name -> AbortController

  function wrap(name, fn) {
    return async (args) => {
      Activity.log("agent", name, summarize(args));
      Synth.setApplySource("agent");
      try { return await fn(args || {}); }
      catch (err) { console.error(`[tool ${name}]`, err); return result(`Tool "${name}" failed: ${err.message}`, { isError: true }); }
    };
  }

  async function safeRegister(tool, signal) {
    if (!mc()?.registerTool) return;
    try {
      await mc().registerTool(tool, signal ? { signal } : undefined);
      mirror.set(tool.name, { name: tool.name, description: tool.description });
    } catch (err) { console.warn(`registerTool("${tool.name}") failed:`, err.message); }
  }

  /* ---------------- language → synthesis mapper ---------------- */
  // Maps descriptive words to coordinated multi-param moves.
  const SEMANTIC_MOVES = {
    darker:   { "filter.cutoff": (v) => Math.max(120, v * 0.4), "filter.resonance": (v) => Math.min(10, v + 1), "__note": "lower cutoff, slight resonance" },
    brighter: { "filter.cutoff": (v) => Math.min(14000, v * 2.2), "__note": "open the filter" },
    warmer:   { "filter.cutoff": (v) => Math.max(300, v * 0.7), "oscA.wave": "triangle", "sub.level": (v) => Math.min(1, v + 0.2), "__note": "soften waves, add low end" },
    thicker:  { "sub.level": (v) => Math.min(1, v + 0.35), "oscB.detune": (v) => Math.min(30, v + 8), "oscB.level": (v) => Math.min(1, v + 0.15), "__note": "sub + detuned 2nd osc" },
    thinner:  { "sub.level": (v) => Math.max(0, v - 0.3), "oscB.level": (v) => Math.max(0, v - 0.2), "__note": "strip sub + 2nd osc" },
    glassy:   { "oscA.wave": "triangle", "oscB.wave": "sine", "filter.cutoff": 5000, "fx.reverbMix": (v) => Math.min(0.85, v + 0.3), "env.release": (v) => Math.min(3, v + 0.8), "__note": "triangle/sine + air + long tail" },
    punchier: { "env.attack": 0.002, "env.decay": (v) => Math.max(0.1, v * 0.7), "filter.envAmount": (v) => Math.min(8000, v + 1500), "__note": "fast attack, filter snap" },
    smoother: { "env.attack": (v) => Math.min(2, v + 0.25), "filter.envAmount": (v) => Math.max(0, v - 1000), "__note": "slower attack" },
    wobblier: { "lfo.toCutoff": (v) => Math.min(4000, v + 700), "lfo.rate": (v) => Math.min(12, Math.max(2, v)), "__note": "LFO wobble on filter" },
    womp:     { "lfo.toCutoff": (v) => Math.min(4000, v + 900), "lfo.rate": 4, "filter.resonance": (v) => Math.min(14, v + 4), "filter.cutoff": (v) => Math.max(200, v * 0.5), "__note": "dubstep-style wobble" },
    spacier:  { "fx.reverbMix": (v) => Math.min(0.85, v + 0.35), "fx.delayMix": (v) => Math.min(0.7, v + 0.2), "__note": "more reverb + delay" },
    drier:    { "fx.reverbMix": (v) => Math.max(0, v - 0.3), "fx.delayMix": (v) => Math.max(0, v - 0.25), "__note": "less fx" },
    "80s":    { "oscA.wave": "sawtooth", "oscB.wave": "square", "oscB.detune": 12, "filter.cutoff": 2500, "fx.delayMix": (v) => Math.min(0.5, v + 0.2), "env.release": (v) => Math.min(1.5, v + 0.3), "__note": "synthwave detune + gated vibe" },
    aggressive: { "oscA.wave": "sawtooth", "oscB.wave": "sawtooth", "filter.resonance": (v) => Math.min(16, v + 6), "env.attack": 0.002, "filter.envAmount": (v) => Math.min(8000, v + 2500), "__note": "biting resonance + snap" },
    airy:     { "filter.cutoff": (v) => Math.min(12000, v * 1.8), "fx.reverbMix": (v) => Math.min(0.8, v + 0.3), "oscA.wave": "triangle", "__note": "open top + reverb wash" },
    pluckier: { "env.attack": 0.002, "env.sustain": (v) => Math.max(0.1, v * 0.4), "env.decay": (v) => Math.max(0.08, v * 0.6), "filter.envAmount": (v) => Math.min(8000, v + 2000), "__note": "short plucky envelope" },
  };

  function applySemantic(words) {
    const p = Synth.patch;
    const flat = () => Presets.flattenPatch(p);
    const applied = [];
    const notes = [];
    const lower = (words || "").toLowerCase();

    for (const key of Object.keys(SEMANTIC_MOVES)) {
      if (lower.includes(key)) {
        const move = SEMANTIC_MOVES[key];
        for (const [path, val] of Object.entries(move)) {
          if (path === "__note") { notes.push(val); continue; }
          const current = flat()[path];
          const newVal = typeof val === "function" ? val(current) : val;
          try { Synth.applyParam(path, newVal); applied.push(`${path}→${typeof newVal === "number" ? Math.round(newVal * 100) / 100 : newVal}`); } catch (_) {}
        }
      }
    }
    return { applied, notes };
  }

  /* ---------------- core tools ---------------- */
  async function registerCoreTools() {
    const S = Synth;

    await safeRegister({
      name: "get_current_patch",
      description: "Get the full current synthesizer patch: every oscillator, filter, envelope, LFO and FX setting. Call this before changing anything so you know the starting point.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("get_current_patch", () => jsonResult({
        patch: JSON.parse(JSON.stringify(S.patch, (k, v) => (k.startsWith("_") ? undefined : v))),
        hint: "Change params with set_params (batch). Then call analyze_sound while a note plays to hear the result.",
      })),
    });

    await safeRegister({
      name: "analyze_sound",
      description: "LISTEN to the synth's live output. Runs real-time FFT + time-domain analysis and returns structured audio features (brightness, bass/mid/high balance, harmonicity, envelope, movement) plus a plain-language summary. Best called WHILE a note is playing — use play_note first, then listen, then adjust.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("analyze_sound", () => {
        const a = S.analyzeSound();
        if (a.error) return result(a.error);
        UI.renderHearing(a);
        return jsonResult(a);
      }),
    });

    await safeRegister({
      name: "set_params",
      description: "Change MANY synth parameters in ONE call (the whole point: coordinated sound design). Provide a flat map of param paths to values. Paths: oscA/oscB.{wave,octave,detune,level}, sub.level, filter.{cutoff,resonance,envAmount}, env.{attack,decay,sustain,release}, lfo.{wave,rate,toCutoff,toPitch}, fx.{delayTime,delayFeedback,delayMix,reverbMix}, master. Waves: sawtooth,square,triangle,sine.",
      inputSchema: {
        type: "object",
        properties: {
          params: { type: "object", description: "Flat map of param path → value, e.g. {\"filter.cutoff\": 800, \"env.attack\": 0.002}" },
        },
        required: ["params"],
      },
      execute: wrap("set_params", ({ params }) => {
        const applied = S.applyMany(params || {});
        UI.refreshControls();
        return result(`Applied ${applied.length} param(s): ${applied.join(", ")}. Now play a note and call analyze_sound to hear the result.`);
      }),
    });

    await safeRegister({
      name: "shape_sound",
      description: "Translate a natural-language sound goal into coordinated synth moves. Understands words like: darker, brighter, warmer, thicker, thinner, glassy, punchier, smoother, wobblier, womp, spacier, drier, 80s, aggressive, airy, pluckier. Use this when the user describes a vibe rather than exact parameters.",
      inputSchema: {
        type: "object",
        properties: { description: { type: "string", description: "e.g. 'darker and thicker but keep the punch', or 'glassy 80s pad'" } },
        required: ["description"],
      },
      execute: wrap("shape_sound", ({ description }) => {
        const { applied, notes } = applySemantic(description);
        UI.refreshControls();
        if (!applied.length) {
          return result(`No known descriptors found in "${description}". Known: ${Object.keys(SEMANTIC_MOVES).join(", ")}. Or use set_params for exact control.`);
        }
        return result(`Shaped toward "${description}": ${applied.join("; ")}. (${notes.join("; ")}) Play a note + analyze_sound to verify.`);
      }),
    });

    await safeRegister({
      name: "play_note",
      description: "Play a single note. Accepts a MIDI number (60 = middle C) or a note name like 'C4', 'A2', 'F#3'. Hold it long enough to analyze the sound.",
      inputSchema: {
        type: "object",
        properties: {
          note: { type: ["number", "string"], description: "MIDI number (e.g. 60) or name (e.g. 'C4')." },
          durationMs: { type: "integer", description: "How long to hold, ms (default 900). Longer is better for analysis." },
        },
        required: ["note"],
      },
      execute: wrap("play_note", ({ note, durationMs }) => {
        const midi = typeof note === "string" ? noteNameToMidi(note) : note;
        if (midi == null) return result(`Couldn't parse note "${note}". Use MIDI number or name like 'C4'.`);
        const ok = S.playNote(midi, Math.max(200, durationMs || 900));
        if (!ok) return result("Audio engine not started — the user may need to press Enable audio (browser autoplay policy). Ask them to click anywhere first.");
        UI.flashKey(midi, true); setTimeout(() => UI.flashKey(midi, false), Math.max(200, durationMs || 900));
        return result(`Playing ${midiToName(midi)} (MIDI ${midi}) for ${durationMs || 900}ms. Call analyze_sound now to hear it.`);
      }),
    });

    await safeRegister({
      name: "play_chord",
      description: "Play a chord (strummed). Provide 2-5 notes as MIDI numbers or names, or a chord name like 'Cmaj7', 'Am', 'G7'.",
      inputSchema: {
        type: "object",
        properties: {
          notes: { type: "array", items: { type: ["number", "string"] }, description: "e.g. ['C4','E4','G4'] or [60,64,67]" },
          chord: { type: "string", description: "Alternatively a chord name like 'Cmaj7', 'Am', 'F#m7'." },
          durationMs: { type: "integer" },
        },
      },
      execute: wrap("play_chord", ({ notes, chord, durationMs }) => {
        let midis = [];
        if (Array.isArray(notes) && notes.length) {
          midis = notes.map((n) => (typeof n === "string" ? noteNameToMidi(n) : n)).filter((m) => m != null);
        } else if (chord) {
          midis = chordNameToMidis(chord);
        }
        if (!midis.length) return result("Provide 'notes' (array) or 'chord' (e.g. 'Cmaj7').");
        const ok = S.playChord(midis, Math.max(400, durationMs || 1200));
        if (!ok) return result("Audio engine not started — ask the user to click the page first (autoplay policy).");
        return result(`Playing ${midis.map(midiToName).join(" ")}. Call analyze_sound to hear the voicing.`);
      }),
    });

    await safeRegister({
      name: "describe_current_sound",
      description: "Get a producer's description of the current patch WITHOUT needing audio — derived from the parameter values themselves. Useful when audio isn't playing.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("describe_current_sound", () => result(describePatch(S.patch))),
    });

    await safeRegister({
      name: "save_preset",
      description: "Save the current sound as a named preset. The preset AUTOMATICALLY becomes a new agent tool (load_preset__<name>) that you or the user can call later. This is dynamic tool registration in action.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "A short name, e.g. 'dark_pluck' or 'Glass Pad'" } },
        required: ["name"],
      },
      execute: wrap("save_preset", ({ name }) => window.App.savePresetAs(name)),
    });

    await safeRegister({
      name: "list_presets",
      description: "List all available presets (built-in + user-saved) and which are currently exposed as tools.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("list_presets", () => jsonResult(
        Presets.all().map((p) => ({
          name: p.name,
          builtin: !!p.builtin,
          tool: p.builtin ? null : `load_preset__${slug(p.name)}`,
        }))
      )),
    });

    await safeRegister({
      name: "randomize_patch",
      description: "Randomize the patch within a musical vibe for inspiration. Great starting point for a sound-hunt.",
      inputSchema: {
        type: "object",
        properties: { vibe: { type: "string", description: "bass | pad | pluck | lead (default: any)" } },
      },
      execute: wrap("randomize_patch", ({ vibe }) => {
        randomize(vibe);
        UI.refreshControls();
        return result(`Randomized toward "${vibe || "any"}". ${describePatch(S.patch)} Play a note + analyze_sound!`);
      }),
    });

    /* ---------- TWO-WAY: agent perceives human moves ---------- */
    await safeRegister({
      name: "watch_for_changes",
      description: "Ask what the HUMAN has changed by hand since a given time (or since your last tool call). Returns which knobs they turned, old→new values, so you can respond to their intent — the heart of two-way collaboration. Call this before big moves, or when the user says 'what did I just do?'.",
      inputSchema: {
        type: "object",
        properties: { sinceMs: { type: "integer", description: "Unix ms timestamp. Omit to use the time of the last analyze_sound call." } },
      },
      execute: wrap("watch_for_changes", ({ sinceMs }) => {
        const since = sinceMs || (Synth.analyzeSound._last?._at || 0);
        const changes = Synth.drainParamChanges(since).filter((c) => c.source === "human");
        if (!changes.length) return result("The human hasn't turned any knobs recently.");
        const lines = changes.map((c) => `${c.path}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`);
        return result(`The human adjusted ${changes.length} thing(s):\n` + lines.join("\n") +
          `\n\nConsider responding — e.g. if they opened the filter, offer to shape around their brighter sound.`);
      }),
    });

    await safeRegister({
      name: "compare_to_target",
      description: "Score how close the CURRENT sound is to a described target (e.g. 'dark, thick, punchy'), and suggest the single next best move. Use this to iterate toward a vibe with the user: analyze → compare → adjust → repeat.",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string", description: "Target description, e.g. 'dark and punchy' or 'bright glassy pad'" } },
        required: ["target"],
      },
      execute: wrap("compare_to_target", ({ target }) => {
        const a = Synth.analyzeSound();
        if (a.error) return result(a.error + " Play a note first, then compare.");
        UI.renderHearing(a);
        const evaln = evaluateAgainstTarget(a, (target || "").toLowerCase());
        return jsonResult({
          target,
          current: a.summary,
          score: evaln.score,
          matched: evaln.matched,
          missing: evaln.missing,
          suggestion: evaln.suggestion,
          hint: evaln.score >= 0.8 ? "Very close! Confirm with the user, then maybe save_preset." : "Apply the suggestion via shape_sound or set_params, then analyze_sound + compare_to_target again.",
        });
      }),
    });

    /* ---------- ACCESSIBILITY: plain words ---------- */
    await safeRegister({
      name: "explain_sound_in_plain_words",
      description: "Explain the current sound in everyday, non-technical language — for users who don't know synthesis or who use a screen reader. Returns a friendly paragraph plus per-knob plain descriptions. Use this to make sound design accessible to everyone.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("explain_sound_in_plain_words", () => {
        const plain = Synth.describeAllPlain();
        const p = Synth.patch;
        const para =
          `Right now the synth makes ${plain["oscA.wave"] || "a tone"}${p.oscB.level > 0.2 ? " layered with " + (plain["oscB.wave"] || "another tone") : ""}. ` +
          `It sounds ${plain["filter.cutoff"]}, with ${plain["filter.resonance"].toLowerCase()}. ` +
          `When you press a key it has ${plain["env.attack"]} and ${plain["env.release"]}. ` +
          `${p.sub.level > 0.1 ? "There's " + plain["sub.level"] + ". " : ""}` +
          `${p.fx.reverbMix > 0.1 || p.fx.delayMix > 0.1 ? "It's " + [plain["fx.reverbMix"], plain["fx.delayMix"]].filter(Boolean).join(" with ") + ". " : ""}` +
          `${p.lfo.toCutoff > 50 ? "The tone has " + plain["lfo.toCutoff"] + ". " : ""}`;
        return jsonResult({ paragraph: para.trim(), perKnob: plain });
      }),
    });

    /* ---------- COMPOSITION + OUTPUT (the artifacts) ---------- */
    await safeRegister({
      name: "compose_pattern",
      description: "Compose a musical loop (bassline / arp / pad / lead) that fits the CURRENT sound you designed. You provide the vibe; this builds a 16-step-per-bar pattern and loads it. Then play_pattern to hear it, and render_to_wav to export it. Call after you're happy with the sound.",
      inputSchema: {
        type: "object",
        properties: {
          vibe: { type: "string", description: "e.g. 'dark techno bassline', 'dreamy arp', 'sparse minimal'" },
          bars: { type: "integer", description: "1-4 bars (default 2)" },
          root: { type: "integer", description: "MIDI root note (default 45 = A2)" },
          scale: { type: "string", enum: ["minor", "major", "dorian", "pentatonic", "chromatic"] },
          bpm: { type: "integer", description: "70-180 (default inferred from vibe)" },
          density: { type: "number", description: "0-1, how busy (default from vibe)" },
          rhythmStyle: { type: "string", enum: ["bass", "arp", "pad", "lead"], description: "Pattern archetype (default from vibe)" },
        },
        required: ["vibe"],
      },
      execute: wrap("compose_pattern", (opts) => {
        const p = Composer.composeFromVibe(opts);
        UI.renderSequencer && UI.renderSequencer();
        return result(`Composed a ${p.bars}-bar ${p.scale} ${p.vibe} pattern at ${p.bpm} BPM (${p.steps.length} notes, root MIDI ${p.root}). Call play_pattern to hear it through your sound, then render_to_wav to export.`);
      }),
    });

    await safeRegister({
      name: "play_pattern",
      description: "Play the currently composed pattern as a loop through the synth. Stop with stop_pattern.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("play_pattern", () => {
        const ok = Composer.play();
        if (!ok) return result("No pattern composed yet — call compose_pattern first, or the user needs to enable audio (autoplay policy).");
        const p = Composer.getPattern();
        return result(`Playing ${p.bars}-bar ${p.vibe} loop at ${p.bpm} BPM. Call analyze_sound to hear how it sits, or stop_pattern to stop.`);
      }),
    });

    await safeRegister({
      name: "stop_pattern",
      description: "Stop the looping pattern.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("stop_pattern", () => { Composer.stop(); return result("Pattern stopped."); }),
    });

    await safeRegister({
      name: "render_to_wav",
      description: "BOUNCE the current sound + composed pattern to a downloadable WAV file (44.1kHz stereo 16-bit). This produces a real audio artifact the user keeps. Call after composing a pattern and confirming the sound with analyze_sound.",
      inputSchema: {
        type: "object",
        properties: {
          bars: { type: "integer", description: "1-16 bars to render (default: the pattern's length)" },
          name: { type: "string", description: "File name base, e.g. 'dark-techno-bass' (default from vibe)" },
        },
      },
      execute: wrap("render_to_wav", async ({ bars, name }) => {
        const pattern = Composer.getPattern();
        const wasPlaying = Composer.isPlaying();
        if (wasPlaying) Composer.stop();
        const res = await Bounce.renderToWav({ bars });
        const fname = (name || (pattern ? pattern.vibe : "sound") || "sound").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sound";
        const filename = `${fname}_${res.bars}bar.wav`;
        Bounce.downloadBlob(res.blob, filename);
        UI.addTake && UI.addTake({ name: filename, type: "wav", blob: res.blob, durationS: res.durationS, bpm: res.bpm });
        return result(`Bounced "${filename}" — ${res.bars} bars at ${res.bpm} BPM, ${res.durationS.toFixed(1)}s, 44.1kHz stereo WAV. It's downloading now and saved in the Takes panel. You can also generate_sound_card to capture the recipe.`);
      }),
    });

    await safeRegister({
      name: "generate_sound_card",
      description: "Generate a 'Sound DNA' card: a shareable PNG that captures what you (the agent) HEARD — your own descriptive words, the waveform, spectrum, and the full patch recipe. A reproducible artifact of the sound. Call after analyze_sound.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Sound name, e.g. 'midnight_bass'" }, vibe: { type: "string", description: "Short descriptor; defaults to your analyze_sound summary" } },
      },
      execute: wrap("generate_sound_card", async ({ name, vibe }) => {
        // ensure we have a fresh analysis
        const a = Synth.analyzeSound();
        const card = DnaCard.generate({ name: name || "untitled", vibe: vibe || (a.summary || "") });
        const blob = await card.toPngBlob();
        const filename = `${(name || "sound").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_dna.png`;
        Bounce.downloadBlob(blob, filename);
        UI.addTake && UI.addTake({ name: filename, type: "png", blob, json: card.recipeJson });
        return result(`Sound DNA card "${filename}" generated — it captures the analysis ("${a.summary || vibe}"), waveform, spectrum, and full patch recipe. Downloading now + saved in Takes.`);
      }),
    });

    await safeRegister({
      name: "export_vital_preset",
      description: "Export the CURRENT sound as a production-ready VITAL preset (.vital) — the free, most popular Serum alternative — that producers can load straight into their DAW. The sound you designed together becomes a real studio instrument, not just a browser demo. Use after the sound is finalized.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Preset name, e.g. 'dark_techno_bass'" },
          style: { type: "string", description: "Optional style tag, e.g. 'bass', 'pad', 'lead'" },
        },
        required: ["name"],
      },
      execute: wrap("export_vital_preset", ({ name, style }) => {
        const a = Synth.analyzeSound._last || null;
        const { blob, filename } = Vital.exportVital(name, { vibe: a?.summary || "", style });
        Bounce.downloadBlob(blob, filename);
        UI.addTake && UI.addTake({ name: filename, type: "vital", blob });
        return result(`Exported "${filename}" — a production-ready Vital preset. Open it in Vital (free) inside any DAW and it plays THIS exact sound. Saved in Takes too. The agent-designed patch is now a real studio instrument.`);
      }),
    });

    await safeRegister({
      name: "describe_capabilities",
      description: "Explain what this agent-native synth lets humans and agents do together, and the recommended listen-adjust loop.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("describe_capabilities", () => result(
        "LISTEN is a synthesizer you (the agent) can hear. Core loop: " +
        "1) play_note (hold ~1s) → 2) analyze_sound to hear brightness/body/tone/envelope → " +
        "3) set_params (batch) or shape_sound (natural language) → 4) analyze_sound again to verify. " +
        "TWO-WAY: call watch_for_changes to see what the human turned by hand since you last listened — " +
        "respond to their intent, don't overwrite it. Use compare_to_target to iterate toward a vibe " +
        "(analyze → compare → adjust → repeat). When the user loves a sound, save_preset — it becomes a " +
        "new tool you can recall forever. This synth is also an accessibility tool: describe sound in plain " +
        "words for users who can't see or turn the knobs. " +
        "OUTPUT: once the sound is right, compose_pattern to make a loop that fits it, play_pattern to hear it, " +
        "then render_to_wav to bounce a real audio file and generate_sound_card to capture the recipe — " +
        "artifacts the user actually keeps."
      )),
    });

    Activity.refreshToolList();
  }

  /* ---------------- dynamic preset tools ---------------- */
  async function registerPresetTool(preset) {
    if (preset.builtin) return; // built-ins are loaded via UI, not tools (keeps tool list clean)
    const name = `load_preset__${slug(preset.name)}`;
    // revoke old registration if re-saving under same name
    presetControllers.get(name)?.abort();
    const ac = new AbortController();
    presetControllers.set(name, ac);

    await safeRegister({
      name,
      description: `Load the user-saved preset "${preset.name}" (${describePatch(preset.patch, true)}).`,
      inputSchema: { type: "object", properties: {} },
      execute: wrap(name, () => {
        const applied = Presets.applyPreset(preset);
        UI.refreshControls();
        return result(`Loaded preset "${preset.name}" (${applied.length} params). Play a note + analyze_sound to hear it.`);
      }),
    }, ac.signal);
    Activity.refreshToolList();
  }

  function unregisterPresetTool(presetName) {
    const name = `load_preset__${slug(presetName)}`;
    presetControllers.get(name)?.abort();
    presetControllers.delete(name);
    mirror.delete(name);
    Activity.refreshToolList();
  }

  async function registerAllPresetTools() {
    for (const p of Presets.all()) await registerPresetTool(p);
  }

  /* ---------------- helpers ---------------- */
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function fmtVal(v) { return typeof v === "number" ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000) : String(v); }

  /* Score current analysis against a natural-language target, and suggest the next move. */
  function evaluateAgainstTarget(a, target) {
    const matched = [], missing = [];
    const has = (...words) => words.some((w) => target.includes(w));

    if (has("dark")) (a.brightness.label === "dark" ? matched : missing).push("dark");
    if (has("bright")) (["bright", "present"].includes(a.brightness.label) ? matched : missing).push("bright");
    if (has("warm")) (a.brightness.label === "warm" ? matched : missing).push("warm");
    if (has("thick") || has("fat") || has("full")) (["thick", "balanced"].includes(a.bassMidHigh.label) ? matched : missing).push("thick");
    if (has("thin")) (a.bassMidHigh.label === "thin" ? matched : missing).push("thin");
    if (has("punch")) (a.envelope.label === "punchy" ? matched : missing).push("punchy");
    if (has("smooth") || has("soft")) (a.envelope.label === "smooth" ? matched : missing).push("smooth");
    if (has("wobbl") || has("womp") || has("mov")) (a.movement.label === "moving" ? matched : missing).push("movement");

    const total = matched.length + missing.length;
    const score = total ? +(matched.length / total).toFixed(2) : 0.5;

    // Suggest the single best next move based on the first missing descriptor.
    let suggestion = "Play with the knobs together — you're close.";
    const first = missing[0];
    if (first === "dark") suggestion = "Lower the filter cutoff (shape_sound 'darker' or set_params filter.cutoff).";
    else if (first === "bright") suggestion = "Open the filter (shape_sound 'brighter').";
    else if (first === "warm") suggestion = "Soften to triangle waves + slightly close the filter (shape_sound 'warmer').";
    else if (first === "thick") suggestion = "Add sub + detune osc B (shape_sound 'thicker').";
    else if (first === "thin") suggestion = "Reduce sub and osc B level (shape_sound 'thinner').";
    else if (first === "punchy") suggestion = "Faster attack + filter envelope snap (shape_sound 'punchier').";
    else if (first === "smooth") suggestion = "Slower attack (shape_sound 'smoother').";
    else if (first === "movement") suggestion = "Add LFO to cutoff (shape_sound 'wobblier').";

    return { score, matched, missing, suggestion };
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function midiToName(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); }
  function noteNameToMidi(s) {
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(s).trim());
    if (!m) return null;
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    let semis = base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return (parseInt(m[3], 10) + 1) * 12 + semis;
  }
  function chordNameToMidis(name) {
    const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(String(name).trim());
    if (!m) return [];
    const root = noteNameToMidi(`${m[1]}${m[2]}4`);
    const q = m[3].toLowerCase();
    const QUAL = {
      "": [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7],
      maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], min7: [0, 3, 7, 10],
      "7": [0, 4, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8],
      "5": [0, 7],
    };
    const iv = QUAL[q] || QUAL[""];
    return iv.map((i) => root + i);
  }

  function describePatch(p, brief = false) {
    const parts = [];
    const bright = p.filter.cutoff < 800 ? "dark" : p.filter.cutoff < 3000 ? "warm" : "bright";
    const body = p.sub.level > 0.4 ? "thick low end" : p.sub.level > 0.1 ? "some low end" : "lean";
    const env = p.env.attack < 0.01 && p.env.sustain < 0.4 ? "plucky" : p.env.attack > 0.3 ? "swelling pad" : "responsive";
    const fx = p.fx.reverbMix > 0.4 ? "drenched in reverb" : p.fx.delayMix > 0.25 ? "echoing" : "fairly dry";
    const lfo = p.lfo.toCutoff > 500 ? `wobbling at ${p.lfo.rate}Hz` : null;
    parts.push(`${bright} ${p.oscA.wave}${p.oscB.level > 0.2 ? "+" + p.oscB.wave : ""} ${env}, ${body}, ${fx}${lfo ? ", " + lfo : ""}`);
    if (!brief && p.filter.resonance > 6) parts.push(`pronounced resonance (Q ${p.filter.resonance.toFixed(1)})`);
    return parts.join(" — ");
  }

  function randomize(vibe = "") {
    const R = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const p = {};
    const v = vibe.toLowerCase();
    if (v === "bass") {
      p["oscA.wave"] = "sawtooth"; p["oscA.octave"] = pick([-1, -2]); p["oscA.level"] = R(0.7, 1);
      p["oscB.level"] = R(0.3, 0.7); p["oscB.detune"] = R(3, 15);
      p["sub.level"] = R(0.4, 0.8);
      p["filter.cutoff"] = R(150, 900); p["filter.resonance"] = R(1, 10); p["filter.envAmount"] = R(500, 3000);
      p["env.attack"] = R(0.001, 0.01); p["env.sustain"] = R(0.4, 0.8);
      if (Math.random() < 0.5) { p["lfo.toCutoff"] = R(300, 1500); p["lfo.rate"] = R(2, 8); }
    } else if (v === "pad") {
      p["oscA.wave"] = pick(["triangle", "sawtooth"]); p["oscB.wave"] = pick(["sine", "triangle"]);
      p["oscB.detune"] = R(5, 18);
      p["env.attack"] = R(0.3, 1.2); p["env.release"] = R(1, 3); p["env.sustain"] = R(0.6, 0.9);
      p["filter.cutoff"] = R(1500, 5000);
      p["fx.reverbMix"] = R(0.3, 0.7); p["fx.delayMix"] = R(0.1, 0.4);
    } else if (v === "pluck") {
      p["env.attack"] = R(0.001, 0.005); p["env.decay"] = R(0.1, 0.4); p["env.sustain"] = R(0.05, 0.3);
      p["filter.envAmount"] = R(1500, 5000); p["filter.cutoff"] = R(600, 2500);
      p["oscA.wave"] = pick(["sawtooth", "square"]);
    } else if (v === "lead") {
      p["oscA.wave"] = "sawtooth"; p["oscA.octave"] = pick([0, 1]);
      p["oscB.detune"] = R(4, 12); p["env.attack"] = R(0.005, 0.05); p["env.sustain"] = R(0.6, 0.9);
      p["filter.cutoff"] = R(2000, 8000); p["lfo.toPitch"] = R(0, 12); p["lfo.rate"] = R(4, 7);
    } else {
      p["oscA.wave"] = pick(["sawtooth", "square", "triangle"]); p["oscA.level"] = R(0.5, 1);
      p["oscB.wave"] = pick(["sawtooth", "square", "sine"]); p["oscB.level"] = R(0, 0.8); p["oscB.detune"] = R(0, 20);
      p["sub.level"] = R(0, 0.6);
      p["filter.cutoff"] = R(200, 8000); p["filter.resonance"] = R(0.5, 12); p["filter.envAmount"] = R(0, 4000);
      p["env.attack"] = R(0.001, 0.8); p["env.decay"] = R(0.05, 1); p["env.sustain"] = R(0.1, 0.9); p["env.release"] = R(0.05, 2);
      p["lfo.rate"] = R(0.1, 10); p["lfo.toCutoff"] = R(0, 1500);
      p["fx.reverbMix"] = R(0, 0.6); p["fx.delayMix"] = R(0, 0.4);
    }
    Synth.applyMany(p);
  }

  function listenToolChange() {
    try { mc()?.addEventListener?.("toolchange", () => Activity.refreshToolList()); } catch (_) {}
  }

  window.Tools = { registerCoreTools, registerPresetTool, unregisterPresetTool, registerAllPresetTools, listenToolChange, slug };
})();
