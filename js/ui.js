/* ui.js — knobs, keyboard, visualizers, preset row. */
(function () {
  /* ---------------- knob component ---------------- */
  function makeKnob({ label, path, min, max, value, scale = "linear", unit = "", format }) {
    const wrap = document.createElement("div");
    wrap.className = "knob-wrap";
    wrap.dataset.path = path;

    const fmt = format || ((v) => unit ? `${round(v)}${unit}` : round(v));
    function round(v) { return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100; }
    const toNorm = (v) => scale === "log" ? (Math.log(v / min) / Math.log(max / min)) : (v - min) / (max - min);
    const fromNorm = (n) => scale === "log" ? min * Math.pow(max / min, n) : min + (max - min) * n;

    wrap.innerHTML =
      `<div class="knob" role="slider" aria-label="${label}" tabindex="0" aria-valuemin="${min}" aria-valuemax="${max}">` +
      `<div class="knob-indicator"></div></div>` +
      `<div class="knob-label">${label}</div>` +
      `<div class="knob-value">${fmt(value)}</div>`;

    const knob = wrap.querySelector(".knob");
    const indicator = wrap.querySelector(".knob-indicator");
    const valueEl = wrap.querySelector(".knob-value");

    let norm = toNorm(value);
    function render() {
      const angle = -135 + norm * 270;
      indicator.style.transform = `rotate(${angle}deg)`;
    }
    render();

    function commit(v, actor) {
      v = Math.max(min, Math.min(max, v));
      norm = toNorm(v);
      render();
      valueEl.textContent = fmt(v);
      Synth.setApplySource("human");
      Synth.applyParam(path, v);
      knob.setAttribute("aria-valuenow", v);
    }

    knob.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      knob.setPointerCapture(e.pointerId);
      const startY = e.clientY, startNorm = norm;
      const move = (ev) => {
        const d = (startY - ev.clientY) / 150;
        commit(fromNorm(Math.max(0, Math.min(1, startNorm + d))), "human");
      };
      const up = () => {
        knob.removeEventListener("pointermove", move);
        knob.removeEventListener("pointerup", up);
        Activity.log("human", `set_${path.split(".")[0]}`, `${path} → ${valueEl.textContent}`);
      };
      knob.addEventListener("pointermove", move);
      knob.addEventListener("pointerup", up);
    });
    knob.addEventListener("wheel", (e) => {
      e.preventDefault();
      commit(fromNorm(Math.max(0, Math.min(1, norm + (e.deltaY < 0 ? 0.04 : -0.04)))), "human");
    }, { passive: false });
    knob.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") { commit(fromNorm(Math.min(1, norm + 0.05)), "human"); e.preventDefault(); }
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") { commit(fromNorm(Math.max(0, norm - 0.05)), "human"); e.preventDefault(); }
    });

    // external updates (agent / presets)
    wrap.update = (v) => { norm = toNorm(v); render(); valueEl.textContent = fmt(v); };
    return wrap;
  }

  function makeSelect({ label, path, options, value }) {
    const wrap = document.createElement("div");
    wrap.className = "knob-wrap";
    wrap.dataset.path = path;
    wrap.innerHTML =
      `<div class="knob-label" style="margin-bottom:4px">${label}</div>` +
      `<select class="select"></select>`;
    const sel = wrap.querySelector("select");
    options.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o; opt.textContent = o[0].toUpperCase() + o.slice(1).replace("tooth", "");
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener("change", () => {
      Synth.setApplySource("human");
      Synth.applyParam(path, sel.value);
      Activity.log("human", `set_${path.split(".")[0]}`, `${path} → ${sel.value}`);
    });
    wrap.update = (v) => { sel.value = v; };
    return wrap;
  }

  const controls = new Map(); // path -> element wrapper

  /* ---------------- build modules (compact rack) ---------------- */
  function buildModules() {
    const P = Synth.patch;

    // helper: fill a module slot with titled sub-groups of knobs
    function fill(id, groups) {
      const mod = document.getElementById(id);
      if (!mod) return;
      mod.innerHTML = "";
      groups.forEach(([title, children]) => {
        const g = document.createElement("div");
        g.className = "module-group";
        g.innerHTML = `<div class="module-title">${title}</div>`;
        const row = document.createElement("div");
        row.className = "module-knobs";
        children.forEach((c) => { row.appendChild(c); if (c.dataset?.path) controls.set(c.dataset.path, c); });
        g.appendChild(row);
        mod.appendChild(g);
      });
    }

    fill("osc-modules", [
      ["OSC A", [
        makeSelect({ label: "Wave", path: "oscA.wave", options: ["sawtooth", "square", "triangle", "sine"], value: P.oscA.wave }),
        makeKnob({ label: "Oct", path: "oscA.octave", min: -2, max: 2, value: P.oscA.octave, format: (v) => (v > 0 ? "+" : "") + Math.round(v) }),
        makeKnob({ label: "Detune", path: "oscA.detune", min: -50, max: 50, value: P.oscA.detune, unit: "¢" }),
        makeKnob({ label: "Level", path: "oscA.level", min: 0, max: 1, value: P.oscA.level }),
      ]],
      ["OSC B", [
        makeSelect({ label: "Wave", path: "oscB.wave", options: ["sawtooth", "square", "triangle", "sine"], value: P.oscB.wave }),
        makeKnob({ label: "Oct", path: "oscB.octave", min: -2, max: 2, value: P.oscB.octave, format: (v) => (v > 0 ? "+" : "") + Math.round(v) }),
        makeKnob({ label: "Detune", path: "oscB.detune", min: -50, max: 50, value: P.oscB.detune, unit: "¢" }),
        makeKnob({ label: "Level", path: "oscB.level", min: 0, max: 1, value: P.oscB.level }),
      ]],
      ["SUB", [
        makeKnob({ label: "Level", path: "sub.level", min: 0, max: 1, value: P.sub.level }),
      ]],
    ]);

    fill("filter-module", [
      ["FILTER", [
        makeKnob({ label: "Cutoff", path: "filter.cutoff", min: 60, max: 16000, value: P.filter.cutoff, scale: "log", unit: "Hz" }),
        makeKnob({ label: "Reso", path: "filter.resonance", min: 0.1, max: 18, value: P.filter.resonance, scale: "log" }),
        makeKnob({ label: "Env amt", path: "filter.envAmount", min: 0, max: 8000, value: P.filter.envAmount, unit: "Hz" }),
      ]],
    ]);

    fill("env-module", [
      ["ENVELOPE", [
        makeKnob({ label: "Atk", path: "env.attack", min: 0.001, max: 2, value: P.env.attack, scale: "log", unit: "s" }),
        makeKnob({ label: "Dec", path: "env.decay", min: 0.01, max: 2, value: P.env.decay, scale: "log", unit: "s" }),
        makeKnob({ label: "Sus", path: "env.sustain", min: 0, max: 1, value: P.env.sustain }),
        makeKnob({ label: "Rel", path: "env.release", min: 0.01, max: 4, value: P.env.release, scale: "log", unit: "s" }),
      ]],
    ]);

    fill("lfo-module", [
      ["LFO", [
        makeSelect({ label: "Wave", path: "lfo.wave", options: ["sine", "triangle", "square", "sawtooth"], value: P.lfo.wave }),
        makeKnob({ label: "Rate", path: "lfo.rate", min: 0.05, max: 20, value: P.lfo.rate, scale: "log", unit: "Hz" }),
        makeKnob({ label: "→ Cut", path: "lfo.toCutoff", min: 0, max: 4000, value: P.lfo.toCutoff, unit: "Hz" }),
        makeKnob({ label: "→ Pitch", path: "lfo.toPitch", min: 0, max: 50, value: P.lfo.toPitch, unit: "¢" }),
      ]],
    ]);

    fill("fx-module", [
      ["SPACE", [
        makeKnob({ label: "D-time", path: "fx.delayTime", min: 0.05, max: 1.2, value: P.fx.delayTime, unit: "s" }),
        makeKnob({ label: "Fdbk", path: "fx.delayFeedback", min: 0, max: 0.9, value: P.fx.delayFeedback }),
        makeKnob({ label: "D-mix", path: "fx.delayMix", min: 0, max: 0.8, value: P.fx.delayMix }),
        makeKnob({ label: "Reverb", path: "fx.reverbMix", min: 0, max: 0.9, value: P.fx.reverbMix }),
      ]],
    ]);
  }

  /* reflect external param changes (agent / preset) into knobs */
  function refreshControls() {
    const flat = Presets.flattenPatch(Synth.patch);
    controls.forEach((el, path) => { if (path in flat && el.update) el.update(flat[path]); });
    if (simpleMode) refreshSimplePanel();
  }

  /* ---------------- keyboard ---------------- */
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  let baseOctave = 4;
  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 };

  function buildKeyboard() {
    const kb = document.getElementById("keyboard");
    kb.innerHTML = "";
    // two octaves C..B
    for (let oct = 0; oct < 2; oct++) {
      for (let n = 0; n < 12; n++) {
        const midi = (baseOctave + oct) * 12 + n + 12; // C4 = 60
        const isBlack = NOTE_NAMES[n].includes("#");
        const key = document.createElement("button");
        key.className = "key" + (isBlack ? " black" : " white");
        key.dataset.midi = midi;
        key.innerHTML = `<span>${NOTE_NAMES[n]}${baseOctave + oct}</span>`;
        key.addEventListener("pointerdown", () => { key.classList.add("active"); Synth.noteOn(midi); });
        key.addEventListener("pointerup", () => { key.classList.remove("active"); Synth.noteOff(midi); });
        key.addEventListener("pointerleave", () => { key.classList.remove("active"); Synth.noteOff(midi); });
        kb.appendChild(key);
      }
    }
  }

  function flashKey(midi, on = true) {
    const key = document.querySelector(`[data-midi="${midi}"]`);
    if (key) key.classList.toggle("active", on);
  }

  const heldComp = new Set();
  function wireComputerKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.target.matches("input,textarea,select")) return;
      const k = e.key.toLowerCase();
      if (k in KEYMAP) {
        const midi = (baseOctave + 1) * 12 + KEYMAP[k];
        if (!heldComp.has(k)) { heldComp.add(k); Synth.noteOn(midi); flashKey(midi, true); }
      }
      if (k === "z") { baseOctave = Math.max(1, baseOctave - 1); buildKeyboard(); }
      if (k === "x") { baseOctave = Math.min(7, baseOctave + 1); buildKeyboard(); }
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (k in KEYMAP && heldComp.has(k)) {
        heldComp.delete(k);
        const midi = (baseOctave + 1) * 12 + KEYMAP[k];
        Synth.noteOff(midi); flashKey(midi, false);
      }
    });
  }

  /* ---------------- visualizers ---------------- */
  function startVisualizers() {
    const spec = document.getElementById("spectrum").getContext("2d");
    const osc = document.getElementById("oscilloscope").getContext("2d");

    function draw() {
      requestAnimationFrame(draw);
      const { analyser } = Synth.getAnalysers();
      if (!analyser) { clearVis(spec); clearVis(osc); return; }

      // spectrum
      const fb = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(fb);
      const w = spec.canvas.width, h = spec.canvas.height;
      spec.clearRect(0, 0, w, h);
      const bars = 96, step = Math.floor(fb.length * 0.7 / bars);
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = fb[i * step] / 255;
        const grad = spec.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "#5b8cff"); grad.addColorStop(1, "#7c5bff");
        spec.fillStyle = grad;
        spec.fillRect(i * bw + 1, h - v * h, bw - 2, v * h);
      }

      // oscilloscope
      const td = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(td);
      osc.clearRect(0, 0, w, h);
      osc.strokeStyle = "#34d399";
      osc.lineWidth = 2;
      osc.beginPath();
      const slice = w / td.length;
      for (let i = 0; i < td.length; i++) {
        const y = (td[i] / 255) * h;
        i === 0 ? osc.moveTo(0, y) : osc.lineTo(i * slice, y);
      }
      osc.stroke();
    }
    function clearVis(c) { c.clearRect(0, 0, c.canvas.width, c.canvas.height); }
    draw();
  }

  /* ---------------- presets row (90s LCD patch selector) ---------------- */
  function renderPresets() {
    const row = document.getElementById("preset-row");
    row.innerHTML = "";
    const all = Presets.all();
    all.forEach((p, i) => {
      const chip = document.createElement("button");
      chip.className = "preset-chip" + (p.builtin ? " builtin" : "");
      const bank = p.builtin ? `A${String(i + 1).padStart(2, "0")}` : `U${String(i + 1).padStart(2, "0")}`;
      chip.textContent = `${bank} ${p.name.toUpperCase()}`;
      chip.dataset.presetName = p.name;
      chip.title = p.builtin ? "Built-in patch" : "Your patch — also registered as an agent tool";
      chip.setAttribute("role", "option");
      chip.addEventListener("click", () => {
        Presets.applyPreset(p);
        refreshControls();
        updateReadout(bank, p.name);
        markActive(chip);
      });
      row.appendChild(chip);
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "preset-chip save";
    saveBtn.textContent = "＋ SAVE PATCH";
    saveBtn.addEventListener("click", () => {
      const name = prompt("Name this patch:", "My Sound");
      if (name) window.App.savePresetAs(name.trim());
    });
    row.appendChild(saveBtn);
  }

  function updateReadout(bank, name) {
    const el = document.getElementById("pu-readout");
    if (el) el.textContent = `${bank}  ${name.toUpperCase().replace(/ /g, "·")}`;
    announce(`Patch loaded: ${name}`);
  }
  function markActive(activeChip) {
    activeChip.closest(".preset-row").querySelectorAll(".preset-chip").forEach((c) => c.classList.remove("active"));
    activeChip.classList.add("active");
  }

  /* ---------------- "what the agent hears" panel (centered) ---------------- */
  function renderHearing(a) {
    const el = document.getElementById("hearing");
    if (!el) return;
    if (a.error) { el.innerHTML = `<p class="dim">${a.error}</p>`; return; }

    // dramatic listening indicator
    const ind = document.getElementById("listen-indicator");
    const panel = document.getElementById("hearing-panel");
    ind.classList.add("active");
    panel.classList.add("listening");
    setTimeout(() => ind.classList.remove("active"), 900);
    setTimeout(() => panel.classList.remove("listening"), 900);

    drawHearingRing();

    // diff note (two-way)
    let diffHtml = "";
    if (a.sinceLastCall && a.sinceLastCall.changed) {
      const who = a.sinceLastCall.humanTouched ? "🧑 you changed it" : "🤖 agent changed it";
      diffHtml = `<div class="hear-diff"><span class="hd-who">${who}</span> ${a.sinceLastCall.notes.map(Activity.escapeHtml).join(" · ")}</div>`;
    }

    el.innerHTML =
      `<div class="hear-summary">“${Activity.escapeHtml(a.summary)}”</div>` +
      diffHtml +
      `<div class="hear-grid">` +
      hearStat("Brightness", `${a.brightness.label}`, `${a.brightness.centroidHz} Hz`) +
      hearStat("Body", a.bassMidHigh.label, `L ${Math.round(a.bassMidHigh.low * 100)} · M ${Math.round(a.bassMidHigh.mid * 100)} · H ${Math.round(a.bassMidHigh.high * 100)}`) +
      hearStat("Tone", a.harmonicity.label, a.harmonicity.value) +
      hearStat("Envelope", a.envelope.label, "") +
      hearStat("Motion", a.movement.label, a.movement.value) +
      hearStat("Playing", a.playing ? "yes" : "no", a.playing ? `~${a.estimatedFundamentalHz} Hz` : "") +
      `</div>`;

    announce(`Sound analysis: ${a.summary}. Brightness ${a.brightness.label}, body ${a.bassMidHigh.label}.`);
  }
  function hearStat(label, big, small) {
    return `<div class="hear-stat"><div class="hs-label">${label}</div><div class="hs-big">${big}</div><div class="hs-small">${small}</div></div>`;
  }

  /* spectral ring: a compact radial view of what the agent's FFT sees */
  function drawHearingRing() {
    const canvas = document.getElementById("hearing-ring");
    if (!canvas) return;
    const c = canvas.getContext("2d");
    const { analyser } = Synth.getAnalysers();
    const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
    c.clearRect(0, 0, w, h);
    if (!analyser) return;
    const bins = 48;
    const fb = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(fb);
    const step = Math.floor(fb.length * 0.6 / bins);
    for (let i = 0; i < bins; i++) {
      const v = fb[i * step] / 255;
      const ang = (i / bins) * Math.PI * 2 - Math.PI / 2;
      const r0 = 30, r1 = 30 + v * 26;
      c.strokeStyle = `hsl(${230 - v * 40}, 80%, ${55 + v * 15}%)`;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      c.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      c.stroke();
    }
    // inner ear icon
    c.font = "20px serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("👂", cx, cy);
  }

  /* ---------------- screen-reader announcer (accessibility) ---------------- */
  function announce(msg) {
    const el = document.getElementById("sr-announcer");
    if (el) el.textContent = msg;
  }

  /* ---------------- SIMPLIFY MODE (accessibility) ---------------- */
  const SIMPLE_SLIDERS = [
    { label: "Dark ↔ Bright", path: "filter.cutoff", min: 60, max: 14000, scale: "log", left: "🌑 dark", right: "☀️ bright" },
    { label: "Thin ↔ Thick", path: "sub.level", min: 0, max: 1, left: "🥢 thin", right: "🍔 thick" },
    { label: "Dry ↔ Spacious", path: "fx.reverbMix", min: 0, max: 0.85, left: "🏠 dry", right: "🏛️ spacious" },
    { label: "Calm ↔ Edgy", path: "filter.resonance", min: 0.2, max: 16, scale: "log", left: "😌 calm", right: "⚡ edgy" },
    { label: "Steady ↔ Wobbly", path: "lfo.toCutoff", min: 0, max: 2000, left: "➖ steady", right: "〰️ wobbly" },
    { label: "Soft ↔ Punchy", path: "filter.envAmount", min: 0, max: 6000, left: "🪶 soft", right: "👊 punchy" },
  ];

  let simpleMode = false;
  function buildSimplePanel() {
    const wrap = document.getElementById("simple-sliders");
    if (!wrap) return;
    wrap.innerHTML = "";
    SIMPLE_SLIDERS.forEach((s) => {
      const row = document.createElement("div");
      row.className = "simple-row";
      const cur = Synth.getParamValue(s.path);
      row.innerHTML =
        `<span class="simple-end">${s.left}</span>` +
        `<input type="range" class="simple-slider" min="${s.min}" max="${s.max}" ` +
        `step="${(s.max - s.min) / 100}" value="${cur}" aria-label="${s.label}">` +
        `<span class="simple-end">${s.right}</span>`;
      const slider = row.querySelector("input");
      slider.addEventListener("input", () => {
        Synth.setApplySource("human");
        Synth.applyParam(s.path, parseFloat(slider.value));
        announce(`${s.label}: ${Synth.describeParamPlain(s.path, parseFloat(slider.value))}`);
      });
      row.update = (v) => { slider.value = v; };
      row.dataset.path = s.path;
      wrap.appendChild(row);
    });
  }

  function refreshSimplePanel() {
    const wrap = document.getElementById("simple-sliders");
    if (!wrap) return;
    wrap.querySelectorAll(".simple-row").forEach((row) => {
      const v = Synth.getParamValue(row.dataset.path);
      if (row.update && typeof v === "number") row.update(v);
    });
  }

  function toggleSimple(force) {
    simpleMode = typeof force === "boolean" ? force : !simpleMode;
    const panel = document.getElementById("simple-panel");
    const rack = document.getElementById("rack");
    const btn = document.getElementById("simplify-toggle");
    panel.hidden = !simpleMode;
    btn.setAttribute("aria-pressed", String(simpleMode));
    btn.classList.toggle("btn-primary", simpleMode);
    btn.textContent = simpleMode ? "🔧 Advanced" : "✨ Simple";
    // hide the technical rack in simple mode (keep visualizers, hearing, keyboard, presets)
    if (rack) rack.style.display = simpleMode ? "none" : "";
    if (simpleMode) { buildSimplePanel(); refreshSimplePanel(); }
    announce(simpleMode ? "Simple mode on: plain-language sound controls." : "Advanced mode: full synth controls.");
  }

  /* ---------------- SEQUENCER grid ---------------- */
  let seqCells = [];
  function buildSequencer() {
    const grid = document.getElementById("seq-grid");
    if (!grid) return;
    grid.innerHTML = "";
    seqCells = [];
    for (let s = 0; s < 16; s++) {
      const cell = document.createElement("div");
      cell.className = "seq-cell" + (s % 4 === 0 ? " beat" : "");
      cell.dataset.step = s;
      cell.title = `step ${s + 1}`;
      grid.appendChild(cell);
      seqCells.push(cell);
    }
    // subscribe to composer events
    Composer.subscribe((topic, data) => {
      if (topic === "pattern") renderSequencer();
      if (topic === "step") highlightStep(data);
      if (topic === "playstate") updatePlayBtn(data);
    });
    renderSequencer();
  }

  function renderSequencer() {
    const p = Composer.getPattern();
    seqCells.forEach((cell) => { cell.classList.remove("has-note"); cell.innerHTML = ""; });
    if (p && p.steps) {
      // only first 16 steps shown (1 bar view)
      p.steps.filter((n) => n.step < 16).forEach((n) => {
        const cell = seqCells[n.step];
        if (cell) {
          cell.classList.add("has-note");
          const vel = document.createElement("div");
          vel.className = "vel";
          vel.style.height = `${Math.round(n.velocity * 100)}%`;
          cell.appendChild(vel);
        }
      });
      const info = document.getElementById("seq-info");
      if (info) info.textContent = `${p.bars}bar ${p.scale} · ${p.bpm}bpm · ${p.steps.length} notes · ${p.vibe}`;
    }
  }

  function highlightStep(step) {
    seqCells.forEach((c) => c.classList.remove("playing"));
    if (step >= 0 && step < 16 && seqCells[step]) seqCells[step].classList.add("playing");
  }

  function updatePlayBtn(playing) {
    const btn = document.getElementById("seq-play");
    if (btn) btn.textContent = playing ? "⏸" : "▶";
  }

  function wireSequencerControls() {
    const btn = document.getElementById("seq-play");
    if (btn) btn.addEventListener("click", () => {
      if (Composer.isPlaying()) Composer.stop();
      else {
        const ok = Composer.play();
        if (!ok) announce("No pattern yet. Ask your agent to compose one, or enable audio.");
      }
    });
    document.getElementById("bounce-btn")?.addEventListener("click", () => manualBounce());
    document.getElementById("dna-btn")?.addEventListener("click", () => manualDna());
    document.getElementById("vital-btn")?.addEventListener("click", () => manualVital());
  }

  function manualVital() {
    try {
      const name = (Composer.getPattern()?.vibe || "listen_patch").replace(/\s+/g, "_");
      const a = Synth.analyzeSound._last || null;
      const { blob, filename } = Vital.exportVital(name, { vibe: a?.summary || "" });
      Bounce.downloadBlob(blob, filename);
      addTake({ name: filename, type: "vital", blob });
      Activity.log("human", "export_vital_preset", filename);
      announce(`Vital preset ${filename} exported — load it in Vital in your DAW`);
    } catch (e) { console.error(e); announce("Vital export failed: " + e.message); }
  }

  async function manualBounce() {
    try {
      const wasPlaying = Composer.isPlaying();
      if (wasPlaying) Composer.stop();
      const pattern = Composer.getPattern();
      announce("Bouncing to WAV…");
      const res = await Bounce.renderToWav({});
      const fname = (pattern ? pattern.vibe : "sound").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sound";
      const filename = `${fname}_${res.bars}bar.wav`;
      Bounce.downloadBlob(res.blob, filename);
      addTake({ name: filename, type: "wav", blob: res.blob, durationS: res.durationS, bpm: res.bpm });
      Activity.log("human", "render_to_wav", filename);
      announce(`Bounced ${filename}`);
    } catch (e) { console.error(e); announce("Bounce failed: " + e.message); }
  }

  async function manualDna() {
    try {
      const a = Synth.analyzeSound();
      const name = (Composer.getPattern()?.vibe || "sound").replace(/\s+/g, "_");
      const card = DnaCard.generate({ name, vibe: a.summary || "" });
      const blob = await card.toPngBlob();
      const filename = `${name.toLowerCase()}_dna.png`;
      Bounce.downloadBlob(blob, filename);
      addTake({ name: filename, type: "png", blob, json: card.recipeJson });
      Activity.log("human", "generate_sound_card", filename);
      announce(`Sound DNA card ${filename} generated`);
    } catch (e) { console.error(e); announce("DNA card failed: " + e.message); }
  }

  /* ---------------- TAKES panel ---------------- */
  function addTake(take) {
    const list = document.getElementById("takes-list");
    if (!list) return;
    const empty = list.querySelector(".empty");
    if (empty) empty.remove();

    const li = document.createElement("li");
    li.className = "take-item";
    const url = URL.createObjectURL(take.blob);
    const meta = take.type === "wav"
      ? `${take.durationS.toFixed(1)}s · ${take.bpm}bpm`
      : take.type === "vital" ? "vital · daw preset"
      : "png · recipe";
    const icon = take.type === "wav" ? "🎵" : take.type === "vital" ? "🎛️" : "🧬";
    li.innerHTML =
      `<span class="take-icon">${icon}</span>` +
      `<span class="take-name">${Activity.escapeHtml(take.name)}</span>` +
      `<span class="take-meta">${meta}</span>`;
    const dl = document.createElement("a");
    dl.className = "take-dl"; dl.href = url; dl.download = take.name; dl.textContent = "⬇ save";
    li.appendChild(dl);
    list.prepend(li);
    // cap at 12 takes
    while (list.children.length > 12) list.lastChild.remove();
  }

  function initTakes() {
    const list = document.getElementById("takes-list");
    if (list && !list.children.length) list.innerHTML = `<li class="empty">Nothing bounced yet — your agent's audio + recipe cards land here.</li>`;
  }

  window.UI = {
    buildModules, buildKeyboard, refreshControls,
    startVisualizers, renderPresets, renderHearing, flashKey,
    wireComputerKeyboard, toggleSimple, refreshSimplePanel, announce,
    drawHearingRing, buildSequencer, renderSequencer, addTake,
    wireSequencerControls, initTakes,
    get simpleMode() { return simpleMode; },
  };
})();
