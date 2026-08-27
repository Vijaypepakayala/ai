// Live contract suite: drives the BUILT connector binary over stdio against
// the real Telnyx API. Read-only tools only — no billable writes.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const apiKey = process.env.TELNYX_API_KEY;
if (!apiKey) {
  console.error("TELNYX_API_KEY not set — the live contract suite needs a real key. Aborting.");
  process.exit(2);
}
const transport = new StdioClientTransport({
  command: "node",
  // The test-only launcher blocks every non-GET request before network I/O.
  // Keep a nonzero order budget so case 6b can reach the authoritative quote
  // and prove the no-elicitation refusal without weakening that backstop.
  args: ["test-live/read-only-cli.mjs"],
  env: {
    ...process.env,
    TELNYX_API_KEY: apiKey,
    TELNYX_CONNECTOR_MAX_ORDER_NUMBER: "1",
    // The bounded turnover loop tries at most five candidates; quote failures
    // consume attempt budget even though the read-only launcher blocks orders.
    TELNYX_CONNECTOR_MAX_ORDER_NUMBER_ATTEMPT: "5",
    TELNYX_CONNECTOR_MAX_SEND_MESSAGE: "0",
    TELNYX_CONNECTOR_MAX_PLACE_CALL: "0",
    TELNYX_CONNECTOR_MAX_CALL_COMMAND: "0"
  }
});
const client = new Client({ name: "live-contract", version: "0" });
await client.connect(transport);

const results = [];
async function tcase(name, toolName, args, check) {
  try {
    const res = await client.callTool({ name: toolName, arguments: args });
    const text = res.content?.[0]?.text ?? "";
    const verdict = check(res, text);
    results.push({ name, ok: verdict === true, detail: verdict === true ? text.slice(0, 140) : verdict });
  } catch (err) {
    results.push({ name, ok: false, detail: `threw: ${err.message}` });
  }
}

// 1. search inventory (read-only, live)
await tcase("search_available_numbers US/312 sms+voice", "search_available_numbers",
  { country_code: "US", area_code: "312", features: ["sms", "voice"], limit: 3 },
  (res, text) => {
    if (res.isError) return `tool error: ${text.slice(0, 200)}`;
    const d = JSON.parse(text);
    if (!Array.isArray(d.data)) return "no data array";
    if (d.data.length === 0) return true; // valid: empty inventory slice
    const n = d.data[0];
    if (!n.phone_number) return "row missing phone_number";
    if (!n.cost_information?.monthly_cost) return "row missing cost_information.monthly_cost (order_number authoritative pricing depends on it)";
    return true;
  });

// 2. basic lookup — free tier, portability populated, carrier null (live-verified doc claim)
await tcase("lookup_number basic (no billable types)", "lookup_number",
  { phone_number: "+13125556789" },
  (res, text) => {
    if (res.isError) return `tool error: ${text.slice(0, 200)}`;
    const d = JSON.parse(text);
    if (!("portability" in (d.data ?? {}))) return "portability object missing";
    if (d.data.carrier && d.data.carrier.name) return "carrier populated without ?type= (contradicts live-verified doc)";
    return true;
  });

// 3. owned numbers with pagination params
await tcase("list_owned_numbers page 1", "list_owned_numbers",
  { page_size: 5, page: 1 },
  (res, text) => {
    if (res.isError) return `tool error: ${text.slice(0, 200)}`;
    const d = JSON.parse(text);
    if (!Array.isArray(d.data)) return "no data array";
    if (!d.meta) return "no meta (pagination info)";
    globalThis.__firstNumberId = d.data[0]?.id ?? null;
    globalThis.__ownedCount = d.data.length;
    return true;
  });

// 4. messaging readiness on a real owned number (if any)
if (globalThis.__firstNumberId) {
  await tcase("check_messaging_readiness on first owned number", "check_messaging_readiness",
    { phone_number_id: String(globalThis.__firstNumberId) },
    (res, text) => {
      if (res.isError) return `tool error: ${text.slice(0, 200)}`;
      const d = JSON.parse(text);
      if (!d.data) return "no data";
      return true;
    });
} else {
  results.push({
    name: "check_messaging_readiness on first owned number",
    ok: false,
    detail: "not exercised: the live test account has no owned number"
  });
}

