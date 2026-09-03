export const NUMBER_INTELLIGENCE_UI_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telnyx Number Intelligence</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f7f8fb;
        --panel: #ffffff;
        --panel-soft: #eef3f7;
        --text: #111827;
        --muted: #5b6472;
        --line: #d7dde6;
        --accent: #00a3a3;
        --accent-strong: #057474;
        --good: #16803c;
        --warn: #a46000;
        --bad: #b42318;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #09111f;
          --panel: #101928;
          --panel-soft: #142237;
          --text: #f8fafc;
          --muted: #aab7c7;
          --line: #27364b;
          --accent: #2dd4bf;
          --accent-strong: #5eead4;
          --good: #4ade80;
          --warn: #fbbf24;
          --bad: #f87171;
        }
      }

      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); }
      main { width: min(1120px, 100%); margin: 0 auto; padding: 22px; }
      header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
      h1 { margin: 0; font-size: 30px; line-height: 1.1; font-weight: 760; }
      h2 { margin: 0 0 12px; font-size: 15px; line-height: 1.25; }
      p { margin: 0; color: var(--muted); line-height: 1.5; }
      button, input { font: inherit; }
      button {
        min-height: 42px;
        border: 0;
        border-radius: 8px;
        padding: 0 14px;
        background: var(--accent);
        color: #042f2e;
        font-weight: 760;
        cursor: pointer;
      }
      button:disabled { cursor: progress; opacity: .7; }
      input {
        min-width: 0;
        min-height: 42px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0 12px;
        background: var(--panel);
        color: var(--text);
      }
      .eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      .toolbar { display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 10px; margin: 18px 0 12px; }
      .source-options { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 18px; }
      .checkbox { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .card, .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        box-shadow: 0 1px 2px rgba(15, 23, 42, .06);
      }
      .card { min-height: 104px; padding: 14px; }
      .panel { padding: 16px; }
      .label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      .value { margin-top: 8px; font-size: 20px; font-weight: 760; overflow-wrap: anywhere; }
      .meta { margin-top: 6px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
      .status-good, .status-info, .status-likely_supported { color: var(--good); }
      .status-warning, .status-unlikely_supported { color: var(--warn); }
      .status-bad, .status-error, .status-action_required { color: var(--bad); }
      .status-unknown { color: var(--muted); }
      .columns { display: grid; grid-template-columns: 1.15fr .85fr; gap: 12px; margin-top: 12px; }
      .list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .row { display: grid; gap: 3px; padding: 10px; border-radius: 8px; background: var(--panel-soft); }
      .row-title { font-weight: 720; }
      .row-detail { color: var(--muted); line-height: 1.45; }
      .pill-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
      .pill { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); font-size: 12px; background: var(--panel); }
      .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 12px; }
      .tab { min-height: 36px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 999px; }
      .tab[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #042f2e; }
      .empty { padding: 28px 16px; text-align: center; border: 1px dashed var(--line); border-radius: 8px; background: var(--panel); }
      .error { margin-top: 12px; color: var(--bad); font-weight: 650; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
      pre { overflow: auto; max-height: 300px; margin: 0; padding: 12px; border-radius: 8px; background: var(--panel-soft); color: var(--text); }
      .hidden { display: none; }

      @media (max-width: 820px) {
        main { padding: 16px; }
        header, .columns { grid-template-columns: 1fr; display: grid; }
        .pill-row { justify-content: flex-start; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .toolbar { grid-template-columns: 1fr; }
      }

      @media (max-width: 460px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="eyebrow">Telnyx MCP App</div>
          <h1>Number Intelligence</h1>
          <p>Carrier, line type, ownership/configuration readiness, cached reputation, and next actions.</p>
        </div>
        <div class="pill-row">
          <span class="pill" id="bridgeStatus">Host bridge: initializing</span>
          <span class="pill" id="modeStatus">Single number</span>
        </div>
      </header>

      <form class="toolbar" id="analyzeForm">
        <input id="phoneInput" name="phone" autocomplete="tel" aria-label="Phone number" placeholder="+13125550123" />
        <button id="analyzeButton" type="submit">Analyze</button>
      </form>

      <div class="source-options" aria-label="Source options">
        <label class="checkbox"><input type="checkbox" value="owned" checked /> owned</label>
        <label class="checkbox"><input type="checkbox" value="messaging" checked /> messaging</label>
        <label class="checkbox"><input type="checkbox" value="voice" checked /> voice</label>
        <label class="checkbox"><input type="checkbox" value="portability" /> portability</label>
        <label class="checkbox"><input type="checkbox" value="reputation" /> cached reputation</label>
      </div>

      <div class="error hidden" id="error"></div>

      <section id="emptyState" class="empty">
        <h2>Waiting for a number analysis</h2>
        <p>Run <strong>number_intelligence_analyze</strong> or <strong>number_intelligence_batch_analyze</strong> from your MCP host.</p>
      </section>

      <section id="resultView" class="hidden">
        <section class="grid" aria-label="Summary">
          <article class="card">
            <div class="label">Health</div>
            <div class="value" id="healthValue">Unknown</div>
            <div class="meta" id="healthMeta"></div>
          </article>
          <article class="card">
            <div class="label">Number</div>
            <div class="value" id="numberValue">redacted</div>
            <div class="meta" id="countryValue"></div>
          </article>
          <article class="card">
            <div class="label">Carrier / Type</div>
            <div class="value" id="carrierValue">Unknown</div>
            <div class="meta" id="ownershipValue"></div>
          </article>
          <article class="card">
            <div class="label">Messaging / Voice</div>
            <div class="value" id="messagingValue">Unknown</div>
            <div class="meta" id="voiceValue"></div>
          </article>
        </section>

        <div class="tabs" role="tablist">
          <button class="tab" data-tab="signalsPanel" aria-selected="true" type="button">Signals</button>
          <button class="tab" data-tab="actionsPanel" aria-selected="false" type="button">Actions</button>
          <button class="tab" data-tab="sourcesPanel" aria-selected="false" type="button">Sources</button>
          <button class="tab" data-tab="batchPanel" aria-selected="false" type="button">Batch</button>
          <button class="tab" data-tab="jsonPanel" aria-selected="false" type="button">JSON</button>
        </div>

        <section class="columns" id="singlePanels">
          <article class="panel" id="signalsPanel">
            <h2>Signals</h2>
            <ul class="list" id="signalsList"></ul>
          </article>
          <article class="panel hidden" id="actionsPanel">
            <h2>Recommended Actions</h2>
            <ul class="list" id="actionsList"></ul>
          </article>
          <article class="panel hidden" id="sourcesPanel">
            <h2>Sources</h2>
            <ul class="list" id="sourcesList"></ul>
          </article>
          <article class="panel hidden" id="batchPanel">
            <h2>Batch</h2>
            <div id="batchContent"></div>
          </article>
          <article class="panel hidden" id="jsonPanel">
            <h2>JSON</h2>
            <pre id="jsonPre"></pre>
          </article>
        </section>
      </section>
    </main>

    <script>
      const TOOL_NAME = "number_intelligence_analyze";
      const PROTOCOL_VERSION = "2026-01-26";
      let nextId = 1;
      const pending = new Map();
      let initialized = false;
      let currentResult;

      const els = {
        form: document.getElementById("analyzeForm"),
        button: document.getElementById("analyzeButton"),
        phone: document.getElementById("phoneInput"),
        error: document.getElementById("error"),
        empty: document.getElementById("emptyState"),
        result: document.getElementById("resultView"),
        bridgeStatus: document.getElementById("bridgeStatus"),
        modeStatus: document.getElementById("modeStatus"),
        healthValue: document.getElementById("healthValue"),
        healthMeta: document.getElementById("healthMeta"),
        numberValue: document.getElementById("numberValue"),
        countryValue: document.getElementById("countryValue"),
        carrierValue: document.getElementById("carrierValue"),
        ownershipValue: document.getElementById("ownershipValue"),
        messagingValue: document.getElementById("messagingValue"),
        voiceValue: document.getElementById("voiceValue"),
        signalsList: document.getElementById("signalsList"),
        actionsList: document.getElementById("actionsList"),
        sourcesList: document.getElementById("sourcesList"),
        batchContent: document.getElementById("batchContent"),
        jsonPre: document.getElementById("jsonPre")
      };

      function send(message) {
        window.parent.postMessage(message, "*");
      }

      function request(method, params) {
        const id = nextId++;
        send({ jsonrpc: "2.0", id, method, params });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            reject(new Error(method + " timed out"));
          }, 30000);
        });
      }

      function notify(method, params) {
        send({ jsonrpc: "2.0", method, params });
      }

      function resize() {
        notify("ui/notifications/size-changed", {
          width: Math.ceil(window.innerWidth),
          height: Math.ceil(document.documentElement.getBoundingClientRect().height)
        });
      }

      function text(value, fallback = "unknown") {
        return value === undefined || value === null || value === "" ? fallback : String(value);
      }

      function title(value) {
        return text(value).replaceAll("_", " ");
      }

      function safeClass(value) {
        return "status-" + text(value, "unknown").replace(/[^a-z0-9_]/gi, "_");
      }

      function setError(message) {
        els.error.textContent = message || "";
        els.error.classList.toggle("hidden", !message);
        resize();
      }

      function selectedSources() {
        return Array.from(document.querySelectorAll(".source-options input:checked")).map((box) => box.value);
      }

      function renderList(container, rows, emptyText, detailKeys = ["detail", "rationale", "tool_hint"]) {
        container.replaceChildren();
        if (!rows || rows.length === 0) {
          const li = document.createElement("li");
          li.className = "row";
          li.textContent = emptyText;
          container.append(li);
          return;
        }

        for (const row of rows) {
          const li = document.createElement("li");
          li.className = "row";
          const heading = document.createElement("div");
          heading.className = "row-title " + safeClass(row.status);
          heading.textContent = row.label || row.id || "Item";
          const detail = document.createElement("div");
          detail.className = "row-detail";
          detail.textContent = detailKeys.map((key) => row[key]).find(Boolean) || "";
          li.append(heading, detail);
          container.append(li);
        }
      }

      function renderResult(result) {
        currentResult = result;
        const isBatch = Array.isArray(result.results);
        const first = isBatch ? result.results[0] : result;
        const summary = first?.summary || {};
        const health = first?.health || {};
        els.empty.classList.add("hidden");
        els.result.classList.remove("hidden");
        els.modeStatus.textContent = isBatch ? "Batch: " + text(result.total, result.results.length) + " numbers" : "Single number";

        if (first?.normalized?.e164 || first?.display?.redacted) {
          els.phone.value = first.normalized?.e164 || first.display?.redacted || "";
        }

        els.healthValue.textContent = title(health.status) + (health.score !== undefined ? " · " + health.score : "");
        els.healthValue.className = "value " + safeClass(health.status);
        els.healthMeta.textContent = text(health.rationale, "");
        els.numberValue.textContent = text(first?.display?.label || first?.display?.redacted || first?.input?.phone_number, "redacted");
        els.countryValue.textContent = "Country: " + text(summary.country);
        els.carrierValue.textContent = text(summary.carrier) + " · " + title(summary.type);
        els.ownershipValue.textContent = "Ownership: " + text(summary.ownership);
        els.messagingValue.textContent = title(summary.messaging);
        els.messagingValue.className = "value " + safeClass(summary.messaging);
        els.voiceValue.textContent = "Voice: " + title(summary.voice) + " · Reputation: " + title(summary.reputation);

        renderList(els.signalsList, first?.signals, "No signals returned.");
        renderList(els.actionsList, first?.recommended_actions, "No recommended actions.", ["rationale", "tool_hint", "detail"]);
        renderList(els.sourcesList, first?.sources, "No sources returned.");
        renderBatch(result);
        els.jsonPre.textContent = JSON.stringify(result, null, 2);
        resize();
      }

      function renderBatch(result) {
        els.batchContent.replaceChildren();
        if (!Array.isArray(result.results)) {
          const p = document.createElement("p");
          p.className = "meta";
          p.textContent = "Batch aggregate appears after calling number_intelligence_batch_analyze.";
          els.batchContent.append(p);
          return;
        }

        const counts = result.aggregate?.health_status_counts || {};
        const summary = document.createElement("p");
        summary.className = "meta";
        summary.textContent = "Total: " + result.total + "; action-required signals: " + text(result.aggregate?.action_required_count, 0) + "; good/warning/bad/unknown: " + [counts.good || 0, counts.warning || 0, counts.bad || 0, counts.unknown || 0].join("/");

        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        const table = document.createElement("table");
        table.innerHTML = "<thead><tr><th>Number</th><th>Health</th><th>Messaging</th><th>Voice</th></tr></thead>";
        const tbody = document.createElement("tbody");
        for (const row of result.results) {
          const tr = document.createElement("tr");
          const values = [
            row.display?.label || row.display?.redacted || "redacted",
            row.health?.status || "unknown",
            row.summary?.messaging || "unknown",
            row.summary?.voice || "unknown"
          ];
          for (const value of values) {
            const td = document.createElement("td");
            td.textContent = value;
            if (value === values[1]) td.className = safeClass(value);
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(tbody);
        wrap.append(table);
        els.batchContent.append(summary, wrap);
      }

      function extractResult(result) {
        if (result?.structuredContent) return result.structuredContent;
        const textBlock = result?.content?.find?.((block) => block.type === "text");
        if (!textBlock?.text) return undefined;
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return undefined;
        }
      }

      async function analyze(phoneNumber) {
        if (!initialized) {
          setError("The host has not initialized the MCP App bridge yet.");
          return;
        }

        els.button.disabled = true;
        els.button.textContent = "Analyzing";
        setError("");
        try {
          const result = await request("tools/call", {
            name: TOOL_NAME,
            arguments: { phone_number: phoneNumber, include_raw: false, sources: selectedSources() }
          });
          const payload = extractResult(result);
          if (!payload) throw new Error("Tool returned no structured analysis.");
          renderResult(payload);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Analysis failed.");
        } finally {
          els.button.disabled = false;
          els.button.textContent = "Analyze";
        }
      }

      function showPanel(panelId) {
        for (const tab of document.querySelectorAll(".tab")) {
          tab.setAttribute("aria-selected", String(tab.dataset.tab === panelId));
        }
        for (const panel of ["signalsPanel", "actionsPanel", "sourcesPanel", "batchPanel", "jsonPanel"]) {
          document.getElementById(panel).classList.toggle("hidden", panel !== panelId);
        }
        resize();
      }

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;

        if (message.id !== undefined && pending.has(message.id)) {
          const handlers = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) handlers.reject(new Error(message.error.message || "Request failed"));
          else handlers.resolve(message.result);
          return;
        }

        if (message.method === "ui/notifications/tool-input") {
          const args = message.params?.arguments || {};
          if (args.phone_number) els.phone.value = args.phone_number;
        }

        if (message.method === "ui/notifications/tool-result") {
          const payload = extractResult(message.params);
          if (payload) renderResult(payload);
        }
      });

      els.form.addEventListener("submit", (event) => {
        event.preventDefault();
        const phoneNumber = els.phone.value.trim();
        if (!phoneNumber) {
          setError("Enter a phone number to analyze.");
          return;
        }
        analyze(phoneNumber);
      });

      for (const tab of document.querySelectorAll(".tab")) {
        tab.addEventListener("click", () => showPanel(tab.dataset.tab));
      }

      window.addEventListener("resize", resize);

      request("ui/initialize", {
        appInfo: { name: "telnyx-number-intelligence-ui", version: "0.2.0" },
        appCapabilities: {},
        protocolVersion: PROTOCOL_VERSION
      })
        .then(() => {
          initialized = true;
          els.bridgeStatus.textContent = "Host bridge: connected";
          notify("ui/notifications/initialized", {});
          resize();
        })
        .catch((error) => {
          els.bridgeStatus.textContent = "Host bridge: unavailable";
          setError("MCP App bridge failed to initialize: " + error.message);
        });

      if (currentResult) renderResult(currentResult);
    </script>
  </body>
</html>`;
