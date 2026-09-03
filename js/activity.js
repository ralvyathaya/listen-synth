/* activity.js — visual feed of every tool call + the live tool list. */
(function () {
  const feed = () => document.getElementById("activity-feed");
  const MAX = 60;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function log(actor, toolName, detail) {
    const el = feed();
    if (!el) return;
    const li = document.createElement("li");
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    li.innerHTML =
      `<span class="a-actor ${actor}">${actor === "agent" ? "🤖 agent" : "🧑 you"}</span>` +
      `<span class="a-tool">${escapeHtml(toolName)}</span>` +
      (detail ? `<span class="a-detail">${escapeHtml(detail)}</span>` : "") +
      `<span class="a-detail" style="opacity:.55">${time}</span>`;
    el.prepend(li);
    while (el.children.length > MAX) el.lastChild.remove();
  }

  async function refreshToolList() {
    const ul = document.getElementById("tool-list");
    const countEl = document.getElementById("tool-count");
    if (!ul) return;
    let tools = [];
    try { if (document.modelContext?.getTools) tools = await document.modelContext.getTools(); } catch (_) {}
    if (!tools.length && window.__toolRegistryMirror) tools = window.__toolRegistryMirror.list();

    ul.innerHTML = "";
    tools.forEach((t) => {
      const li = document.createElement("li");
      const kind = t.name.startsWith("load_preset__") ? "preset" : "core";
      li.innerHTML = `<span class="t-kind ${kind}">${kind}</span><span>${escapeHtml(t.name)}</span>`;
      li.title = t.description || "";
      ul.appendChild(li);
    });
    if (countEl) countEl.textContent = String(tools.length);
  }

  window.Activity = { log, refreshToolList, escapeHtml };
})();