// 5. get_message_status with a random uuid — proves the 404 error path surfaces cleanly
await tcase("get_message_status unknown id -> clean 404 surfacing", "get_message_status",
  { message_id: "00000000-0000-4000-8000-000000000000" },
  (res, text) => {
    if (!res.isError) return "expected an error result for unknown message id";
    if (!/HTTP 4\d\d/.test(text)) return `no HTTP status in error: ${text.slice(0, 160)}`;
    return true;
  });

// 6a. order_number refuses a number that was not returned by this session's
// search, before any pricing or purchase request.
await tcase("order_number refuses an unseen number (live, no purchase)", "order_number",
  { phone_number: "+13125550100" },
  (res, text) => (res.isError && text.includes("search_available_numbers") ? true : `unexpected: ${text.slice(0, 160)}`));

// 6b. This stdio client does not advertise elicitation. A REAL orderable number
// receives a live quote but cannot be purchased (proves pricing runs and the
// fail-closed gate holds). Inventory can legitimately turn over between the
// initial search and the connector's authoritative re-query, so try a small,
// bounded candidate set rather than treating one vanished DID as a contract
// failure. At least one candidate still has to reach the quote gate.
{
  const MAX_LIVE_QUOTE_CANDIDATES = 5;
  const search = await client.callTool({
    name: "search_available_numbers",
    arguments: { country_code: "US", limit: 50 }
  });
  const candidates = search.isError
    ? []
    : (JSON.parse(search.content[0].text).data ?? [])
      .map((entry) => entry?.phone_number)
      .filter((phoneNumber) => typeof phoneNumber === "string")
      .slice(0, MAX_LIVE_QUOTE_CANDIDATES);
  let quoteGateResult = null;
  for (const phoneNumber of candidates) {
    const res = await client.callTool({
      name: "order_number",
      arguments: { phone_number: phoneNumber }
    });
    const text = res.content?.[0]?.text ?? "";
    if (res.isError && /live authoritative quote/i.test(text) && /elicitation/i.test(text)) {
      quoteGateResult = {
        name: "order_number quotes live price then requires elicitation",
        ok: true,
        detail: text.slice(0, 140)
      };
      break;
    }
    if (res.isError && /not currently available with valid current pricing/i.test(text)) {
      continue;
    }
    quoteGateResult = {
      name: "order_number quotes live price then requires elicitation",
      ok: false,
      detail: `unexpected: ${text.slice(0, 160)}`
    };
    break;
  }
  if (quoteGateResult) {
    results.push(quoteGateResult);
  } else {
    results.push({
      name: "order_number live-price gate",
      ok: false,
      detail:
        candidates.length === 0
          ? "not exercised: documented US inventory search returned no orderable number"
          : `not exercised: ${candidates.length} bounded live candidates turned over before authoritative pricing`
    });
  }
}

// 7-9. Exercise every remaining tool boundary while proving that write caps
// stop billable/mutating requests before the read-only transport backstop or
// network fetch can be reached.
await tcase("send_message zero-cap gate blocks live write", "send_message",
  { to: "+15550001111", from: "+15550002222", text: "must not send" },
  (res, text) => (res.isError && text.includes("used 0/0") ? true : `unexpected: ${text.slice(0, 160)}`));

await tcase("place_call zero-cap gate blocks live write", "place_call",
  { to: "+15550001111", from: "+15550002222", connection_id: "must-not-dispatch" },
  (res, text) => (res.isError && text.includes("used 0/0") ? true : `unexpected: ${text.slice(0, 160)}`));

await tcase("call_command zero-cap gate blocks live write", "call_command",
  {
    call_control_id: "must-not-dispatch",
    command: "speak",
    params: { payload: "must not speak", voice: "Polly.Joanna-Neural" }
  },
  (res, text) => (res.isError && text.includes("used 0/0") ? true : `unexpected: ${text.slice(0, 160)}`));

console.log("\n=== LIVE CONTRACT RESULTS ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  if (!r.ok) console.log(`      ${r.detail}`);
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await client.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
