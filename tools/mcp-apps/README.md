# Telnyx MCP Apps

Telnyx MCP Apps are app-layer MCP servers with focused tools and MCP Apps UI resources for specific Telnyx workflows. This directory keeps local/reference app source in the `team-telnyx/ai` monorepo.

Deployment and image builds live in [`team-telnyx/mcp-apps`](https://github.com/team-telnyx/mcp-apps).

These apps are separate from [`tools/mcp`](../mcp), which is the generic `@telnyx/mcp` stdio proxy to the hosted Telnyx API MCP endpoint at `https://api.telnyx.com/v2/mcp`.

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
  package.json
  tsconfig.json
```

The root package is an npm workspace package with `apps/*` workspaces. Each app is a private package with its own source, tests, and README.

## Setup

From `tools/mcp-apps`:

```sh
npm install
```

Each app reads `TELNYX_API_KEY` from the environment when making live Telnyx API calls. Local `.env` files are supported by the app servers and `.env.example` files are included in each app directory.

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

## MCP Apps surface

Each app exposes a stdio MCP server using `@modelcontextprotocol/sdk` and registers MCP Apps metadata/UI resources using `@modelcontextprotocol/ext-apps`. See the app READMEs for tool names, environment variables, and safety behavior.
