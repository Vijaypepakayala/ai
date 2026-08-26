# Number Intelligence

Read-first Telnyx [MCP App](https://modelcontextprotocol.io/extensions/apps/overview) for explaining what is known about a phone number and what a user should do next.

Current scope:

- carrier and line type from Telnyx Number Lookup;
- caller-name/ownership hint when returned by Number Lookup;
- inferred messaging and voice capability from line type;
- optional signals for ownership, portability, messaging configuration, voice configuration, and cached reputation;
- stable recommended actions with IDs and tool hints;
- interactive HTML UI resource for an MCP App-capable host to render in-chat.

## Safety defaults

- **Read-first behavior.** The default live Telnyx calls are read-only. Portability is opt-in because it uses an eligibility-check POST that does not create a port order.
- **No mutating Telnyx setup calls.** No ordering numbers, no profile updates, no port creation, no sends.
- **No fresh billed reputation lookup by default.** Reputation requests force `fresh=false`.
- **No secrets in tests.** Tests use injected `fetch`/client stubs and do not require a real Telnyx API key.
- **Default outputs are redacted.** `input.phone_number`, `normalized`, and `display` values use redacted phone-number strings; exact numbers are used only internally for lookup requests.
- **Raw responses are opt-in and redacted.** `include_raw` defaults to `false`; when enabled, raw values pass through phone-number redaction.
- **Avoid logging full numbers/secrets.** The client does not log requests or Authorization headers.

## APIs used

| Source | Behavior |
| --- | --- |
| Telnyx Number Lookup | Live read-only lookup: `GET /v2/number_lookup/{phone_number}?type=carrier&type=caller-name`. Always used. |
| Owned-number config | Safe default live source: `GET /v2/phone_numbers?filter[phone_number]=...` to determine account ownership and missing assignment hints. |
| Messaging readiness | Safe default live source: `GET /v2/phone_numbers/messaging` plus `GET /v2/messaging_profiles/{id}` when attached. The app does not surface sensitive profile secrets. |
| Voice readiness | Safe default live source: `GET /v2/phone_numbers/voice` plus `GET /v2/connections/{id}` when attached. |
| Portability | Opt-in live source: `POST /v2/portability_checks` as an eligibility-only/read-first check. It does not create a port order. |
| Reputation | Opt-in cached-only live source: `GET /v2/reputation/numbers/{phone_number}?fresh=false`. |

## Environment

```bash
TELNYX_API_KEY=replac...-key
TELNYX_API_BASE_URL=https://api.telnyx.com   # optional
NUMBER_INTELLIGENCE_INCLUDE_RAW=false        # optional; overridden per-call by include_raw
```

A `.env` file in this directory is auto-loaded when the server is run directly (`npm run dev` / `npm start`). The test suite does not read `.env`.

## Commands

From `tools/mcp-apps`:

```bash
npm install
npm test --workspace @telnyx-mcp-apps/number-intelligence
npm run typecheck --workspace @telnyx-mcp-apps/number-intelligence
npm run build --workspace @telnyx-mcp-apps/number-intelligence
npm run dev --workspace @telnyx-mcp-apps/number-intelligence
```

## MCP Apps surface

The server is built on the official `@modelcontextprotocol/sdk` and registers MCP Apps metadata via `@modelcontextprotocol/ext-apps/server`. It runs over stdio.

- tool: `number_intelligence_analyze`
  - `phone_number` string, required
  - `include_raw` boolean, optional (defaults to `NUMBER_INTELLIGENCE_INCLUDE_RAW` env, else `false`)
  - `sources` string array, optional. Supported values: `lookup`, `owned`, `portability`, `messaging`, `voice`, `reputation`.
  - omitted `sources` uses safe defaults: `owned`, `messaging`, `voice` plus the always-on Number Lookup.
  - `portability` is opt-in because it uses an eligibility-check POST.
  - `reputation` is opt-in and cached-only; requests force `fresh=false`.
  - tool description carries `_meta.ui.resourceUri = "ui://number-intelligence/index.html"`
  - tool result includes `structuredContent` with the full analysis object so MCP App hosts can hand it to the UI
- tool: `number_intelligence_batch_analyze`
  - `numbers` as newline/CSV text or an array of strings
  - conservative max batch size: 25
  - runs sequentially, redacts per-number output, and returns aggregate health/action counts
- resource: `ui://number-intelligence/index.html` (mimeType `text/html;profile=mcp-app`)

If `TELNYX_API_KEY` is missing, tool calls return a safe error result instead of attempting a live lookup.

## Example output shape

```json
{
  "input": { "phone_number": "+1312******23" },
  "normalized": {
    "e164": "+1312******23",
    "e164_validated": false,
    "national_format": "+1312******23"
  },
  "display": { "redacted": "+1312******23", "label": "+1312******23" },
  "summary": {
    "type": "mobile",
    "carrier": "Example Wireless",
    "country": "US",
    "ownership": "Example Support",
    "portability": "unknown",
    "messaging": "likely_supported",
    "voice": "likely_supported",
    "reputation": "unknown"
  },
  "health": { "status": "good", "score": 90, "rationale": "Available read-only signals do not show a blocker." },
  "signals": [
    { "id": "lookup.carrier", "label": "Carrier lookup", "status": "info", "detail": "Carrier Example Wireless; type mobile." }
  ],
  "recommended_actions": [
    { "id": "confirm_messaging_profile", "label": "Confirm messaging profile before sending", "tool_hint": "messaging_readiness_check" }
  ],
  "sources": [
    { "id": "telnyx.number_lookup", "label": "Telnyx Number Lookup", "status": "consulted" }
  ]
}
```

`normalized.e164_validated` is always `false`: phone normalization is intentionally lightweight (`e164-ish`) and is not a real E.164 validator.

## Running it live

`TELNYX_API_KEY` must be a real, read-only Telnyx API key. Pick one of:

**1. Raw stdio one-shot.**

```bash
export TELNYX_API_KEY=***
npm run build --workspace @telnyx-mcp-apps/number-intelligence
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"number_intelligence_analyze","arguments":{"phone_number":"+1XXXXXXXXXX","include_raw":true}}}'
) | node apps/number-intelligence/dist/server.js
```

**2. MCP Inspector (interactive).**

```bash
TELNYX_API_KEY=*** npx @modelcontextprotocol/inspector node "$PWD/apps/number-intelligence/dist/server.js"
```

Open the printed URL, hit Connect, then call `number_intelligence_analyze`.

**3. Attach to Claude Code / Claude Desktop.**

```bash
claude mcp add number-intelligence \
  --env TELNYX_API_KEY=*** \
  -- node "$PWD/apps/number-intelligence/dist/server.js"
```

A host that supports the MCP Apps extension can resolve the tool's `_meta.ui.resourceUri` and render the UI in-chat.

## Known limits

- 10DLC campaign assignment, toll-free verification details, porting-order history, and type-specific SIP/FQDN/UAC connection details are not queried.
- Portability is opt-in because it is a read-first POST, even though it does not create a port order.
- Cached reputation is opt-in and always uses `fresh=false`; fresh/billed reputation lookups are not exposed.
- `normalized.e164` is best-effort, not validated (see `normalized.e164_validated`).
- The UI resource consumes `structuredContent` and attempts common host bridge names for re-analysis; host-specific MCP Apps client integration can vary.
