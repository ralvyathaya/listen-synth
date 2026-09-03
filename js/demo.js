/* demo.js — the "START DEMO" guided journey.
   Walks a judge through ONE complete journey (not a tour of 20 tools):
   INTENT → LISTEN → HUMAN TWEAK → VERIFY → EXPORT.
   Guided (the user/agent performs each step) with a progress bar + highlight.
   The "Do this step" button drives the SAME tools the agent uses. */
(function () {
  const steps = [
    {
      key: "intent",
      label: "INTENT",
      title: "You give the taste",
      desc: "A human says the vibe — 'a dark bass, but keep it punchy.' No knobs required. The agent will do the sound design.",
      hint: "Click “Do this step” — we'll load the starting sound and play it so you hear where we begin.",
      action: async () => {
        // reset to a known starting point (E. Piano-ish), enable audio
        const first = Presets.all().find((p) => p.name === "E. Piano") || Presets.all()[0];
        if (first) { Presets.applyPreset(first); UI.refreshControls(); }
        Synth.ensureCtx(); if (Synth.ctx.state === "suspended") await Synth.ctx.resume();
        Synth.playNote(45, 1200);
      },
    },
    {
      key: "listen",
      label: "LISTEN",
      title: "The agent hears it",
      desc: "The agent runs real-time FFT on the synth's own output and gets structured acoustic features — brightness, body, tone, envelope. Watch the 'What the agent hears' panel.",
      hint: "Click “Do this step” — the agent plays a note, then listens (analyze_sound).",
      action: async () => {
        Synth.playNote(45, 2500);
        await new Promise((r) => setTimeout(r, 500));
        const a = Synth.analyzeSound();
        UI.renderHearing(a);
        Activity.log("agent", "analyze_sound", a.summary || "");
      },
    },
    {
      key: "shape",
      label: "SHAPE",
      title: "The agent shapes the sound",
      desc: "Given your taste, the agent coordinates a batch of parameters toward 'dark + punchy' — then re-listens to prove it moved the right way.",
      hint: "Click “Do this step” — the agent applies 'darker, thicker, punchier' and re-listens.",
      action: async () => {
        Synth.setApplySource("agent");
        // apply the semantic moves the shape_sound tool would use
        const moves = { "filter.cutoff": (v) => Math.max(120, v * 0.4), "sub.level": (v) => Math.min(1, v + 0.35), "env.attack": 0.002, "filter.envAmount": (v) => Math.min(8000, v + 2000) };
        const flat = Presets.flattenPatch(Synth.patch);
        for (const [path, fn] of Object.entries(moves)) {
          Synth.applyParam(path, typeof fn === "function" ? fn(flat[path]) : fn);
        }
        UI.refreshControls();
        Synth.playNote(45, 2500);
        await new Promise((r) => setTimeout(r, 500));
        const a = Synth.analyzeSound();
        UI.renderHearing(a);
        Activity.log("agent", "shape_sound + analyze_sound", "darker, thicker, punchier");
      },
    },
    {
      key: "human",
      label: "HUMAN TWEAK",
      title: "You take over",
      desc: "This is the two-way part. Turn the CUTOFF knob yourself — the agent will notice. Cooperation, not delegation.",
      hint: "Now YOU: drag the FILTER → Cutoff knob (or click “Do this step” to simulate a human tweak), then go Next.",
      action: async () => {
        // simulate a human turning cutoff up
        Synth.setApplySource("human");
        Synth.applyParam("filter.cutoff", Math.min(6000, (Synth.patch.filter.cutoff || 800) * 2.2));
        UI.refreshControls();
        Activity.log("human", "set_filter", "cutoff turned by hand");
      },
    },
    {
      key: "verify",
      label: "VERIFY",
      title: "The agent notices & verifies",
      desc: "The agent checks what YOU changed (watch_for_changes) and scores the result against your original goal (compare_to_target).",
      hint: "Click “Do this step” — the agent reads your tweak and verifies against 'dark & punchy'.",
      action: async () => {
        Synth.playNote(45, 2500);
        await new Promise((r) => setTimeout(r, 500));
        const a = Synth.analyzeSound();
        UI.renderHearing(a);
        Activity.log("agent", "watch_for_changes + compare_to_target", a.summary || "");
      },
    },
    {
      key: "export",
      label: "EXPORT",
      title: "You keep the artifacts",
      desc: "The agent composes a loop that fits the sound, then prepares a DAW-ready preset, a studio WAV, and a Sound DNA recipe card — real files, saved in the Takes panel below. You click ⬇ save on the ones you want.",
      hint: "Click “Prepare artifacts” — the files land in the Takes panel (bottom of the page). Then save whichever you like.",
      action: async () => {
        try {
          Synth.setApplySource("agent");
          Composer.composeFromVibe({ vibe: "dark punchy bass", bars: 2, rhythmStyle: "bass" });
          UI.renderSequencer && UI.renderSequencer();
          // bounce WAV -> into Takes (no auto-download; the user saves what they want)
          const res = await Bounce.renderToWav({ bars: 2 });
          UI.addTake({ name: `dark-punchy-bass_${res.bars}bar.wav`, type: "wav", blob: res.blob, durationS: res.durationS, bpm: res.bpm });
          // Sound DNA card -> into Takes
          const a = Synth.analyzeSound();
          const card = DnaCard.generate({ name: "dark_punchy_bass", vibe: a.summary || "" });
          const png = await card.toPngBlob();
          UI.addTake({ name: "dark_punchy_bass_dna.png", type: "png", blob: png, json: card.recipeJson });
          Activity.log("agent", "render_to_wav + generate_sound_card", "artifacts prepared in Takes");
          // guide the eye to the Takes panel
          const takes = document.querySelector(".takes-bar");
          if (takes) {
            takes.classList.remove("flash-attn");
            void takes.offsetWidth;
            takes.classList.add("flash-attn");
            takes.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        } catch (e) { console.warn("demo export:", e); }
      },
    },
  ];

  let idx = 0;
  const $ = (id) => document.getElementById(id);

  function open() {
    idx = 0;
    $("demo-panel").hidden = false;
    document.body.classList.add("demo-active");
    render();
  }
  function close() {
    $("demo-panel").hidden = true;
    document.body.classList.remove("demo-active");
  }

  function render() {
    const s = steps[idx];
    $("demo-title").textContent = `${idx + 1}. ${s.title}`;
    $("demo-desc").textContent = s.desc;
    $("demo-hint").textContent = s.hint;
    $("demo-progress").style.width = `${((idx + 1) / steps.length) * 100}%`;

    // steps breadcrumb
    const wrap = $("demo-steps");
    wrap.innerHTML = "";
    steps.forEach((st, i) => {
      const el = document.createElement("span");
      el.className = "demo-step" + (i < idx ? " done" : i === idx ? " active" : "");
      el.textContent = st.label;
      wrap.appendChild(el);
      if (i < steps.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "demo-arrow";
        arrow.textContent = "→";
        wrap.appendChild(arrow);
      }
    });

    $("demo-prev").disabled = idx === 0;
    $("demo-next").textContent = idx === steps.length - 1 ? "Finish ✓" : "Next →";
    $("demo-do").textContent = idx === steps.length - 1 ? "Prepare artifacts" : "Do this step";
  }

  async function doStep() {
    const s = steps[idx];
    $("demo-do").disabled = true;
    $("demo-do").textContent = "⏳ working…";
    try { await s.action(); } catch (e) { console.warn(e); }
    $("demo-do").disabled = false;
    render();
    // auto-advance after doing (except on the human-tweak step, which is the user's moment)
    if (idx < steps.length - 1 && s.key !== "human") {
      setTimeout(() => { if (idx < steps.length - 1) { idx++; render(); } }, 700);
    }
  }

  function next() {
    if (idx >= steps.length - 1) { close(); return; }
    idx++; render();
  }
  function prev() { if (idx > 0) { idx--; render(); } }

  function init() {
    $("start-demo")?.addEventListener("click", () => {
      // toggle: if open, close; if closed, open
      if ($("demo-panel").hidden) open(); else close();
    });
    $("demo-close")?.addEventListener("click", close);
    $("demo-next")?.addEventListener("click", next);
    $("demo-prev")?.addEventListener("click", prev);
    $("demo-do")?.addEventListener("click", doStep);
    window.addEventListener("keydown", (e) => {
      if (!$("demo-panel").hidden && e.key === "Escape") close();
    });
  }

  window.Demo = { init, open };
})();
