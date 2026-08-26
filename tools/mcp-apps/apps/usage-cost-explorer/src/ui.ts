export const USAGE_COST_EXPLORER_UI_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telnyx Billing Dashboard</title>
    <style>
      :root { color-scheme: light dark; --bg: #f6f8fb; --panel: #fff; --soft: #eef3f7; --text: #111827; --muted: #5b6472; --line: #d7dde6; --accent: #00a3a3; --accent-strong: #057474; --good: #16803c; --warn: #a46000; --bad: #b42318; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      @media (prefers-color-scheme: dark) { :root { --bg: #09111f; --panel: #101928; --soft: #142237; --text: #f8fafc; --muted: #aab7c7; --line: #27364b; --accent: #2dd4bf; --accent-strong: #5eead4; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; } }
      * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); } main { width: min(1180px, 100%); margin: 0 auto; padding: 22px; } header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; } h1 { margin: 0; font-size: 30px; line-height: 1.1; } h2 { margin: 0; font-size: 15px; line-height: 1.25; } h3 { margin: 0; font-size: 13px; color: var(--muted); font-weight: 760; text-transform: uppercase; letter-spacing: .04em; } p { margin: 0; color: var(--muted); line-height: 1.5; } button, input, select { font: inherit; } button { min-height: 40px; border: 0; border-radius: 8px; padding: 0 13px; background: var(--accent); color: #042f2e; font-weight: 760; cursor: pointer; } button.secondary { border: 1px solid var(--line); background: var(--panel); color: var(--text); } button.danger { background: var(--bad); color: #fff; } button:disabled { cursor: progress; opacity: .65; } input, select { min-width: 0; min-height: 40px; border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; background: var(--panel); color: var(--text); } label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 720; }
      .eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .pill-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; } .pill { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); background: var(--panel); font-size: 12px; } .grid { display: grid; gap: 10px; } .summary { grid-template-columns: repeat(4, minmax(0, 1fr)); } .main-grid { grid-template-columns: minmax(0, 1.45fr) minmax(330px, .8fr); margin-top: 12px; } .card, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 1px 2px rgba(15,23,42,.06); } .card { min-height: 104px; padding: 14px; } .panel { padding: 16px; } .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; } .value { margin-top: 8px; font-size: 22px; font-weight: 780; overflow-wrap: anywhere; } .meta { margin-top: 6px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; } .good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); } .toolbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; gap: 10px; margin-bottom: 12px; } .chart { width: 100%; height: 260px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); } .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; } th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } .stack { display: grid; gap: 12px; } .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; } .switch input { min-height: auto; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; } .preview { display: grid; gap: 8px; margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); } .diff { display: grid; grid-template-columns: minmax(80px, .7fr) 1fr 1fr; gap: 8px; font-size: 13px; } .empty { padding: 24px 16px; text-align: center; border: 1px dashed var(--line); border-radius: 8px; background: var(--panel); } .error { margin-bottom: 12px; color: var(--bad); font-weight: 650; } .hidden { display: none; }
      @media (max-width: 960px) { header, .main-grid { grid-template-columns: 1fr; display: grid; } .pill-row { justify-content: flex-start; } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 560px) { main { padding: 16px; } .summary, .toolbar, .form-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="eyebrow">Telnyx MCP App</div>
          <h1>Billing Dashboard</h1>
          <p>Current balance, usage, billing groups, and guarded auto-recharge settings in one workspace.</p>
        </div>
        <div class="pill-row">
          <span class="pill" id="bridgeStatus">Host bridge: initializing</span>
          <span class="pill warn">Usage Reports beta</span>
          <span class="pill">No direct payments</span>
        </div>
      </header>

      <div class="error hidden" id="error"></div>

      <section class="grid summary" aria-label="Billing summary">
        <article class="card"><h3>Balance</h3><div class="value" id="balanceValue">Loading</div><div class="meta" id="balanceMeta">available credit</div></article>
        <article class="card"><h3>Credit Limit</h3><div class="value" id="creditValue">Loading</div><div class="meta" id="creditMeta">pending and frozen</div></article>
        <article class="card"><h3>Auto Recharge</h3><div class="value" id="autoValue">Loading</div><div class="meta" id="autoMeta">threshold / amount</div></article>
        <article class="card"><h3>Billing Groups</h3><div class="value" id="groupsValue">Loading</div><div class="meta">IDs preserved for follow-up work</div></article>
      </section>

      <section class="grid main-grid">
        <div class="stack">
          <article class="panel">
            <div class="panel-head">
              <div><h2>Usage</h2><p class="meta">Select discovered report options, then refresh the chart.</p></div>
              <button class="secondary" id="refreshButton" type="button">Refresh</button>
            </div>
            <form class="toolbar" id="usageForm">
              <label>Product<select id="productSelect"></select></label>
              <label>Dimension<select id="dimensionSelect"></select></label>
              <label>Metric<select id="metricSelect"></select></label>
              <label>Range<select id="rangeSelect"><option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option><option value="today">Today</option><option value="yesterday">Yesterday</option></select></label>
              <button type="submit">Run</button>
            </form>
            <svg class="chart" id="usageChart" role="img" aria-label="Usage chart"></svg>
            <div class="meta" id="usageMeta">Waiting for usage data.</div>
          </article>

          <article class="panel">
            <div class="panel-head"><h2>Billing Groups</h2><button class="secondary" id="reloadGroupsButton" type="button">Reload</button></div>
            <div class="table-wrap"><table><thead><tr><th>Name</th><th>ID</th><th>Type</th></tr></thead><tbody id="groupsBody"></tbody></table></div>
          </article>
        </div>

        <div class="stack">
          <article class="panel">
            <div class="panel-head"><h2>Auto Recharge</h2><button class="secondary" id="reloadAutoButton" type="button">Reload</button></div>
            <form id="autoForm" class="stack">
              <div class="switch"><span>Enabled</span><input id="enabledInput" type="checkbox" /></div>
              <div class="switch"><span>Invoice enabled</span><input id="invoiceInput" type="checkbox" /></div>
              <div class="form-grid">
                <label>Threshold amount<input id="thresholdInput" inputmode="decimal" /></label>
                <label>Recharge amount<input id="rechargeInput" inputmode="decimal" /></label>
              </div>
              <label>Payment method<select id="preferenceSelect"><option value="credit_paypal">Card or PayPal</option><option value="ach">Bank transfer (ACH)</option></select><span class="meta" id="preferenceHelp">Uses the saved card or PayPal payment method.</span></label>
              <div class="actions">
                <button type="submit">Preview change</button>
                <button class="secondary" id="resetAutoButton" type="button">Reset</button>
              </div>
            </form>
            <section id="previewBox" class="preview hidden">
              <h3>Preview</h3>
              <div id="diffList"></div>
              <div class="actions">
                <button id="confirmAutoButton" type="button">Confirm update</button>
                <button class="secondary" id="cancelPreviewButton" type="button">Cancel</button>
              </div>
            </section>
          </article>

          <article class="panel">
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
      const state = { initialized: false, overview: {}, autoPatch: null, confirmationToken: null };

      const els = {
        bridgeStatus: document.getElementById("bridgeStatus"), error: document.getElementById("error"),
        balanceValue: document.getElementById("balanceValue"), balanceMeta: document.getElementById("balanceMeta"),
        creditValue: document.getElementById("creditValue"), creditMeta: document.getElementById("creditMeta"),
        autoValue: document.getElementById("autoValue"), autoMeta: document.getElementById("autoMeta"),
        groupsValue: document.getElementById("groupsValue"), groupsBody: document.getElementById("groupsBody"),
        productSelect: document.getElementById("productSelect"), dimensionSelect: document.getElementById("dimensionSelect"),
        metricSelect: document.getElementById("metricSelect"), rangeSelect: document.getElementById("rangeSelect"),
        usageChart: document.getElementById("usageChart"), usageMeta: document.getElementById("usageMeta"),
        usageForm: document.getElementById("usageForm"), refreshButton: document.getElementById("refreshButton"),
        enabledInput: document.getElementById("enabledInput"), invoiceInput: document.getElementById("invoiceInput"),
        thresholdInput: document.getElementById("thresholdInput"), rechargeInput: document.getElementById("rechargeInput"),
        preferenceSelect: document.getElementById("preferenceSelect"), autoForm: document.getElementById("autoForm"),
        reloadAutoButton: document.getElementById("reloadAutoButton"), reloadGroupsButton: document.getElementById("reloadGroupsButton"),
        resetAutoButton: document.getElementById("resetAutoButton"), previewBox: document.getElementById("previewBox"),
        diffList: document.getElementById("diffList"), confirmAutoButton: document.getElementById("confirmAutoButton"),
        cancelPreviewButton: document.getElementById("cancelPreviewButton"), jsonPre: document.getElementById("jsonPre")
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
          const previousHeight = root.style.height;
          root.style.height = "max-content";
          const height = Math.ceil(root.getBoundingClientRect().height);
          root.style.height = previousHeight;
          notify("ui/notifications/size-changed", { width: Math.ceil(root.scrollWidth || window.innerWidth), height });
        });
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
      async function callTool(name, args = {}) { return extractResult(await request("tools/call", { name, arguments: args })); }
      function extractResult(result) {
        if (result?.isError) {
          const textBlock = result?.content?.find?.((block) => block.type === "text");
          throw new Error(textBlock?.text || "Tool request failed.");
        }
        if (result?.structuredContent) return result.structuredContent;
        const textBlock = result?.content?.find?.((block) => block.type === "text");
        if (!textBlock?.text) return result;
        try { return JSON.parse(textBlock.text); } catch { return result; }
      }
      function setError(message) { els.error.textContent = message || ""; els.error.classList.toggle("hidden", !message); resize(); }
      function dataOf(envelope) { return envelope?.data ?? envelope; }
      function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
      function fmtMoney(value, currency) { return value === undefined || value === null || value === "" ? "-" : (currency ? value + " " + currency : String(value)); }
      function unique(values) { return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))]; }
      function optionValues(options, keys, fallback) {
        const data = dataOf(options) || {};
        if (Array.isArray(data)) return fallback;
        for (const key of keys) {
          const value = data[key];
          if (Array.isArray(value)) return unique(value.map((item) => typeof item === "string" ? item : item?.name || item?.id || item?.value));
          if (value && typeof value === "object") return unique(Object.keys(value));
        }
        return fallback;
      }
      function fillSelect(select, values, preferred) {
        const current = select.value;
        select.replaceChildren();
        for (const value of unique(values)) select.append(new Option(value, value));
        select.value = values.includes(current) ? current : values.includes(preferred) ? preferred : values[0] || "";
      }
      function renderOverview(overview) {
        state.overview = { ...state.overview, ...overview };
        const balance = dataOf(state.overview.balance);
        const auto = dataOf(state.overview.auto_recharge);
        const groups = asArray(dataOf(state.overview.billing_groups));
        const currency = balance?.currency;
        els.balanceValue.textContent = fmtMoney(balance?.balance, currency);
        els.balanceMeta.textContent = "available " + fmtMoney(balance?.available_credit, currency);
        els.creditValue.textContent = fmtMoney(balance?.credit_limit, currency);
        els.creditMeta.textContent = "pending " + fmtMoney(balance?.pending, currency) + "; frozen " + fmtMoney(balance?.frozen, currency);
        renderAuto(auto);
        renderGroups(groups);
        renderOptions(state.overview.usage_options);
        if (state.overview.warnings?.length) {
          els.usageMeta.textContent = state.overview.warnings.map((warning) => warning.source + ": " + warning.message).join("; ");
        }
        els.jsonPre.textContent = JSON.stringify(state.overview, null, 2);
        resize();
      }
      function renderAuto(auto) {
        els.autoValue.textContent = auto ? (auto.enabled ? "Enabled" : "Disabled") : "-";
        els.autoValue.className = "value " + (auto?.enabled ? "good" : "warn");
        els.autoMeta.textContent = auto ? "threshold " + fmtMoney(auto.threshold_amount) + "; recharge " + fmtMoney(auto.recharge_amount) : "threshold / amount";
        if (!auto) return;
        els.enabledInput.checked = Boolean(auto.enabled);
        els.invoiceInput.checked = Boolean(auto.invoice_enabled);
        els.thresholdInput.value = auto.threshold_amount ?? "";
        els.rechargeInput.value = auto.recharge_amount ?? "";
        if (auto.preference && !Array.from(els.preferenceSelect.options).some((option) => option.value === auto.preference)) {
          els.preferenceSelect.append(new Option(auto.preference, auto.preference));
        }
        els.preferenceSelect.value = auto.preference || els.preferenceSelect.value;
        renderPreferenceHelp();
      }
      function renderGroups(groups) {
        els.groupsValue.textContent = String(groups.length);
        els.groupsBody.replaceChildren();
        if (!groups.length) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 3;
          td.textContent = "No billing groups returned.";
          tr.append(td);
          els.groupsBody.append(tr);
          return;
        }
        for (const group of groups) {
          const tr = document.createElement("tr");
          for (const value of [group.name || "Unnamed", group.id || "-", group.record_type || "billing_group"]) {
            const td = document.createElement("td");
            td.textContent = value;
            tr.append(td);
          }
          els.groupsBody.append(tr);
        }
      }
      function renderOptions(options) {
        const rows = asArray(dataOf(options));
        const products = rows.length ? unique(rows.map((row) => row.product)) : optionValues(options, ["products", "product"], ["messaging"]);
        fillSelect(els.productSelect, products, "messaging");
        renderProductOptions();
      }
      function renderProductOptions() {
        const rows = asArray(dataOf(state.overview.usage_options));
        const row = rows.find((item) => item?.product === els.productSelect.value) || rows[0];
        const recordTypes = asArray(row?.record_types);
        const dimensions = unique([...(row?.product_dimensions || []), ...recordTypes.flatMap((record) => record.product_dimensions || [])]);
        const metrics = unique([...(row?.product_metrics || []), ...recordTypes.flatMap((record) => record.product_metrics || [])]);
        fillSelect(els.dimensionSelect, dimensions.length ? dimensions : ["date"], "date");
        fillSelect(els.metricSelect, metrics.length ? metrics : ["cost"], "cost");
      }
      function renderUsage(result) {
        const rows = asArray(dataOf(result));
        const metric = els.metricSelect.value;
        const dimension = els.dimensionSelect.value;
        const points = rows.map((row, index) => ({ label: String(row?.[dimension] ?? row?.date ?? row?.period ?? index + 1), value: Number(row?.[metric] ?? row?.cost ?? row?.count ?? 0) })).filter((point) => Number.isFinite(point.value));
        drawChart(points);
        els.usageMeta.textContent = points.length ? points.length + " rows; metric " + metric + " by " + dimension + "." : "No usage rows returned for this query.";
        state.overview.usage = result;
        els.jsonPre.textContent = JSON.stringify(state.overview, null, 2);
        resize();
      }
      function drawChart(points) {
        const svg = els.usageChart;
        const width = 760, height = 260, pad = 34;
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.replaceChildren();
        const max = Math.max(1, ...points.map((point) => point.value));
        const barWidth = points.length ? Math.max(8, (width - pad * 2) / points.length - 6) : 0;
        const axis = document.createElementNS("http://www.w3.org/2000/svg", "path");
        axis.setAttribute("d", "M" + pad + " " + (height - pad) + "H" + (width - pad) + "M" + pad + " " + pad + "V" + (height - pad));
        axis.setAttribute("stroke", "var(--line)");
        axis.setAttribute("fill", "none");
        svg.append(axis);
        if (!points.length) {
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(width / 2)); text.setAttribute("y", String(height / 2)); text.setAttribute("text-anchor", "middle"); text.setAttribute("fill", "var(--muted)");
          text.textContent = "No usage data";
          svg.append(text);
          return;
        }
        points.slice(0, 40).forEach((point, index) => {
          const x = pad + index * ((width - pad * 2) / Math.min(points.length, 40)) + 3;
          const h = Math.max(2, (point.value / max) * (height - pad * 2));
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", String(x)); rect.setAttribute("y", String(height - pad - h)); rect.setAttribute("width", String(barWidth)); rect.setAttribute("height", String(h)); rect.setAttribute("rx", "3"); rect.setAttribute("fill", "var(--accent)");
          const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
          title.textContent = point.label + ": " + point.value;
          rect.append(title);
          svg.append(rect);
        });
      }
      function patchFromForm() {
        return {
          enabled: els.enabledInput.checked,
          invoice_enabled: els.invoiceInput.checked,
          threshold_amount: els.thresholdInput.value.trim(),
          recharge_amount: els.rechargeInput.value.trim(),
          preference: els.preferenceSelect.value
        };
      }
      function renderPreferenceHelp() {
        const descriptions = {
          credit_paypal: "Uses the saved card or PayPal payment method.",
          ach: "Uses a linked US bank account through ACH."
        };
        const help = document.getElementById("preferenceHelp");
        if (help) help.textContent = descriptions[els.preferenceSelect.value] || "";
      }
      function renderPreview(preview, patch) {
        state.autoPatch = patch;
        state.confirmationToken = preview.confirmation_token;
        els.previewBox.classList.remove("hidden");
        els.diffList.replaceChildren();
        for (const item of preview.diff || []) {
          const row = document.createElement("div");
          row.className = "diff";
          row.replaceChildren(textNode(item.field), textNode(String(item.before ?? "-")), textNode(String(item.after ?? "-")));
          els.diffList.append(row);
        }
        if (!preview.diff?.length) els.diffList.textContent = "No field changes detected.";
        resize();
      }
      function textNode(value) { const div = document.createElement("div"); div.textContent = value; return div; }
      async function loadOverview() {
        setError("");
        const overview = await callTool("billing_overview");
        renderOverview(overview);
      }
      async function loadUsage() {
        const product = els.productSelect.value;
        const dimension = els.dimensionSelect.value;
        const metric = els.metricSelect.value;
        if (!product || !dimension || !metric) return;
        try {
          renderUsage(await callTool("billing_query_usage", { product, dimensions: [dimension], metrics: [metric], date_range: els.rangeSelect.value, page_size: 100 }));
        } catch (error) {
          drawChart([]);
          els.usageMeta.textContent = error.message || "Usage query failed.";
          resize();
        }
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
        if (message.method === "ui/notifications/tool-result") {
          const payload = extractResult(message.params);
          if (payload?.balance || payload?.auto_recharge || payload?.billing_groups) renderOverview(payload);
        }
      });

      els.refreshButton.addEventListener("click", () => loadOverview().then(loadUsage).catch((error) => setError(error.message || "Refresh failed.")));
      els.reloadGroupsButton.addEventListener("click", async () => {
        try { renderOverview({ billing_groups: await callTool("billing_list_billing_groups", { page_size: 100 }) }); } catch (error) { setError(error.message || "Could not load billing groups."); }
      });
      els.reloadAutoButton.addEventListener("click", async () => {
        try { renderOverview({ auto_recharge: await callTool("billing_get_auto_recharge_preferences") }); } catch (error) { setError(error.message || "Could not load auto recharge."); }
      });
      els.resetAutoButton.addEventListener("click", () => renderAuto(dataOf(state.overview.auto_recharge)));
      els.cancelPreviewButton.addEventListener("click", () => { state.autoPatch = null; state.confirmationToken = null; els.previewBox.classList.add("hidden"); resize(); });
      els.usageForm.addEventListener("submit", (event) => {
        event.preventDefault();
        loadUsage().catch((error) => setError(error.message || "Usage query failed."));
      });
      els.productSelect.addEventListener("change", renderProductOptions);
      els.preferenceSelect.addEventListener("change", renderPreferenceHelp);
      els.autoForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const patch = patchFromForm();
          renderPreview(await callTool("billing_preview_auto_recharge_update", patch), patch);
        } catch (error) { setError(error.message || "Preview failed."); }
      });
      els.confirmAutoButton.addEventListener("click", async () => {
        if (!state.autoPatch || !state.confirmationToken) return;
        try {
          const result = await callTool("billing_update_auto_recharge_preferences", { ...state.autoPatch, confirmation_token: state.confirmationToken });
          els.previewBox.classList.add("hidden");
          state.autoPatch = null; state.confirmationToken = null;
          renderOverview({ auto_recharge: result });
        } catch (error) { setError(error.message || "Update failed."); }
      });
      window.addEventListener("resize", resize);
      new ResizeObserver(resize).observe(document.documentElement);
      new ResizeObserver(resize).observe(document.body);

      request("ui/initialize", { appInfo: { name: "telnyx-billing-dashboard-ui", version: "0.2.0" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION })
        .then(async () => {
          state.initialized = true;
          els.bridgeStatus.textContent = "Host bridge: connected";
          notify("ui/notifications/initialized", {});
          await loadOverview();
          renderPreferenceHelp();
          await loadUsage();
        })
        .catch((error) => {
          els.bridgeStatus.textContent = "Host bridge: unavailable";
          setError("MCP App bridge failed to initialize: " + error.message);
          renderOptions();
          drawChart([]);
        });
    </script>
  </body>
</html>`;

export const STORED_PAYMENT_TOP_UP_UI_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telnyx Stored Payment Top Up</title>
    <style>
      :root { color-scheme: light dark; --bg: #f6f8fb; --panel: #fff; --soft: #eef3f7; --text: #111827; --muted: #5b6472; --line: #d7dde6; --accent: #00a3a3; --accent-strong: #057474; --good: #16803c; --warn: #a46000; --bad: #b42318; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      @media (prefers-color-scheme: dark) { :root { --bg: #09111f; --panel: #101928; --soft: #142237; --text: #f8fafc; --muted: #aab7c7; --line: #27364b; --accent: #2dd4bf; --accent-strong: #5eead4; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; } }
      * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); } main { width: min(720px, 100%); margin: 0 auto; padding: 22px; } h1 { margin: 0; font-size: 30px; line-height: 1.1; } h2 { margin: 0; font-size: 16px; } h3 { margin: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } p { margin: 0; color: var(--muted); line-height: 1.5; } button, input { font: inherit; } button { min-height: 42px; border: 0; border-radius: 8px; padding: 0 14px; background: var(--accent); color: #042f2e; font-weight: 760; cursor: pointer; } button.secondary { border: 1px solid var(--line); background: var(--panel); color: var(--text); } button:disabled { cursor: progress; opacity: .65; } input { min-width: 0; min-height: 42px; border: 1px solid var(--line); border-radius: 8px; padding: 0 11px; background: var(--panel); color: var(--text); } label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 720; }
      header { display: grid; gap: 10px; margin-bottom: 14px; } .eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .pill-row { display: flex; flex-wrap: wrap; gap: 8px; } .pill { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); background: var(--panel); font-size: 12px; } .card, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 1px 2px rgba(15,23,42,.06); } .card { padding: 14px; } .panel { padding: 16px; margin-top: 12px; } .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .value { margin-top: 7px; font-size: 24px; font-weight: 780; overflow-wrap: anywhere; } .meta { margin-top: 6px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; } .stack { display: grid; gap: 12px; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; } .preview { display: grid; gap: 8px; margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); } .notice { padding: 12px; border-radius: 8px; background: var(--soft); color: var(--muted); } .error { margin-top: 12px; color: var(--bad); font-weight: 650; } .success { color: var(--good); } .hidden { display: none; }
      @media (max-width: 560px) { main { padding: 16px; } .summary { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="eyebrow">Telnyx Billing</div>
        <h1>Top Up Balance</h1>
        <p>Charge a saved payment method from the Telnyx portal to add credit to this account. The payment is previewed first and only submitted after confirmation.</p>
        <div class="pill-row">
          <span class="pill" id="bridgeStatus">Host bridge: initializing</span>
          <span class="pill">Saved payment method</span>
          <span class="pill">Preview required</span>
        </div>
      </header>

      <section class="summary">
        <article class="card"><h3>Balance</h3><div class="value" id="balanceValue">Loading</div><div class="meta" id="balanceMeta">available credit</div></article>
        <article class="card"><h3>Pending</h3><div class="value" id="pendingValue">Loading</div><div class="meta">current pending balance activity</div></article>
      </section>

      <section class="panel">
        <div class="notice">This creates a stored payment transaction using the payment method already saved in the Telnyx portal.</div>
        <form id="topUpForm" class="stack">
          <label>Top-up amount<input id="amountInput" inputmode="decimal" value="25.00" /></label>
          <div class="actions">
            <button id="previewButton" type="submit">Preview payment</button>
            <button class="secondary" id="reloadButton" type="button">Reload balance</button>
          </div>
        </form>
        <div class="notice hidden" id="status"></div>
        <div class="error hidden" id="error"></div>
      </section>

      <section id="previewBox" class="preview hidden">
        <h2>Confirm Stored Payment</h2>
        <p id="previewText"></p>
        <div class="actions">
          <button id="confirmButton" type="button">Submit payment</button>
          <button class="secondary" id="cancelButton" type="button">Cancel</button>
        </div>
      </section>

      <section id="resultBox" class="preview hidden">
        <h2>Payment Submitted</h2>
        <div id="resultText" class="success"></div>
      </section>
    </main>
    <script>
      const PROTOCOL_VERSION = "2026-01-26";
      let nextId = 1;
      const pending = new Map();
      const state = { amount: null, token: null };
      const els = {
        bridgeStatus: document.getElementById("bridgeStatus"), error: document.getElementById("error"), status: document.getElementById("status"),
        balanceValue: document.getElementById("balanceValue"), balanceMeta: document.getElementById("balanceMeta"), pendingValue: document.getElementById("pendingValue"),
        amountInput: document.getElementById("amountInput"), topUpForm: document.getElementById("topUpForm"), previewButton: document.getElementById("previewButton"),
        reloadButton: document.getElementById("reloadButton"), previewBox: document.getElementById("previewBox"), previewText: document.getElementById("previewText"),
        confirmButton: document.getElementById("confirmButton"), cancelButton: document.getElementById("cancelButton"), resultBox: document.getElementById("resultBox"), resultText: document.getElementById("resultText")
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
          const previousHeight = root.style.height;
          root.style.height = "max-content";
          const height = Math.ceil(root.getBoundingClientRect().height);
          root.style.height = previousHeight;
          notify("ui/notifications/size-changed", { width: Math.ceil(root.scrollWidth || window.innerWidth), height });
        });
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
      async function callTool(name, args = {}) { return extractResult(await request("tools/call", { name, arguments: args })); }
      function extractResult(result) {
        if (result?.isError) {
          const textBlock = result?.content?.find?.((block) => block.type === "text");
          throw new Error(textBlock?.text || "Tool request failed.");
        }
        if (result?.structuredContent) return result.structuredContent;
        const textBlock = result?.content?.find?.((block) => block.type === "text");
        if (!textBlock?.text) return result;
        try { return JSON.parse(textBlock.text); } catch { return result; }
      }
      function dataOf(envelope) { return envelope?.data ?? envelope; }
      function fmtMoney(value, currency) { return value === undefined || value === null || value === "" ? "-" : (currency ? value + " " + currency : String(value)); }
      function setError(message) { els.error.textContent = message || ""; els.error.classList.toggle("hidden", !message); resize(); }
      function setStatus(message) { els.status.textContent = message || ""; els.status.classList.toggle("hidden", !message); resize(); }
      function renderBalance(payload) {
        const balance = dataOf(payload?.balance);
        const currency = balance?.currency;
        els.balanceValue.textContent = fmtMoney(balance?.balance, currency);
        els.balanceMeta.textContent = "available " + fmtMoney(balance?.available_credit, currency);
        els.pendingValue.textContent = fmtMoney(balance?.pending, currency);
        resize();
      }
      async function loadState() { renderBalance(await callTool("billing_stored_payment_top_up")); }
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pending.has(message.id)) {
          const handlers = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) handlers.reject(new Error(message.error.message || "Request failed"));
          else handlers.resolve(message.result);
        }
      });
      els.topUpForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError(""); setStatus("Creating payment preview..."); els.resultBox.classList.add("hidden");
        els.previewButton.disabled = true;
        const previousText = els.previewButton.textContent;
        els.previewButton.textContent = "Previewing";
        try {
          const amount = els.amountInput.value.trim();
          const preview = await callTool("billing_preview_stored_payment_transaction", { amount });
          state.amount = amount; state.token = preview.confirmation_token;
          els.previewText.textContent = "Submit a stored payment transaction for " + amount + "?";
          els.previewBox.classList.remove("hidden");
          setStatus("Preview ready. Confirm to submit the payment.");
        } catch (error) { setStatus(""); setError(error.message || "Preview failed."); }
        finally { els.previewButton.disabled = false; els.previewButton.textContent = previousText; }
      });
      els.confirmButton.addEventListener("click", async () => {
        if (!state.amount || !state.token) return;
        setError(""); setStatus("Submitting payment...");
        els.confirmButton.disabled = true;
        const previousText = els.confirmButton.textContent;
        els.confirmButton.textContent = "Submitting";
        try {
          const result = await callTool("billing_create_stored_payment_transaction", { amount: state.amount, confirmation_token: state.token });
          const transaction = dataOf(result);
          state.amount = null; state.token = null;
          els.previewBox.classList.add("hidden");
          els.resultBox.classList.remove("hidden");
          els.resultText.textContent = "Transaction " + (transaction?.id || "submitted") + " is " + (transaction?.processor_status || "submitted") + ".";
          setStatus("Stored payment transaction submitted.");
          await loadState().catch(() => {});
        } catch (error) { setStatus(""); setError(error.message || "Payment failed."); }
        finally { els.confirmButton.disabled = false; els.confirmButton.textContent = previousText; }
      });
      els.cancelButton.addEventListener("click", () => { state.amount = null; state.token = null; els.previewBox.classList.add("hidden"); setStatus(""); resize(); });
      els.reloadButton.addEventListener("click", () => { setStatus("Reloading balance..."); loadState().then(() => setStatus("Balance reloaded.")).catch((error) => setError(error.message || "Reload failed.")); });
      window.addEventListener("resize", resize);
      new ResizeObserver(resize).observe(document.documentElement);
      new ResizeObserver(resize).observe(document.body);
      request("ui/initialize", { appInfo: { name: "telnyx-stored-payment-top-up-ui", version: "0.1.0" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION })
        .then(async () => {
          els.bridgeStatus.textContent = "Host bridge: connected";
          notify("ui/notifications/initialized", {});
          await loadState();
        })
        .catch((error) => {
          els.bridgeStatus.textContent = "Host bridge: unavailable";
          setError("MCP App bridge failed to initialize: " + error.message);
        });
    </script>
  </body>
</html>`;

export const AUTO_RECHARGE_SETUP_UI_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telnyx Auto Recharge Setup</title>
    <style>
      :root { color-scheme: light dark; --bg: #f6f8fb; --panel: #fff; --soft: #eef3f7; --text: #111827; --muted: #5b6472; --line: #d7dde6; --accent: #00a3a3; --accent-strong: #057474; --good: #16803c; --warn: #a46000; --bad: #b42318; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      @media (prefers-color-scheme: dark) { :root { --bg: #09111f; --panel: #101928; --soft: #142237; --text: #f8fafc; --muted: #aab7c7; --line: #27364b; --accent: #2dd4bf; --accent-strong: #5eead4; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; } }
      * { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); } main { width: min(760px, 100%); margin: 0 auto; padding: 22px; } h1 { margin: 0; font-size: 30px; line-height: 1.1; } h2 { margin: 0; font-size: 16px; } h3 { margin: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; } p { margin: 0; color: var(--muted); line-height: 1.5; } button, input, select { font: inherit; } button { min-height: 42px; border: 0; border-radius: 8px; padding: 0 14px; background: var(--accent); color: #042f2e; font-weight: 760; cursor: pointer; } button.secondary { border: 1px solid var(--line); background: var(--panel); color: var(--text); } button:disabled { cursor: progress; opacity: .65; } input, select { min-width: 0; min-height: 42px; border: 1px solid var(--line); border-radius: 8px; padding: 0 11px; background: var(--panel); color: var(--text); } label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 720; }
      header { display: grid; gap: 10px; margin-bottom: 14px; } .eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .pill-row { display: flex; flex-wrap: wrap; gap: 8px; } .pill { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); background: var(--panel); font-size: 12px; } .card, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 1px 2px rgba(15,23,42,.06); } .card { padding: 14px; } .panel { padding: 16px; margin-top: 12px; } .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .value { margin-top: 7px; font-size: 24px; font-weight: 780; overflow-wrap: anywhere; } .meta { margin-top: 6px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; } .good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); } .stack { display: grid; gap: 12px; } .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; } .switch input { min-height: auto; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; } .preview { display: grid; gap: 8px; margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); } .diff { display: grid; grid-template-columns: minmax(92px, .7fr) 1fr 1fr; gap: 8px; font-size: 13px; } .notice { padding: 12px; border-radius: 8px; background: var(--soft); color: var(--muted); } .error { margin-top: 12px; color: var(--bad); font-weight: 650; } .hidden { display: none; }
      @media (max-width: 560px) { main { padding: 16px; } .summary, .form-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="eyebrow">Telnyx Billing</div>
        <h1>Set Up Auto Recharge</h1>
        <p>Enable automatic balance top-ups so service can continue when account credit runs low. This does not collect a payment in the MCP app.</p>
        <div class="pill-row">
          <span class="pill" id="bridgeStatus">Host bridge: initializing</span>
          <span class="pill">Preview required</span>
          <span class="pill">No direct payments</span>
        </div>
      </header>

      <section class="summary">
        <article class="card"><h3>Balance</h3><div class="value" id="balanceValue">Loading</div><div class="meta" id="balanceMeta">available credit</div></article>
        <article class="card"><h3>Current Auto Recharge</h3><div class="value" id="autoValue">Loading</div><div class="meta" id="autoMeta">threshold / amount</div></article>
      </section>

      <section class="panel">
        <div class="notice">Set a threshold that should trigger a top-up, then choose the recharge amount. Changes are previewed first and only applied after confirmation.</div>
        <form id="autoForm" class="stack">
          <div class="switch"><span>Enable auto recharge</span><input id="enabledInput" type="checkbox" checked /></div>
          <div class="switch"><span>Invoice-backed billing</span><input id="invoiceInput" type="checkbox" /></div>
          <div class="form-grid">
            <label>Threshold amount<input id="thresholdInput" inputmode="decimal" value="10.00" /></label>
            <label>Recharge amount<input id="rechargeInput" inputmode="decimal" value="25.00" /></label>
          </div>
          <label>Payment method<select id="preferenceSelect"><option value="credit_paypal">Card or PayPal</option><option value="ach">Bank transfer (ACH)</option></select><span class="meta" id="preferenceHelp">Uses the saved card or PayPal payment method.</span></label>
          <div class="actions">
            <button id="previewButton" type="submit">Preview setup</button>
            <button class="secondary" id="reloadButton" type="button">Reload current state</button>
          </div>
        </form>
        <div class="notice hidden" id="status"></div>
        <div class="error hidden" id="error"></div>
      </section>

      <section id="previewBox" class="preview hidden">
        <h2>Confirm Auto Recharge</h2>
        <div id="diffList"></div>
        <div class="actions">
          <button id="confirmButton" type="button">Enable auto recharge</button>
          <button class="secondary" id="cancelButton" type="button">Cancel</button>
        </div>
      </section>
    </main>
    <script>
      const PROTOCOL_VERSION = "2026-01-26";
      let nextId = 1;
      const pending = new Map();
      const state = { patch: null, token: null };
      const els = {
        bridgeStatus: document.getElementById("bridgeStatus"), error: document.getElementById("error"),
        status: document.getElementById("status"),
        balanceValue: document.getElementById("balanceValue"), balanceMeta: document.getElementById("balanceMeta"),
        autoValue: document.getElementById("autoValue"), autoMeta: document.getElementById("autoMeta"),
        enabledInput: document.getElementById("enabledInput"), invoiceInput: document.getElementById("invoiceInput"),
        thresholdInput: document.getElementById("thresholdInput"), rechargeInput: document.getElementById("rechargeInput"),
        preferenceSelect: document.getElementById("preferenceSelect"), autoForm: document.getElementById("autoForm"),
        reloadButton: document.getElementById("reloadButton"), previewBox: document.getElementById("previewBox"),
        diffList: document.getElementById("diffList"), confirmButton: document.getElementById("confirmButton"),
        cancelButton: document.getElementById("cancelButton"), previewButton: document.getElementById("previewButton")
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
          const previousHeight = root.style.height;
          root.style.height = "max-content";
          const height = Math.ceil(root.getBoundingClientRect().height);
          root.style.height = previousHeight;
          notify("ui/notifications/size-changed", { width: Math.ceil(root.scrollWidth || window.innerWidth), height });
        });
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
      async function callTool(name, args = {}) { return extractResult(await request("tools/call", { name, arguments: args })); }
      function extractResult(result) {
        if (result?.isError) {
          const textBlock = result?.content?.find?.((block) => block.type === "text");
          throw new Error(textBlock?.text || "Tool request failed.");
        }
        if (result?.structuredContent) return result.structuredContent;
        const textBlock = result?.content?.find?.((block) => block.type === "text");
        if (!textBlock?.text) return result;
        try { return JSON.parse(textBlock.text); } catch { return result; }
      }
      function dataOf(envelope) { return envelope?.data ?? envelope; }
      function fmtMoney(value, currency) { return value === undefined || value === null || value === "" ? "-" : (currency ? value + " " + currency : String(value)); }
      function setError(message) { els.error.textContent = message || ""; els.error.classList.toggle("hidden", !message); resize(); }
      function setStatus(message) { els.status.textContent = message || ""; els.status.classList.toggle("hidden", !message); resize(); }
      function renderState(payload) {
        const balance = dataOf(payload?.balance);
        const auto = dataOf(payload?.auto_recharge);
        const currency = balance?.currency;
        els.balanceValue.textContent = fmtMoney(balance?.balance, currency);
        els.balanceMeta.textContent = "available " + fmtMoney(balance?.available_credit, currency);
        els.autoValue.textContent = auto ? (auto.enabled ? "Enabled" : "Disabled") : "-";
        els.autoValue.className = "value " + (auto?.enabled ? "good" : "warn");
        els.autoMeta.textContent = auto ? "threshold " + fmtMoney(auto.threshold_amount) + "; recharge " + fmtMoney(auto.recharge_amount) : "not configured or unavailable";
        if (auto) {
          els.enabledInput.checked = auto.enabled !== false;
          els.invoiceInput.checked = Boolean(auto.invoice_enabled);
          els.thresholdInput.value = auto.threshold_amount ?? els.thresholdInput.value;
          els.rechargeInput.value = auto.recharge_amount ?? els.rechargeInput.value;
          if (auto.preference && !Array.from(els.preferenceSelect.options).some((option) => option.value === auto.preference)) {
            els.preferenceSelect.append(new Option(auto.preference, auto.preference));
          }
          els.preferenceSelect.value = auto.preference || els.preferenceSelect.value;
          renderPreferenceHelp();
        }
        if (payload?.warnings?.length) setError(payload.warnings.map((warning) => warning.source + ": " + warning.message).join("; "));
        else setError("");
        resize();
      }
      function patchFromForm() {
        return {
          enabled: els.enabledInput.checked,
          invoice_enabled: els.invoiceInput.checked,
          threshold_amount: els.thresholdInput.value.trim(),
          recharge_amount: els.rechargeInput.value.trim(),
          preference: els.preferenceSelect.value
        };
      }
      function renderPreferenceHelp() {
        const descriptions = {
          credit_paypal: "Uses the saved card or PayPal payment method.",
          ach: "Uses a linked US bank account through ACH."
        };
        els.preferenceHelp ??= document.getElementById("preferenceHelp");
        if (els.preferenceHelp) els.preferenceHelp.textContent = descriptions[els.preferenceSelect.value] || "";
      }
      function textNode(value) { const div = document.createElement("div"); div.textContent = value; return div; }
      function renderPreview(preview, patch) {
        state.patch = patch;
        state.token = preview.confirmation_token;
        els.previewBox.classList.remove("hidden");
        setStatus("Preview ready. Review the changes below, then confirm to update Telnyx.");
        els.diffList.replaceChildren();
        for (const item of preview.diff || []) {
          const row = document.createElement("div");
          row.className = "diff";
          row.replaceChildren(textNode(item.field), textNode(String(item.before ?? "-")), textNode(String(item.after ?? "-")));
          els.diffList.append(row);
        }
        if (!preview.diff?.length) els.diffList.textContent = "No field changes detected.";
        resize();
      }
      async function loadState() {
        renderState(await callTool("billing_auto_recharge_setup"));
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
        }
      });
      els.autoForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError("");
        setStatus("Creating preview...");
        els.previewButton.disabled = true;
        const previousText = els.previewButton.textContent;
        els.previewButton.textContent = "Previewing";
        try {
          const patch = patchFromForm();
          renderPreview(await callTool("billing_preview_auto_recharge_update", patch), patch);
        } catch (error) { setStatus(""); setError(error.message || "Preview failed."); }
        finally { els.previewButton.disabled = false; els.previewButton.textContent = previousText; }
      });
      els.confirmButton.addEventListener("click", async () => {
        if (!state.patch || !state.token) return;
        setError("");
        setStatus("Updating auto recharge...");
        els.confirmButton.disabled = true;
        const previousText = els.confirmButton.textContent;
        els.confirmButton.textContent = "Updating";
        try {
          const auto_recharge = await callTool("billing_update_auto_recharge_preferences", { ...state.patch, confirmation_token: state.token });
          state.patch = null; state.token = null;
          els.previewBox.classList.add("hidden");
          renderState({ auto_recharge });
          setStatus("Auto recharge update sent.");
        } catch (error) { setStatus(""); setError(error.message || "Update failed."); }
        finally { els.confirmButton.disabled = false; els.confirmButton.textContent = previousText; }
      });
      els.cancelButton.addEventListener("click", () => { state.patch = null; state.token = null; els.previewBox.classList.add("hidden"); setStatus(""); resize(); });
      els.reloadButton.addEventListener("click", () => { setStatus("Reloading current state..."); loadState().then(() => setStatus("Current state reloaded.")).catch((error) => setError(error.message || "Reload failed.")); });
      els.preferenceSelect.addEventListener("change", renderPreferenceHelp);
      window.addEventListener("resize", resize);
      new ResizeObserver(resize).observe(document.documentElement);
      new ResizeObserver(resize).observe(document.body);
      request("ui/initialize", { appInfo: { name: "telnyx-auto-recharge-setup-ui", version: "0.1.0" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION })
        .then(async () => {
          els.bridgeStatus.textContent = "Host bridge: connected";
          notify("ui/notifications/initialized", {});
          await loadState();
          renderPreferenceHelp();
        })
        .catch((error) => {
          els.bridgeStatus.textContent = "Host bridge: unavailable";
          setError("MCP App bridge failed to initialize: " + error.message);
        });
    </script>
  </body>
</html>`;
