# @telnyx/claude-connector

Internal, local-only Telnyx MCP test server for Claude clients. It is not the
connector submitted to the Anthropic directory and must not be wired into a
public marketplace plugin. Nine task-level tools replace a raw API passthrough;
every tool is titled and annotated with `readOnlyHint` / `destructiveHint`,
number purchases have a spend-confirmation gate, and Call Control is mapped
1:1 to tool calls.

## Tools

| Tool | Annotations | What it does |
|---|---|---|
| `search_available_numbers` | read-only | Search purchasable numbers (never buys) |
| `lookup_number` | **destructive**, optionally billable | Free portability data by default; paid carrier/caller-name types when requested, so the combined tool is never advertised as a safe retry |
| `list_owned_numbers` | read-only | Numbers on the account |
| `check_messaging_readiness` | read-only | Pre-flight: profile assignment / 10DLC linkage |
| `get_message_status` | read-only | Delivery outcome from `data.to[0].status` |
| `send_message` | **destructive**, billable | SMS/MMS; profile optional (number's assignment used) |
| `order_number` | **destructive** | Buys a number returned by this session's search — requires human approval through MCP elicitation; no-elicitation clients cannot purchase |
| `place_call` | **destructive**, billable | Call Control dial; returns `call_control_id` |
| `call_command` | **destructive** | Allowlisted live-call commands (speak, gather, bridge, transfer, ...) |

## Install

Auth is a Telnyx API key v2 in the `TELNYX_API_KEY` env var — set it in the
MCP config, never paste it into chat.

**Claude Code**

```bash
claude mcp add telnyx-connector --env TELNYX_API_KEY=YOUR_KEY -- node /path/to/tools/connector/dist/cli.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "telnyx-connector": {
      "command": "node",
      "args": ["/path/to/tools/connector/dist/cli.js"],
      "env": { "TELNYX_API_KEY": "YOUR_KEY" }
    }
  }
}
```

**claude.ai (web)** — do not expose this stdio server or copy its API-key
configuration into any public package. Hosted connector wiring (a public
HTTPS endpoint with OAuth) is a separate release-gated deployment; nothing
in this repository connects claude.ai to an MCP server.

## Development

```bash
npm install
npm test          # vitest: exhaustive tool/action dispatch matrix plus safety edges
npm run build
```

## Safety model

- Unconditionally free reads are `readOnlyHint: true`. `lookup_number` is
  conservatively non-read-only, destructive, and non-idempotent because one
  invocation can request paid carrier or caller-name data; clients must not
  auto-approve or safely retry it based on the free default path.
- `order_number` prices AUTHORITATIVELY: it only accepts a number returned by
  `search_available_numbers` in the current connector session, repeats that
  originating country-aware search, and exact-matches the selected E.164 number
  in the live results. The server presents only that API-derived quote (all
  upfront + recurring charges) in a client-native MCP elicitation prompt. A
  client without elicitation receives the live quote in a bounded refusal and
  cannot purchase; there is no model-attested `confirm` fallback for orders. A
  number absent from live inventory is refused before any approval prompt.
  After human approval it repeats the search and refuses a changed or missing
  exact-match quote before POSTing. The order API accepts no quote/version
  token, so this narrows rather than eliminates the residual race between the
  final inventory GET and the order POST. The approved quote is returned with
  the order as a receipt.
- Number orders have two atomic session guards in addition to the billable
  action cap: concurrent quote/approval flows are bounded, and only one flow
  for a given DID can run. A duplicate loses before any GET or approval prompt.
  After an order POST succeeds or has an ambiguous transport outcome, that DID
  remains blocked for the session; verify ownership before restarting to retry.
  A definitive 4xx releases the guard and reservation.
- `call_command` allows only 11 named Call Control actions, and each command's
  body is validated against a STRICT curated schema of documented fields —
  unknown keys are rejected. `transfer`/`bridge` (they move a live human's call) and
  `record_start` (it captures participant audio) additionally require explicit
  approval. A bridge targets exactly one other call, queue, or video room;
  video-room context is accepted only with a video-room target. Curated
  transfer answer-time controls are limited to a validated audio URL or uploaded
  media name (never both) plus a bounded DTMF sequence; the approval prompt
  discloses them before dispatch. Webhook, custom-header, and SIP-auth overrides
  remain outside the transfer schema. Protective `record_stop`, `playback_stop`,
  `hangup`, and `reject` actions remain
  immediately available, including after the amplifying-command session cap is
  exhausted.
- **No webhook overrides, anywhere.** Per-call/per-command `webhook_url` is an
  event-exfiltration primitive under prompt injection; this connector never
  forwards one. Call events go to the application's configured webhook.
- The Call Control application's webhook is outside this stdio connector. Any
  application used for production validation or deployment must verify Telnyx
  Ed25519 signatures over the timestamp and raw body, reject timestamps older
  than five minutes, and deduplicate API v2 events by `data.id` before acting.
- **Session velocity caps** on billable or abuse-amplifying tools, taken as an
  ATOMIC RESERVATION before dispatch (defaults: 10 sends, 5 calls, 2 orders, 20
  billable lookups, 50 amplifying call commands; `TELNYX_CONNECTOR_MAX_*` env
  vars override).
  Protective stop/termination call commands are exempt so a cap cannot lock
  out emergency controls. Concurrent calls cannot all pass the same check — 8
  simultaneous sends against a cap of 1 produce exactly 1 upstream request. A
  reservation is released only when the request definitively did not act (a
  pre-dispatch/configuration failure or 4xx other than 429); timeouts,
  post-dispatch cancellations, 429s, and 5xx are treated as possibly acted and
  keep the budget spent.
- 30s request timeout and post-dispatch client cancellation both surface an
  explicit may-or-may-not-have-reached-Telnyx message. A cancellation already
  active before dispatch invokes no transport and releases its reservation.
  429s surface `Retry-After`; non-JSON error bodies are truncated; oversized
  results carry an explicit marker instead of letting the client cut JSON
  silently.
- Telnyx error codes (e.g. `40310`) are surfaced verbatim in tool errors —
  never swallowed; the API key never appears in URLs, logs, or errors.
- **Error bodies are bounded and redacted**: responses are capped while being
  read (256 KB), credential-shaped fields and inline key patterns are
  recursively redacted before an error is constructed, and error output is
  truncated to 8,000 characters. Recognized API-key and Bearer/Basic credential
  forms are scrubbed to reduce transcript leakage risk, and a huge error cannot
  blow the client's budget.

## Operational notes

- Confirmation-gated actions (`order_number`, `transfer`, `bridge`, and
  `record_start`) fail closed on clients without MCP elicitation. Velocity caps
  bound action count, not monetary value.
- Live-API contract tests: `TELNYX_API_KEY=... npm run test:live` drives the
  built binary over stdio against the production API (non-billable reads plus
  the order-gate refusal; no billable writes). A passing run exercises all nine
  tool boundaries: read routes reach the live API, while send/call/action tools
  prove their zero-cap pre-dispatch gates. The script rebuilds first, uses
  a one-unit number-order budget so the quote gate can execute, and launches
  the connector through a test-only wrapper that blocks every non-GET request
  before network I/O. Because live inventory can turn over between search and
  authoritative re-query, the quote-gate check tries at most five returned
  candidates; it still fails rather than passing as skipped if none reaches
  the no-elicitation gate.
  Messaging-readiness coverage likewise fails rather than silently skipping if
  the test account has no owned number.
- The billable SMS harness is deliberately manual: `npm run test:live:write`
  requires an exact owned `TELNYX_TEST_FROM_NUMBER`, an opted-in
  `TELNYX_TEST_TO_NUMBER`, `TELNYX_TEST_SENDER_COMPLIANCE_OK=yes`, and
  `LIVE_WRITE_OK=yes`. It verifies the named sender is active and assigned to a
  messaging profile, caps the session at one send, and disables number-order
  and call writes. The compliance acknowledgement covers sender-specific
  registration (10DLC, toll-free verification, or short-code approval) and the
  recipient's consent; a profile assignment alone does not prove either.
