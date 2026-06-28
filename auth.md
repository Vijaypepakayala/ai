# auth.md

Telnyx uses bearer API keys for agent access. The resource server is `https://api.telnyx.com`. The public discovery host is `https://telnyx.com`. Read this file top to bottom before you attempt unauthenticated probes, programmatic signup, or MCP initialization.

## 1. Quickstart Paths

Choose the shortest path that proves the integration:

1. Zero-signup evaluation
Read `https://telnyx.com/.well-known/agent-access.json`, then send `POST https://telnyx.com/api/inference`.

2. Authenticated API or MCP onboarding
Read `https://telnyx.com/agent-signup.md`, create or obtain an API key, then call `https://api.telnyx.com/v2/available_phone_numbers` or initialize `https://api.telnyx.com/v2/mcp`.

3. Production Voice AI onboarding
Read [`/guides/ai-assistants.md`](/guides/ai-assistants.md), then [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md) once a key and account resources exist.

## 2. Discover

Start with the protected resource metadata for the surface you want to call.

- Generic API resource metadata: `https://api.telnyx.com/.well-known/oauth-protected-resource`
- MCP resource metadata: `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp`
- Authorization server metadata: `https://api.telnyx.com/.well-known/oauth-authorization-server`
- Lightweight MCP discovery index: `https://telnyx.com/.well-known/mcp`
- Canonical MCP server card: `https://telnyx.com/.well-known/mcp/server-card.json`
- Agent onboarding contract: `https://telnyx.com/.well-known/agent-access.json`

When an unauthenticated MCP initialize request reaches `https://api.telnyx.com/v2/mcp`, Telnyx responds with `401 Unauthorized` and a bearer challenge that includes a `resource_metadata` hint. Follow that hint first. For the generic REST API, if the response does not include a challenge header, fall back to the conventional protected-resource URL above.

```http
POST /v2/mcp HTTP/1.1
Host: api.telnyx.com
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-06-18

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example-agent","version":"0.0.0"}}}
```

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp"
Content-Type: application/json
```

Read the protected-resource document for:

- `resource`
- `resource_name`
- `authorization_servers`
- `scopes_supported`
- `bearer_methods_supported`

Then fetch the authorization-server metadata from `authorization_servers[0] + "/.well-known/oauth-authorization-server"` and read:

- `issuer`
- `token_endpoint`
- `authorization_endpoint`
- `registration_endpoint`
- `scopes_supported`
- `protected_resources`
- `agent_auth`

`agent_auth` is the machine-readable summary of Telnyx's current agent registration path. Today it advertises the live bot-signup endpoints (`register_uri`, `claim_uri`, `challenge_uri`) plus the human-readable `skill` and `signup_guide_uri` documents that explain the full sequence. Telnyx does not currently expose the full WorkOS-style `/agent/auth`, `/agent/auth/claim`, or `/agent/auth/revoke` endpoint family, so treat the published `agent_auth` block as an onboarding map for the current API-key flow rather than as a claim that those protocol routes exist.

Protocol and product notes:

- Protocol requirement: if a bearer challenge is present, follow the `resource_metadata` hint first and then read the protected-resource and authorization-server metadata.
- Product convention: `https://telnyx.com/.well-known/agent-access.json` now mirrors the preferred walkthrough (`auth.md`), signup walkthrough (`agent-signup.md`), and the audited MCP bearer-challenge entrypoint so a clean-session agent can recover without guessing which document to read next.
- Bounded adoption decision: the audited public challenge surface is `https://api.telnyx.com/v2/mcp`. If a generic REST probe does not emit `WWW-Authenticate`, use `https://api.telnyx.com/.well-known/oauth-protected-resource` directly instead of inferring hidden routes.

## 3. Pick a Credential Path

Choose one of these paths:

1. You already have a Telnyx API key.
Use it directly.

2. You need a zero-auth evaluation path.
Fetch `https://telnyx.com/.well-known/agent-access.json` and start with `fast_path.primary_path`.
Today that exact path is `POST https://telnyx.com/api/inference`, labeled `no_auth_host_authenticated`: you do not provide a bearer token, Telnyx authenticates upstream on the server side, and the governed-execution shape is `guarded_write`, `confirm_before_mutation`, `stateless`, `request_selected`.

3. You need a new key and can complete an email sign-in loop.
Follow the programmatic bot-signup flow at `https://telnyx.com/agent-signup.md`.

