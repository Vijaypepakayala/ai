# Telnyx MCP Apps

Telnyx MCP Apps are app-layer MCP servers with focused tools and MCP Apps UI resources for specific Telnyx workflows. This directory keeps local/reference app source in the `team-telnyx/ai` monorepo.

Deployment and image builds live in [`team-telnyx/mcp-apps`](https://github.com/team-telnyx/mcp-apps).

These apps are separate from [`tools/mcp`](../mcp), which is the generic `@telnyx/mcp` stdio proxy to the hosted Telnyx API MCP endpoint at `https://api.telnyx.com/v2/mcp`.

This reference tree is for app-specific MCP tools, UI resources, and safety flows. Generated broad API tooling and deployment-only infrastructure remain outside this directory, and customer secrets, API keys, wallet keys, or payment credentials must never be committed here.

The Usage and Cost Explorer remains available as an internal reference
implementation and local stdio app, but it is excluded from the hosted catalog,
readiness response, and `/apps/:slug/mcp` routing. Hosted public federation is
limited to Number Intelligence and Voice Monitor.

## Apps

- [`apps/number-intelligence`](apps/number-intelligence) — phone-number analysis using Telnyx Number Lookup and read-first readiness signals.
- [`apps/usage-cost-explorer`](apps/usage-cost-explorer) — balance, usage reports, billing groups, and guarded billing controls.
- [`apps/voice-monitor`](apps/voice-monitor) — read-only active-call monitoring, call timelines, call status, and recording discovery.

## Repository layout

```text
tools/mcp-apps/
  apps/
    number-intelligence/
    usage-cost-explorer/
    voice-monitor/
  src/
    # hosted HTTP/catalog entrypoint mirrored from the deployment repo
  package.json
  tsconfig.json
```

The root package is an npm workspace package with `apps/*` workspaces. Each app is a private package with its own source, tests, and README. The root `src/` hosts only the two public app servers behind `/apps/:slug/mcp` plus `/health`, `/readyz`, and `/apps` endpoints. The billing app is intentionally not imported by that hosted entrypoint.

## Setup

From `tools/mcp-apps`:

```sh
npm ci
```

The hosted service accepts a resolved, per-user Telnyx API key only from the trusted public MCP proxy. Local `.env` files are supported by the app stdio/dev servers, and `.env.example` files are included in each app directory.

## Checks

From `tools/mcp-apps`:

```sh
npm run typecheck
npm run build
npm test
```

Run an individual app with npm workspaces, for example:

```sh
npm run dev --workspace @telnyx-mcp-apps/number-intelligence
npm run dev --workspace @telnyx-mcp-apps/usage-cost-explorer
npm run dev --workspace @telnyx-mcp-apps/voice-monitor
```

## Hosted HTTP service

Build and run the mirrored hosted service locally:

```sh
npm run build
MCP_APPS_INTERNAL_TOKEN=<service-token> PORT=8080 npm run start:http
```

Useful endpoints:

- `GET /health` — liveness
- `GET /readyz` — readiness and app list
- `GET /apps` — app catalog
- `/apps/number-intelligence/mcp`
- `/apps/voice-monitor/mcp`

This service is an internal backend and must not be exposed directly to end users. Every request to `/apps/:slug/mcp`, including discovery and UI-resource reads, requires:

```http
Authorization: Bearer <service-token>
```

Tool calls additionally require the public MCP proxy to supply the resolved user's Telnyx API key in a separate header:

```http
X-Telnyx-API-Key: <resolved-KEY_...-user-key>
```

Set the service credential with `MCP_APPS_INTERNAL_TOKEN`. The public MCP proxy owns OAuth validation/exchange and must pass only a resolved Telnyx v2 API key in the documented `KEY_...` form; this backend rejects opaque OAuth tokens in the user-key header. The internal service credential is never forwarded to Telnyx.

Every publicly hosted app tool's wire descriptor declares the OAuth policy as
`[{"type":"oauth2","scopes":["admin"]}]` in top-level `securitySchemes` and
an exact `_meta.securitySchemes` compatibility mirror. The eight public tools
also declare `_meta.ui.visibility: ["app"]`, including tools that bind one of
the two public UI resources with `resourceUri`. The public proxy therefore
keeps these tools callable by their bundled apps without adding them to model
tool selection. The broad `admin` scope is the only scope currently advertised by
the `api.telnyx.com` protected-resource and authorization-server metadata. Do
not label these descriptors `read` or `write` until that resource server
actually supports and enforces those scopes; granular OAuth scopes remain a
hosted-platform release dependency.

For explicit tokenless local development only, bind to loopback and enable the escape hatch:

```sh
MCP_APPS_ALLOW_INSECURE_LOOPBACK=true MCP_APPS_HOST=127.0.0.1 PORT=8080 npm run start:http
```

This bypasses only internal service authentication. Tool calls still require `X-Telnyx-API-Key`. In this mode, both the request URL and any supplied `Host` header must identify a loopback host (including valid ports and bracketed `::1`); a non-loopback `Host` is rejected.

Browser requests with an `Origin` header are rejected with `403` by default because clients should reach these apps through the public MCP proxy. If a trusted browser deployment is intentionally required, set `MCP_APPS_CORS_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins; HTTP is accepted only for loopback development. Wildcards and URL paths are ignored. A present origin outside that allowlist is rejected rather than merely omitting CORS response headers. Server-to-server MCP clients that do not send an `Origin` header are unaffected.

The `/apps` catalog normally derives absolute `endpointUrl` values from forwarded headers. Set `MCP_APPS_PUBLIC_BASE_URL` (for example, `https://api.telnyx.com/v2/mcp`) when the gateway does not forward the public scheme, host, or path prefix. Non-loopback configured base URLs must use HTTPS, and unsafe forwarded prefixes containing query, fragment, backslash, or control delimiters are ignored. MCP app routes reject query strings.

Stateful MCP sessions expire after 15 minutes idle or one hour total and are bounded to 256 retained sessions per app. Initialization reserves capacity before asynchronous transport setup, so concurrent attempts cannot overflow the cap; additional attempts after all slots are reserved receive `429` and may retry. When a later initialization reaches the retained-session cap, the oldest retained session stays usable until the replacement succeeds and is only then closed. Failed initialization releases its reservation without evicting the original session. Set `MCP_APPS_MAX_SESSIONS_PER_APP` to a positive integer to tune the cap. Programmatic hosts can use the equivalent `maxSessionsPerApp` option on `createHostedMcpAppsHttpApp`.

## MCP Apps surface

Each app exposes a stdio MCP server using `@modelcontextprotocol/sdk` and registers MCP Apps metadata/UI resources using `@modelcontextprotocol/ext-apps`. See the app READMEs for tool names, environment variables, and safety behavior.
