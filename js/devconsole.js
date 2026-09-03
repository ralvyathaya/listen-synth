/* devconsole.js — built-in Agent Console.
   Lets anyone test every WebMCP tool WITHOUT an external agent: it lists the
   live tools, auto-builds a form from each inputSchema, runs the call through
   the exact same executeTool path a real agent uses, and shows the result.
   Doubles as proof in the demo that the tools are real, not mock buttons. */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  let tools = [];
  let openToolName = null;

  async function refresh() {
    try { tools = await document.modelContext.getTools(); } catch (_) { tools = []; }
    renderList();
    const count = document.getElementById("ac-count");
    if (count) count.textContent = tools.length;
  }

  function renderList() {
    const list = document.getElementById("ac-tool-list");
    if (!list) return;
    list.innerHTML = "";
    tools.forEach((t) => {
      const li = document.createElement("li");
      li.className = "ac-tool" + (t.name === openToolName ? " open" : "");
      li.innerHTML = `<span class="ac-name">${esc(t.name)}</span>`;
      li.title = t.description || "";
      li.addEventListener("click", () => {
        openToolName = openToolName === t.name ? null : t.name;
        renderList();
        renderForm();
      });
      list.appendChild(li);
    });
  }

  function renderForm() {
    const pane = document.getElementById("ac-form");
    if (!pane) return;
    const tool = tools.find((t) => t.name === openToolName);
    if (!tool) {
      pane.innerHTML = `<p class="ac-dim">Pick a tool on the left — its form is generated from the same JSON Schema the agent sees.</p>`;
      return;
    }
    let schema = {};
    try { schema = typeof tool.inputSchema === "string" ? JSON.parse(tool.inputSchema) : (tool.inputSchema || {}); } catch (_) {}

    const props = schema.properties || {};
    const required = schema.required || [];
    let html = `<div class="ac-form-head"><span class="ac-form-title">${esc(tool.name)}</span></div>`;
    html += `<p class="ac-desc">${esc(tool.description || "")}</p>`;

    const keys = Object.keys(props);
    if (!keys.length) {
      html += `<p class="ac-dim">No inputs — just run it.</p>`;
    }
    keys.forEach((key) => {
      const p = props[key] || {};
      const type = Array.isArray(p.type) ? p.type[0] : p.type;
      const req = required.includes(key) ? " *" : "";
      const hint = p.description ? `<span class="ac-hint">${esc(p.description)}</span>` : "";
      html += `<label class="ac-field"><span class="ac-label">${esc(key)}${req} <em>${esc(type || "any")}</em></span>${hint}${fieldHtml(key, p, type)}</label>`;
    });
    html += `<div class="ac-actions"><button class="btn btn-primary ac-run">▶ Run tool</button></div>`;
    html += `<pre class="ac-result" id="ac-result"></pre>`;
    pane.innerHTML = html;

    pane.querySelector(".ac-run").addEventListener("click", () => runTool(tool, keys, props));
  }

  function fieldHtml(key, p, type) {
    if (p.enum) {
      return `<select class="ac-input" data-key="${esc(key)}">` +
        p.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("") + `</select>`;
    }
    if (type === "boolean") {
      return `<select class="ac-input" data-key="${esc(key)}" data-type="boolean"><option value="false">false</option><option value="true">true</option></select>`;
    }
    if (type === "integer" || type === "number") {
      return `<input class="ac-input" data-key="${esc(key)}" data-type="number" type="number" step="any" placeholder="${esc(key)}">`;
    }
    if (type === "object" || type === "array") {
      return `<textarea class="ac-input ac-json" data-key="${esc(key)}" data-type="${type}" rows="2" placeholder='JSON ${type}, e.g. ${type === "array" ? "[60,64,67]" : "{\"filter.cutoff\": 800}"}'></textarea>`;
    }
    return `<input class="ac-input" data-key="${esc(key)}" type="text" placeholder="${esc(key)}">`;
  }

  async function runTool(tool, keys, props) {
    const pane = document.getElementById("ac-form");
    const outEl = document.getElementById("ac-result");
    const args = {};
    pane.querySelectorAll(".ac-input").forEach((el) => {
      const key = el.dataset.key;
      const type = el.dataset.type;
      let v = el.value;
      if (v === "" || v == null) return;
      if (type === "number") v = parseFloat(v);
      else if (type === "boolean") v = v === "true";
      else if (type === "object" || type === "array") { try { v = JSON.parse(v); } catch (_) { /* keep raw */ } }
      args[key] = v;
    });

    outEl.textContent = "⏳ running…";
    outEl.classList.add("busy");
    const t0 = performance.now();
    try {
      const result = await executeViaAgentPath(tool, args);
      const ms = Math.round(performance.now() - t0);
      outEl.classList.remove("busy");
      outEl.textContent = `✓ ${ms}ms\n` + pretty(result);
    } catch (err) {
      outEl.classList.remove("busy");
      outEl.textContent = `✗ error: ${err.message}`;
    }
  }

  /* Execute through the exact path a real agent uses, with fallbacks. */
  async function executeViaAgentPath(tool, args) {
    // 1) spec path: document.modelContext.executeTool(tool, args)
    if (document.modelContext.executeTool) {
      try { return await document.modelContext.executeTool(tool, JSON.stringify(args)); }
      catch (_) { return await document.modelContext.executeTool(tool, args); }
    }
    // 2) polyfill testing shim
    if (navigator.modelContextTesting?.executeTool) {
      return await navigator.modelContextTesting.executeTool(tool.name, JSON.stringify(args));
    }
    throw new Error("No execution path available");
  }

  function pretty(r) {
    try {
      const obj = typeof r === "string" ? JSON.parse(r) : r;
      const text = obj?.content?.[0]?.text;
      if (text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; } }
      return JSON.stringify(obj, null, 2);
    } catch (_) { return String(r); }
  }

  /* quick scenarios: one-click end-to-end flows for the demo */
  function wireScenarios() {
    document.querySelectorAll("[data-scenario]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const s = btn.dataset.scenario;
        const find = (n) => tools.find((t) => t.name === n);
        try {
          if (s === "hear") {
            await executeViaAgentPath(find("play_note"), { note: "A2", durationMs: 2000 });
            await new Promise((r) => setTimeout(r, 400));
            await executeViaAgentPath(find("analyze_sound"), {});
          } else if (s === "darker") {
            await executeViaAgentPath(find("shape_sound"), { description: "darker and thicker" });
            await executeViaAgentPath(find("play_note"), { note: "A2", durationMs: 2000 });
            await new Promise((r) => setTimeout(r, 400));
            await executeViaAgentPath(find("analyze_sound"), {});
          } else if (s === "bounce") {
            await executeViaAgentPath(find("compose_pattern"), { vibe: "dark techno bassline", bars: 2 });
            await executeViaAgentPath(find("render_to_wav"), { bars: 2, name: "dark-techno-bass" });
          }
        } catch (e) { console.warn("scenario failed:", e); }
      });
    });
  }

  function toggle(force) {
    const drawer = document.getElementById("agent-console");
    const show = typeof force === "boolean" ? force : drawer.classList.contains("collapsed");
    drawer.classList.toggle("collapsed", !show);
    if (show) refresh();
  }

  function init() {
    document.getElementById("ac-toggle")?.addEventListener("click", () => toggle());
    document.getElementById("ac-close")?.addEventListener("click", () => toggle(false));
    document.getElementById("ac-refresh")?.addEventListener("click", () => refresh());
    try {
      document.modelContext.addEventListener("toolchange", () => {
        if (!document.getElementById("agent-console").classList.contains("collapsed")) refresh();
      });
    } catch (_) {}
    wireScenarios();
    renderForm();
  }

  window.DevConsole = { init, refresh, toggle };
})();
