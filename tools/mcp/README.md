# @telnyx/mcp

The Telnyx [Model Context Protocol](https://modelcontextprotocol.com/) server allows you to integrate with Telnyx APIs through function calling. This protocol supports various tools to interact with different Telnyx services.

## Setup

Telnyx hosts a remote MCP server at `https://api.telnyx.com/v2/mcp`.

To run the Telnyx MCP server locally using npx:

```bash
npx -y @telnyx/mcp --api-key=YOUR_TELNYX_API_KEY
```

Or set the environment variable:

```bash
export TELNYX_API_KEY=YOUR_KEY
npx -y @telnyx/mcp
```

## Agent-Access Contract

Use the same published access contract here that the repo exposes elsewhere:

- Start auth discovery at `https://telnyx.com/auth.md` and `https://telnyx.com/.well-known/agent-access.json`.
- The hosted MCP endpoint is `https://api.telnyx.com/v2/mcp`. Its bearer metadata lives at `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp`.
- When an unauthenticated MCP probe returns `WWW-Authenticate: Bearer resource_metadata="..."`, follow that `resource_metadata` hint first instead of guessing alternate auth URLs.
- Treat `https://telnyx.com/ai/rate-limits.json` as the canonical machine-readable source for rate-limit headers, `429` handling, and the representative async polling pattern used across broader Telnyx AI surfaces. Honor `Retry-After` and keep returned audit identifiers.
- If the MCP tool you call triggers a side effect, keep the same retry and idempotency posture as the underlying write flow: fresh `Idempotency-Key` per covered mutating intent, exact-match reuse only for retries, and `202 Accepted` means in progress rather than complete.
- Tool approval posture is capability-specific. Inspect the published governance metadata before exposing broad write tools to an external or multi-tenant runtime.
- This package is a proxy and repo-owned usage guide. The remote MCP server behavior is host-owned and runtime-discovered from the live bearer challenge, protected-resource metadata, and tool contract.

## How it works

This package proxies MCP requests to the remote Telnyx MCP server over HTTP.
