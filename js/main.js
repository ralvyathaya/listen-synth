/* main.js — bootstrap LISTEN. */
(function () {
  function detectWebMCP() {
    const badge = document.getElementById("webmcp-badge");
    const has = typeof document.modelContext !== "undefined" && !!document.modelContext?.registerTool;
    if (!badge) return has;
    badge.textContent = has ? "WebMCP: ready" : "WebMCP: unavailable";
    badge.className = "badge " + (has ? "badge-ok" : "badge-dim");
    if (has) badge.title = "document.modelContext available (native or @mcp-b/global polyfill)";
    return has;
  }

  function savePresetAs(name) {
    if (!name || !name.trim()) return result0("Preset name required.");
    const preset = Presets.saveCurrent(name.trim());
    Tools.registerPresetTool(preset);
    UI.renderPresets();
    Activity.refreshToolList();
    return result0(`Saved preset "${preset.name}". It's now available as the tool "load_preset__${Tools.slug(preset.name)}" — you (or the user) can call it anytime.`);
    function result0(t) { return { content: [{ type: "text", text: t }] }; }
  }

  window.App = { savePresetAs };

  function wireAudioStart() {
    const btn = document.getElementById("audio-start");
    const start = () => {
      if (Synth.ensureCtx()) {
        if (Synth.ctx.state === "suspended") Synth.ctx.resume();
        btn.textContent = "🔊 audio on";
        btn.classList.remove("btn-primary");
        btn.disabled = true;
      }
    };
    btn.addEventListener("click", start);
    // also start on first interaction anywhere (autoplay policy)
    window.addEventListener("pointerdown", function once() {
      if (!Synth.isStarted()) start();
      window.removeEventListener("pointerdown", once);
    });
  }

  function wireHearNow() {
    document.getElementById("hear-now").addEventListener("click", () => {
      const a = Synth.analyzeSound();
      UI.renderHearing(a);
      Activity.log("human", "analyze_sound", a.summary || a.error || "");
    });
    document.getElementById("simplify-toggle").addEventListener("click", () => UI.toggleSimple());
    // HUD toggle (game-style panel)
    const hud = document.getElementById("hud");
    const hudToggle = document.getElementById("hud-toggle");
    hudToggle.addEventListener("click", () => hud.classList.toggle("open"));
    // collapse HUD with Escape
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") hud.classList.remove("open"); });
    initHudDrag(hud);
  }

  /* ---------- HUD: draggable + minimizable + position memory ---------- */
  function initHudDrag(hud) {
    const grip = document.getElementById("hud-grip");
    const minBtn = document.getElementById("hud-min");
    if (!grip || !hud) return;

    const KEY = "listen-synth:hud-pos";
    const DEFAULT = { left: 16, top: null }; // null top = docked to bottom

    function save(pos) { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch (_) {} }
    function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } }

    function applyPos(pos) {
      if (!pos) { hud.style.left = ""; hud.style.top = ""; hud.style.right = ""; hud.style.bottom = ""; return; }
      hud.style.left = pos.left + "px";
      if (pos.top == null) { hud.style.top = ""; hud.style.bottom = "16px"; }
      else { hud.style.top = pos.top + "px"; hud.style.bottom = "auto"; }
      hud.style.right = "auto";
    }
    applyPos(load());

    // clamp inside viewport (handles zoom/resize: keep it reachable)
    function clampToViewport() {
      const r = hud.getBoundingClientRect();
      const pad = 4;
      let left = Math.min(Math.max(r.left, pad), window.innerWidth - r.width - pad);
      let top = Math.min(Math.max(r.top, pad), window.innerHeight - 60 - pad);
      hud.style.left = left + "px";
      hud.style.top = top + "px";
      hud.style.bottom = "auto";
      save({ left, top });
    }
    window.addEventListener("resize", () => { if (load()) clampToViewport(); });

    grip.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      hud.classList.add("dragging");
      const r = hud.getBoundingClientRect();
      const offX = e.clientX - r.left;
      const offY = e.clientY - r.top;

      const move = (ev) => {
        const pad = 4;
        let left = ev.clientX - offX;
        let top = ev.clientY - offY;
        left = Math.min(Math.max(left, pad - r.width + 60), window.innerWidth - 60); // allow slight offscreen but keep grip reachable
        top = Math.min(Math.max(top, pad), window.innerHeight - 40);
        hud.style.left = left + "px";
        hud.style.top = top + "px";
        hud.style.bottom = "auto";
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        hud.classList.remove("dragging");
        const r2 = hud.getBoundingClientRect();
        save({ left: r2.left, top: r2.top });
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });

    // double-click grip: snap back to default dock
    grip.addEventListener("dblclick", () => {
      save(null); try { localStorage.removeItem(KEY); } catch (_) {}
      applyPos(null);
      hud.style.bottom = "16px";
    });

    // minimize toggle
    minBtn.addEventListener("click", () => {
      const min = hud.classList.toggle("minimized");
      minBtn.textContent = min ? "+" : "–";
      minBtn.title = min ? "Expand panel" : "Collapse panel";
    });
  }

  function boot() {
    UI.buildModules();
    UI.buildKeyboard();
    UI.wireComputerKeyboard();
    UI.startVisualizers();
    UI.renderPresets();
    UI.buildSequencer();
    UI.wireSequencerControls();
    UI.initTakes();
    wireAudioStart();
    wireHearNow();
    DevConsole.init();
    Demo.init();

    // load a pleasing default preset so first impressions sound good
    const firstIdx = Presets.all().findIndex((p) => p.name === "E. Piano");
    const first = firstIdx >= 0 ? Presets.all()[firstIdx] : Presets.all()[0];
    if (first) {
      Presets.applyPreset(first);
      UI.refreshControls();
      // reflect in the LCD readout + active chip
      const bank = first.builtin ? `A${String(firstIdx + 1).padStart(2, "0")}` : `U${String(firstIdx + 1).padStart(2, "0")}`;
      const readout = document.getElementById("pu-readout");
      if (readout) readout.textContent = `${bank}  ${first.name.toUpperCase().replace(/ /g, "·")}`;
      const chip = document.querySelector(`[data-preset-name="${first.name}"]`);
      if (chip) chip.classList.add("active");
    }

    const ok = detectWebMCP();
    if (ok) {
      Tools.registerCoreTools().then(() => Tools.registerAllPresetTools());
      Tools.listenToolChange();
    } else {
      console.warn("WebMCP unavailable — synth still fully playable by hand.");
    }

    // reflect any patch change into knobs
    Synth.subscribe((topic) => { if (topic === "patch") UI.refreshControls(); });

    Activity.log("human", "session_start", "synth ready — say hi to your agent");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
