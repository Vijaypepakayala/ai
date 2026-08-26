export const VOICE_MONITOR_UI_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telnyx Voice Monitor</title>
    <style>
      :root { color-scheme: light dark; --bg: #f6f8fb; --panel: #fff; --soft: #eef3f7; --text: #111827; --muted: #5b6472; --line: #d7dde6; --accent: #00a3a3; --accent-strong: #057474; --good: #16803c; --warn: #a46000; --bad: #b42318; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      @media (prefers-color-scheme: dark) { :root { --bg: #09111f; --panel: #101928; --soft: #142237; --text: #f8fafc; --muted: #aab7c7; --line: #27364b; --accent: #2dd4bf; --accent-strong: #5eead4; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; } }
      * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); } main { width: min(1160px, 100%); margin: 0 auto; padding: 22px; } header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; } h1 { margin: 0; font-size: 30px; } h2 { margin: 0; font-size: 16px; } h3 { margin: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } p { margin: 0; color: var(--muted); line-height: 1.5; } button, input, select { font: inherit; } button { min-height: 40px; border: 0; border-radius: 8px; padding: 0 13px; background: var(--accent); color: #042f2e; font-weight: 760; cursor: pointer; } button.secondary { border: 1px solid var(--line); background: var(--panel); color: var(--text); } button:disabled { cursor: progress; opacity: .65; } input, select { min-width: 0; min-height: 40px; border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; background: var(--panel); color: var(--text); } label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 720; } pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 430px; overflow: auto; }
      .eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .pill-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; } .pill { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); background: var(--panel); font-size: 12px; } .grid { display: grid; gap: 12px; } .summary { grid-template-columns: repeat(3, minmax(0, 1fr)); } .main-grid { grid-template-columns: minmax(0, 1fr) minmax(340px, .75fr); } .card, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 1px 2px rgba(15,23,42,.06); } .card { padding: 14px; } .panel { padding: 16px; } .value { margin-top: 8px; font-size: 24px; font-weight: 780; overflow-wrap: anywhere; } .meta { margin-top: 6px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; } .toolbar { display: grid; grid-template-columns: 1.5fr .8fr 1fr 1fr auto; gap: 10px; align-items: end; } .stack { display: grid; gap: 12px; } .actions { display: flex; flex-wrap: wrap; gap: 8px; } .error { padding: 12px; border-radius: 8px; background: color-mix(in srgb, var(--bad), transparent 88%); color: var(--bad); font-weight: 650; } .notice { padding: 12px; border-radius: 8px; background: var(--soft); color: var(--muted); } table { width: 100%; border-collapse: collapse; } th, td { padding: 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; } th { color: var(--muted); font-size: 12px; text-transform: uppercase; } .hidden { display: none; }
      @media (max-width: 900px) { header, .main-grid { display: grid; grid-template-columns: 1fr; } .pill-row { justify-content: flex-start; } .summary, .toolbar { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="eyebrow">Telnyx MCP App</div>
          <h1>Voice Monitor</h1>
          <p>Read-only active-call, call timeline, status, and recording discovery with preloaded Call Control App and SIP Connection choices.</p>
        </div>
        <div class="pill-row">
          <span class="pill" id="bridgeStatus">Host bridge: initializing</span>
          <span class="pill">Read-only</span>
          <span class="pill">No call-control mutations</span>
        </div>
      </header>

      <div id="error" class="error hidden"></div>

      <section class="grid summary" aria-label="Voice summary">
        <article class="card"><h3>Call Control Apps</h3><div class="value" id="connectionCount">-</div><div class="meta">loaded for dropdowns</div></article>
        <article class="card"><h3>Active Calls</h3><div class="value" id="activeCallCount">-</div><div class="meta" id="activeMeta">select a connection or discover</div></article>
        <article class="card"><h3>Selected</h3><div class="value" id="selectedValue">-</div><div class="meta">monitor target</div></article>
      </section>

      <section class="grid main-grid" style="margin-top: 12px;">
        <div class="stack">
          <article class="panel stack">
            <h2>Call Discovery</h2>
            <p class="meta">Use Call Control Apps for active calls, and SIP Connections for timeline or recording investigation.</p>
            <div class="toolbar">
              <label>Call Control App<select id="connectionSelect"><option value="">All discovered (bounded)</option></select></label>
              <label>SIP Connection<select id="sipConnectionSelect"><option value="">Any SIP connection</option></select></label>
              <label>ID type<select id="idTypeSelect"><option value="call_session_id">Session</option><option value="call_leg_id">Leg</option></select></label>
              <label>Call/session ID<input id="sessionInput" placeholder="paste selected ID type" /></label>
              <label>Call control ID<input id="callControlInput" placeholder="call_control_id" /></label>
              <button id="loadOptionsButton" type="button">Load options</button>
            </div>
            <div class="actions">
              <button id="activeCallsButton" type="button">Refresh active calls</button>
              <button class="secondary" id="timelineButton" type="button">Load timeline</button>
              <button class="secondary" id="statusButton" type="button">Get status</button>
              <button class="secondary" id="recordingsButton" type="button">Search recordings</button>
            </div>
          </article>

          <article class="panel">
            <h2>Active Calls</h2>
            <div style="overflow-x: auto;"><table><thead><tr><th>Connection</th><th>Call Control</th><th>State</th><th>Direction</th></tr></thead><tbody id="activeBody"></tbody></table></div>
          </article>
        </div>

        <div class="stack">
          <article class="panel stack">
            <h2>Manual JSON fallback</h2>
            <p class="meta">If the MCP Apps bridge cannot call tools, copy these arguments into the matching tool manually.</p>
            <pre id="fallbackPre">{}</pre>
          </article>
          <article class="panel stack">
            <h2>Raw Data</h2>
            <pre id="jsonPre">{}</pre>
          </article>
        </div>
      </section>
    </main>

    <script>
      const PROTOCOL_VERSION = "2026-01-26";
      let nextId = 1;
      const pending = new Map();
      const state = { options: null, latest: {} };
      const els = {
        bridgeStatus: document.getElementById("bridgeStatus"), error: document.getElementById("error"),
        connectionCount: document.getElementById("connectionCount"), activeCallCount: document.getElementById("activeCallCount"), activeMeta: document.getElementById("activeMeta"), selectedValue: document.getElementById("selectedValue"),
        connectionSelect: document.getElementById("connectionSelect"), sipConnectionSelect: document.getElementById("sipConnectionSelect"), idTypeSelect: document.getElementById("idTypeSelect"), sessionInput: document.getElementById("sessionInput"), callControlInput: document.getElementById("callControlInput"),
        loadOptionsButton: document.getElementById("loadOptionsButton"), activeCallsButton: document.getElementById("activeCallsButton"), timelineButton: document.getElementById("timelineButton"), statusButton: document.getElementById("statusButton"), recordingsButton: document.getElementById("recordingsButton"),
        activeBody: document.getElementById("activeBody"), fallbackPre: document.getElementById("fallbackPre"), jsonPre: document.getElementById("jsonPre")
      };
      function send(message) { window.parent.postMessage(message, "*"); }
      function notify(method, params) { send({ jsonrpc: "2.0", method, params }); }
      let resizePending = false;
      function resize() {
        if (resizePending) return;
        resizePending = true;
        requestAnimationFrame(() => {
          resizePending = false;
          const root = document.documentElement;
          notify("ui/notifications/size-changed", { width: Math.ceil(root.scrollWidth || window.innerWidth), height: Math.ceil(root.getBoundingClientRect().height) });
        });
      }
      function request(method, params) {
        const id = nextId++;
        send({ jsonrpc: "2.0", id, method, params });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 30000);
        });
      }
      async function callTool(name, args = {}) { return extractResult(await request("tools/call", { name, arguments: args })); }
      function extractResult(result) {
        if (result?.isError) throw new Error(result?.content?.find?.((block) => block.type === "text")?.text || "Tool request failed.");
        if (result?.structuredContent) return result.structuredContent;
        const text = result?.content?.find?.((block) => block.type === "text")?.text;
        if (!text) return result;
        try { return JSON.parse(text); } catch { return result; }
      }
      function setError(message) { els.error.textContent = message || ""; els.error.classList.toggle("hidden", !message); resize(); }
      function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
      function updateFallback() {
        const active_target_id = els.connectionSelect.value || undefined;
        const sip_connection_id = els.sipConnectionSelect.value || undefined;
        const id = els.sessionInput.value.trim();
        const call_control_id = els.callControlInput.value.trim();
        const idType = els.idTypeSelect.value;
        const args = {
          voice_monitor_active_calls: active_target_id ? { connection_id: active_target_id } : {},
          voice_monitor_call_timeline: { ...(sip_connection_id ? { connection_id: sip_connection_id } : {}), ...(id ? { [idType]: id } : {}) },
          voice_monitor_call_status: call_control_id ? { call_control_id } : { call_control_id: "<paste call_control_id>" },
          voice_monitor_recordings: { ...(sip_connection_id ? { connection_id: sip_connection_id } : {}), ...(call_control_id ? { call_control_id } : {}) }
        };
        els.selectedValue.textContent = sip_connection_id || active_target_id || "All";
        els.fallbackPre.textContent = JSON.stringify(args, null, 2);
      }
      function renderOptions(result) {
        state.options = result;
        const activeTargets = asArray(result?.options?.active_call_targets ?? result?.options?.call_control_applications);
        const sipConnections = asArray(result?.options?.connections);
        els.connectionSelect.replaceChildren(new Option("All Call Control Apps (bounded)", ""));
        for (const option of activeTargets) {
          const suffix = option.associated_number_count !== undefined ? " (" + option.associated_number_count + " numbers)" : "";
          els.connectionSelect.append(new Option((option.label || option.value) + suffix, option.value));
        }
        els.sipConnectionSelect.replaceChildren(new Option("Any SIP connection", ""));
        for (const option of sipConnections) {
          const detail = option.description ? " - " + option.description : "";
          const suffix = option.associated_number_count !== undefined ? " (" + option.associated_number_count + " numbers)" : "";
          els.sipConnectionSelect.append(new Option((option.label || option.value) + detail + suffix, option.value));
        }
        els.connectionCount.textContent = String(activeTargets.length);
        state.latest.options = result;
        renderJson(); updateFallback(); resize();
      }
      function renderActive(result) {
        const calls = asArray(result?.active_calls ?? result?.data);
        els.activeCallCount.textContent = String(result?.total_active_calls ?? calls.length);
        els.activeMeta.textContent = asArray(result?.connections_consulted).length + " connection(s) consulted";
        els.activeBody.replaceChildren();
        if (!calls.length) {
          const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 4; td.textContent = "No active calls returned."; tr.append(td); els.activeBody.append(tr);
        }
        for (const call of calls) {
          const tr = document.createElement("tr");
          [call?.connection_id, call?.call_control_id || call?.id, call?.state || call?.status || "-", call?.direction || "-"].forEach((value) => { const td = document.createElement("td"); td.textContent = value || "-"; tr.append(td); });
          els.activeBody.append(tr);
        }
        state.latest.active_calls = result; renderJson(); resize();
      }
      function renderJson() { els.jsonPre.textContent = JSON.stringify(state.latest, null, 2); }
      async function loadDashboard() {
        setError("");
        const dashboard = await callTool("voice_monitor_dashboard", { page_size: 100 });
        if (dashboard?.options) renderOptions(dashboard.options);
        if (dashboard?.active_calls) renderActive(dashboard.active_calls);
      }
      async function loadOptions() { setError(""); renderOptions(await callTool("voice_monitor_list_options", { page_size: 100 })); }
      async function loadActiveCalls() { setError(""); renderActive(await callTool("voice_monitor_active_calls", els.connectionSelect.value ? { connection_id: els.connectionSelect.value, page_size: 100 } : { page_size: 100 })); }
      async function loadTimeline() { const args = JSON.parse(els.fallbackPre.textContent).voice_monitor_call_timeline; state.latest.timeline = await callTool("voice_monitor_call_timeline", { ...args, page_size: 100 }); renderJson(); resize(); }
      async function loadStatus() { const id = els.callControlInput.value.trim(); if (!id) throw new Error("Enter a call_control_id first."); state.latest.status = await callTool("voice_monitor_call_status", { call_control_id: id }); renderJson(); resize(); }
      async function loadRecordings() { const args = JSON.parse(els.fallbackPre.textContent).voice_monitor_recordings; state.latest.recordings = await callTool("voice_monitor_recordings", { ...args, page_size: 50 }); renderJson(); resize(); }
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pending.has(message.id)) {
          const handlers = pending.get(message.id); pending.delete(message.id);
          if (message.error) handlers.reject(new Error(message.error.message || "Request failed")); else handlers.resolve(message.result);
        }
      });
      [els.connectionSelect, els.sipConnectionSelect, els.idTypeSelect, els.sessionInput, els.callControlInput].forEach((el) => el.addEventListener("input", updateFallback));
      els.connectionSelect.addEventListener("change", updateFallback);
      els.sipConnectionSelect.addEventListener("change", updateFallback);
      els.idTypeSelect.addEventListener("change", updateFallback);
      els.loadOptionsButton.addEventListener("click", () => loadOptions().catch((error) => setError(error.message || "Could not load options.")));
      els.activeCallsButton.addEventListener("click", () => loadActiveCalls().catch((error) => setError(error.message || "Could not load active calls.")));
      els.timelineButton.addEventListener("click", () => loadTimeline().catch((error) => setError(error.message || "Could not load timeline.")));
      els.statusButton.addEventListener("click", () => loadStatus().catch((error) => setError(error.message || "Could not load status.")));
      els.recordingsButton.addEventListener("click", () => loadRecordings().catch((error) => setError(error.message || "Could not load recordings.")));
      window.addEventListener("resize", resize);
      new ResizeObserver(resize).observe(document.documentElement);
      new ResizeObserver(resize).observe(document.body);
      updateFallback();
      request("ui/initialize", { appInfo: { name: "telnyx-voice-monitor-ui", version: "0.1.0" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION })
        .then(async () => { els.bridgeStatus.textContent = "Host bridge: connected"; notify("ui/notifications/initialized", {}); await loadDashboard(); })
        .catch((error) => { els.bridgeStatus.textContent = "Host bridge: unavailable"; setError("MCP App bridge unavailable; use the manual JSON fallback. " + error.message); });
    </script>
  </body>
</html>`;