4. You need a new key and a human can use the portal.
Use `https://portal.telnyx.com` to create or rotate a key interactively.

## 4. Register or Obtain a Key

The canonical machine-readable onboarding surface is `https://telnyx.com/.well-known/agent-access.json`. The canonical human-readable walkthrough is `https://telnyx.com/agent-signup.md`.

For programmatic signup, the current production sequence is:

1. `POST https://api.telnyx.com/v2/bot_challenge`
2. Solve the returned obfuscated math challenge
3. `POST https://api.telnyx.com/v2/bot_signup`
4. Retrieve the single-use email link
5. `POST https://api.telnyx.com/v2/api_keys`

That email retrieval step is still the blocker for fully autonomous no-mailbox agents. The repo-owned public contract now documents the intended upstream fix in `https://telnyx.com/agent-signup.md` and `https://telnyx.com/.well-known/agent-access.json`: the account platform should return a temporary session token directly from `POST /v2/bot_signup` for bot accounts.

Telnyx's current automated signup flow issues an API key, not an OAuth access token. Present the resulting credential as a bearer token in the `Authorization` header.

```http
GET /v2/available_phone_numbers HTTP/1.1
Host: api.telnyx.com
Authorization: Bearer TELNYX_API_KEY
Accept: application/json
```

```http
POST /v2/mcp HTTP/1.1
Host: api.telnyx.com
Authorization: Bearer TELNYX_API_KEY
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-06-18
```

## 5. Use the Credential

Use the same bearer presentation for REST and MCP:

- Header: `Authorization: Bearer <TELNYX_API_KEY>`
- For agent-facing mutating REST writes in the initial rollout scope, send `Idempotency-Key` on `POST`, `PUT`, `PATCH`, and `DELETE` requests to resources such as `/v2/messages`, `/v2/calls`, `/v2/number_orders`, `/v2/phone_numbers/{id}`, and `/v2/ai/assistants/{id}`.
- Generate a fresh opaque ASCII key per intended mutation. UUIDv4 is the recommended default.
- Reusing the same key with the same normalized request should return the original success response after completion, or a deterministic in-progress response while the original request is still running.
- Reusing the same key with a materially different payload should fail with a conflict response rather than executing a second write.
- Treat malformed, oversized, or non-ASCII keys as client errors that should be fixed before retrying.
- Plan around a minimum 24-hour server retention window for idempotency records.
- When a covered write returns `202 Accepted`, treat it as in progress and honor `Retry-After` before polling for a terminal result.
- Generic REST base: `https://api.telnyx.com/v2`
- MCP endpoint: `https://api.telnyx.com/v2/mcp`

For MCP:

1. Call `initialize`
2. Read `result.instructions`
3. Call `tools/list`
4. Inspect the endpoint schema before any mutating tool call

If a previously-working key starts returning `401`, discard it and restart at discovery. Keys are bearer credentials; do not retry a revoked or expired credential indefinitely.

Minimal authenticated check:

```bash
curl -s https://api.telnyx.com/v2/available_phone_numbers \
  -H "Authorization: Bearer TELNYX_API_KEY"
```

Minimal CLI check after key creation:

```bash
telnyx-agent status --json
```

## 6. Errors

| Condition | Where you see it | What to do |
| --- | --- | --- |
| Missing credentials | REST or MCP probe returns `401` | Read `WWW-Authenticate` when present, fetch protected-resource metadata, then obtain or reuse an API key |
| Route not found | Probe returns Telnyx error code `10005` | Confirm the HTTP method and path; `GET https://api.telnyx.com/v2/mcp` is not the MCP initialize flow |
| Email loop unavailable | Bot signup reaches the sign-in link step | Use the demo-first path for no-auth evaluation, or hand off to a human mailbox owner for production signup |
| Rate limiting | Demo or signup surfaces throttle | Back off and retry later; do not spam challenge endpoints |

## 7. Revocation and Rotation

Telnyx API keys are managed by the account owner. Agents do not have a separate revocation endpoint today.

- If a key is revoked or rotated, the next request will fail and the agent should restart at Step 1.
- For operator-driven rotation, use the portal or the authenticated API-key management surface after re-authentication.
- Treat `https://api.telnyx.com/.well-known/oauth-protected-resource` as the runtime source of truth if this file and a live challenge ever disagree.
