# TEL-575 agent-access verification

Date: 2026-06-29
Issue: TEL-575
Branch: `tel-552-glm52-opencode-guardrail`
HEAD: `cea11d5798b8a8c7f92ba460da8f5f148902cbd8`

## Scope

Focused live verification of the three access-layer signals called out in Ora's 2026-06-27 cache:

- bearer auth hinting
- standard rate-limit headers
- detectable REST idempotency support

## Commands run

```bash
curl -sS -D - -o /tmp/telnyx-mcp-body.txt \
  -X POST https://api.telnyx.com/v2/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"telnyx-ai-live-verifier","version":"0.0.0"}}}'

curl -sS -D - -o /tmp/telnyx-mcp-tools-list.txt \
  -X POST https://api.telnyx.com/v2/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -sS -D - -o /tmp/telnyx-mcp-tools-call.txt \
  -X POST https://api.telnyx.com/v2/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_api_endpoints","arguments":{}}}'

curl -sS -D - -o /tmp/telnyx-messages-body.txt \
  -X POST https://api.telnyx.com/v2/messages \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{"from":"+15555550100","to":"+15555550101","text":"test"}'

curl -sS -D - -o /tmp/telnyx-number-orders-body.txt \
  -X POST https://api.telnyx.com/v2/number_orders \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{}'

curl -sS -D - -o /tmp/telnyx-messages-idem-body.txt \
  -X POST https://api.telnyx.com/v2/messages \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  --data '{"from":"+15555550100","to":"+15555550101","text":"test"}'

curl -sS -D - -o /tmp/telnyx-inference-body.txt \
  -X POST https://telnyx.com/api/inference \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"ping"}]}'

curl -sS -D - -o /tmp/telnyx-demo-sms-body.txt \
  -X POST https://telnyx.com/api/demo/send-sms \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{"to":"+15555550101","message":"test"}'

curl -sS -D - -o /tmp/telnyx-tts-demo-body.txt \
  -X POST https://telnyx.com/api/tts-demo \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data '{"text":"ping"}'

curl -sS -D - -o /tmp/telnyx-tts-idem-body.txt \
  -X POST https://telnyx.com/api/tts-demo \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 11111111-1111-4111-8111-111111111111' \
  --data '{"voice":"alloy","text":"ping"}'
```

## Findings

### 1. Bearer auth hinting

- `POST https://api.telnyx.com/v2/messages` returned `401` with `WWW-Authenticate: Bearer resource_metadata="https://api.telnyx.com/.well-known/oauth-protected-resource"`.
- `POST https://api.telnyx.com/v2/number_orders` returned the same `401` + `resource_metadata` hint.
- `POST https://api.telnyx.com/v2/mcp` with `initialize`, `tools/list`, and `resources/list` returned `200`, not `401`. Those methods are publicly readable.
- `POST https://api.telnyx.com/v2/mcp` with protected `tools/call` returned `401` with `WWW-Authenticate: Bearer resource_metadata="https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp"`.

Conclusion: Ora's cached "no detectable WWW-Authenticate hint" result is stale for REST and incomplete for MCP. The live gap is not missing bearer hints; the repo wording was too broad about which MCP request shape produces the hint.

### 2. Rate-limit headers

- None of the probed responses exposed `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, or `Retry-After`.
- This includes REST `401` responses, MCP `200` public discovery responses, MCP `401` protected-method responses, `POST https://telnyx.com/api/inference` returning `404`, `POST https://telnyx.com/api/demo/send-sms` returning `503`, and `POST https://telnyx.com/api/tts-demo` returning `400`.
- `X-Request-Id` was present on the probed `api.telnyx.com` responses but not on the `telnyx.com/api/*` demo responses sampled here.

Conclusion: the public repo contract documents the standard rate-limit headers, but they were not live-observable on the tested first-contact responses.

### 3. Detectable REST idempotency support

- Adding `Idempotency-Key` to unauthenticated `POST https://api.telnyx.com/v2/messages` did not change the `401` response shape and did not produce any observable idempotency acknowledgment or validation signal.
- Adding `Idempotency-Key` to `POST https://telnyx.com/api/tts-demo` did not produce any observable idempotency signal either; the endpoint still returned a normal payload-validation `400`.
- Without a valid API key, this probe cannot verify duplicate replay, in-flight replay, or conflicting key reuse semantics on authenticated REST writes.

Conclusion: the repo advertises an idempotency contract, but there is no unauthenticated or public detectable proof point for that contract in the probed flows.

## Repo-owned fixes

Implemented in this branch:

- narrowed the MCP bearer-challenge wording in `auth.md` from "initialize on /v2/mcp returns 401" to "protected MCP methods such as tools/call return 401"
- added method-level metadata to `/.well-known/agent-access.json` so the machine-readable contract points agents at the correct MCP probe shape
- aligned `scripts/verify-live-agent-discovery.ts` and `tests/auth-discovery-surfaces.test.ts` with the protected-method probe

## Platform-owned follow-up

Recommended escalation to the API/platform owners:

1. Emit the documented `X-RateLimit-*` headers and `Retry-After` on representative first-contact responses where feasible, especially authenticated REST `401`/`429` and protected MCP `401`/`429` responses.
2. Ensure the host-authenticated `telnyx.com/api/*` demo surfaces also expose `X-Request-Id` and the documented rate-limit headers consistently when those routes are intended as agent-first entry points.
3. Provide a live-verifiable idempotency proof point for covered REST writes.
   A minimal implementation would validate `Idempotency-Key` shape before side effects on covered endpoints and document or expose deterministic replay/conflict behavior through authenticated examples or contract tests.

## Recommended next action

- Merge the repo-owned MCP challenge wording fix.
- Route the rate-limit and idempotency observability gap to the API/platform team with this packet.
