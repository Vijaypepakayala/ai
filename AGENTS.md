# AGENTS.md

Operating instructions for AI coding agents working **on** this repo, and for runtime agents **consuming** it.

This file is a complement to `README.md` (human-facing) and `.github/CONTRIBUTING.md` (contribution flow). When in doubt, prefer the commands here.

---

## What this repo is

The one-stop shop for AI agents and AI-first developers building with Telnyx. It contains agent toolkits (Python/TypeScript), an agent CLI, a unified plugin for Claude Code / Cursor / Gemini CLI / OpenCode, an MCP proxy, 235+ Agent Skills, and operational guides.

---

## Working on this repo

### Setup

This is an npm-based monorepo, but the workspaces are independent — install per-package, not at the root.

```bash
# Root tooling (only for `npm run test:guides*`)
npm ci

# Per-package
cd cli && npm ci
cd tools/typescript && npm ci
cd tools/mcp && npm ci
cd tools/mcp-apps && npm ci
cd tools/python && pip install -e ".[dev]"
```

### Test / build / lint

| Package          | Command                            |
| ---------------- | ---------------------------------- |
| `cli/`           | `cd cli && npm test`               |
| `tools/python/`  | `cd tools/python && pytest`        |
| `tools/typescript/` | `cd tools/typescript && npm test` |
| `tools/mcp/`     | `cd tools/mcp && npm run build`    |
| `tools/mcp-apps/`| `cd tools/mcp-apps && npm run typecheck && npm run build && npm test` |
| `guides/`        | `npm run test:guides` (from root)  |
| Guides API tests | `npm run test:guides-api` (root)   |

Run the relevant package's test suite before declaring a task done. Don't run all of them — pick the one you touched.

### Where things live

| Path                    | What it contains                                                          |
| ----------------------- | ------------------------------------------------------------------------- |
| `skills/`               | Canonical agent skills (SKILL.md files). 235+ skills covering messaging, voice, numbers, AI, IoT, WebRTC, Twilio migration. |
| `providers/claude/`     | Claude Code plugin packaging — synced from `skills/` via `scripts/sync-skills.sh`. Don't edit by hand. |
| `providers/cursor/`     | Cursor plugin packaging — synced from `skills/` via `scripts/sync-skills.sh`. Don't edit by hand. |
| `plugins/opencode/`     | OpenCode plugin (auth + TUI for Telnyx-hosted models).                    |
| `tools/python/`         | Python agent toolkit (PyPI: `telnyx-agent-toolkit`).                      |
| `tools/typescript/`     | TypeScript agent toolkit (npm).                                           |
| `tools/mcp/`            | MCP proxy server for the generic Telnyx API MCP endpoint.                |
| `tools/mcp-apps/`       | Focused app-layer MCP servers with MCP Apps UI resources.                |
| `tools/ffl-cli/`        | Filling-from-life CLI tooling.                                            |
| `cli/`                  | Agent CLI for provisioning Telnyx infrastructure.                         |
| `inference/`            | Documentation for Telnyx-hosted inference.                                |
| `guides/`               | Step-by-step operational guides.                                          |
| `agents/`               | Public agent-entry landing pages such as `/agents/start`.                 |
| `ai/`                   | Source-controlled machine-readable capability and pricing discovery assets. |
| `scripts/sync-skills.sh`| Syncs `skills/` → `providers/{claude,cursor}/plugin/skills/`.             |
| `agent.json`            | Top-level agent manifest (capabilities, auth, endpoints).                 |
| `.well-known/agent-card.json` | Public agent card mirror referenced by repo discovery docs.         |
| `.well-known/agent-skills/index.json` | Public skill-catalog index built from the canonical skills set. |
| `auth.md`               | Public bearer-auth and protected-resource discovery walkthrough.          |
| `llms.txt`              | LLM-oriented discovery index for the public agent surfaces.              |
| `.claude-plugin/`       | Claude Code marketplace metadata.                                         |
| `.cursor-plugin/`       | Cursor marketplace metadata.                                              |
| `gemini-extension.json` | Gemini CLI extension manifest.                                            |

### Editing skills

`skills/` is the canonical source. After editing any skill, run:

```bash
./scripts/sync-skills.sh
```

This propagates changes to `providers/claude/` and `providers/cursor/`. Commit the sync output alongside your skill edits — don't leave them out of sync.

### Editing `agent.json`

The capability list in `agent.json` is the source of truth for what Telnyx surfaces to runtime agents. When adding a capability, also add the corresponding skill under `skills/` and the guide under `guides/` referenced by the `guide` field.

### Editing public discovery assets

The repo-owned public discovery mirrors live in `.well-known/agent-card.json`, `.well-known/agent-access.json`, `.well-known/agent-skills/index.json`, `ai/catalog.json`, `ai/capabilities.json`, `ai/pricing.json`, `auth.md`, `llms.txt`, and `agents/start.md`. Keep those files aligned with the URLs published from `README.md`, `AGENTS.md`, and `agent.json`, then run:

```bash
npm run test:discovery-assets
```

### Code style

- TypeScript: ES2020+, strict mode, ESM where the package supports it.
- Python: 3.10+, PEP 8, type hints required for public functions.
- Markdown: GitHub-flavored. Use ATX headings (`#`, not underlines).
- One change per PR — don't bundle skill edits with toolkit refactors.

### Commit and PR conventions

- Conventional Commits prefix in the title (`feat:`, `fix:`, `chore:`, `docs:`).
- Sign commits (the maintainers' setup expects verified signatures).
- One concern per PR. Keep skill regenerations (`scripts/sync-skills.sh`) in the same PR as the skill source change.
- Reference the issue number in the PR description if one exists.

### Don'ts

- Don't edit files under `providers/claude/plugin/skills/` or `providers/cursor/plugin/skills/` directly — they are generated. Edit the source under `skills/` and run `./scripts/sync-skills.sh`.
- Don't introduce a root-level test runner — each package has its own.
- Don't commit credentials, API keys, or `.env` files. Use the patterns in existing `.env.example` files.
- Don't `npm install` at the root and expect it to install workspace deps — each package has its own `package.json` and `node_modules/`.
- Don't add new top-level directories without updating this file and `README.md`'s table of contents.

---

## Consuming this repo as a runtime agent

If you are an AI agent **using** Telnyx (not modifying this repo), the entry points are:

| You want to…                                              | Start here                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Discover Telnyx capabilities                              | `https://telnyx.com/agents/start` first, then `/agent.json` in this repo as the local mirror |
| Complete the first authenticated Telnyx workflow          | `https://telnyx.com/guides/getting-started.md`                           |
| Generate Telnyx code with a coding assistant              | Install the plugin: `team-telnyx/ai` marketplace (Claude / Cursor / Gemini / OpenCode) — see `README.md` |
| Use Telnyx APIs from an agent framework (OpenAI Agents SDK, LangChain, CrewAI, Vercel AI SDK) | `tools/python/` or `tools/typescript/`                                   |
| Talk to Telnyx via MCP                                    | `https://api.telnyx.com/v2/mcp` (Bearer auth) — proxy in `tools/mcp/`   |
| Provision Telnyx infrastructure programmatically          | `cli/` — `npm install -g @telnyx/cli`                                   |
| Get an API key as an agent                                | `https://telnyx.com/agent-signup.md` (PoW-based programmatic signup)   |

Pick the interface that matches the control boundary:

| Surface | Start here | Use when | Memory boundary | Approval posture |
| --- | --- | --- | --- | --- |
| Crawlable chooser | `https://telnyx.com/agents/start` | First read for auth, manifest, MCP, webhooks, Voice AI, and x402 entrypoints | Read-only document; no conversation state implied | No extra approval; discovery only |
| Manifest | `https://telnyx.com/.well-known/agent-card.json` or local `/agent.json` | Need machine-readable links, governed-execution fields, and stable discovery URLs | Read-only manifest; no execution state is stored there | No extra approval; inspect `risk_class`, `approval_expectation`, and `approval_path` first |
| Auth contract | `https://telnyx.com/auth.md` and `https://telnyx.com/.well-known/agent-access.json` | Need bearer-auth rules, protected-resource metadata, zero-signup evaluation, or signup limits | Read-only auth metadata | No extra approval for reading; follow capability-specific approval before writes |
| MCP | `https://api.telnyx.com/v2/mcp` | Agent already speaks MCP and should discover tools dynamically | Host-controlled account state; app-layer MCP Apps narrow state to the app contract | Approval depends on the tool capability; preserve audit identifiers |
| Toolkit | `tools/python/` or `tools/typescript/` | Need framework-native tools inside OpenAI Agents SDK, LangChain, CrewAI, or Vercel AI SDK | Your framework owns orchestration memory; Telnyx-side retention still follows each capability's `memory_scope` | Approval depends on the capability you expose |
| CLI | `cli/` | Need composable provisioning or account operations from a terminal or automation step | Host-controlled account state | Confirm intent before billed or live provisioning actions |
| Skills | `skills/` | Need retrieval-only product context for coding assistants before handing them raw account access | Retrieval context only; no Telnyx runtime state is created by installing a skill | No extra approval to read or install context; separate approval still applies to live actions |

### Auth (for runtime consumers)

- **API keys**: Bearer token, `Authorization: Bearer <key>`. Get one via the portal or programmatically via `https://telnyx.com/agent-signup.md`.
- **OAuth**: Metadata at `https://api.telnyx.com/.well-known/oauth-authorization-server`.
- **MCP**: Bearer auth against `https://api.telnyx.com/v2/mcp`. Card at `https://telnyx.com/.well-known/mcp/server-card.json`.
- **Auth discovery**: Start at `https://telnyx.com/auth.md`, then follow `https://api.telnyx.com/.well-known/oauth-protected-resource` or the MCP-specific `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp`.
- **Retry and idempotency**: For side-effecting requests, send a fresh `Idempotency-Key` on every mutating call, reuse that same key only when retrying the exact same intended write after a timeout, transport failure, or ambiguous client-side result, treat `202 Accepted` as incomplete work, and honor `Retry-After` while polling for a terminal outcome.

See `agent.json` (`auth` block) for the canonical auth contract.

### Discovery surfaces

| Surface                                          | URL                                                       |
| ------------------------------------------------ | --------------------------------------------------------- |
| Agent fast path (entry point)                    | `https://telnyx.com/agents/start`                         |
| Agent manifest                                   | `https://telnyx.com/.well-known/agent-card.json`          |
| Agent access (signup contract)                   | `https://telnyx.com/.well-known/agent-access.json`        |
| Agent skills index                               | `https://telnyx.com/.well-known/agent-skills/index.json`  |
| Runtime agent contract                           | `https://telnyx.com/AGENTS.md`                            |
| Auth guide                                       | `https://telnyx.com/auth.md`                              |
| Agent-first getting-started guide                | `https://telnyx.com/guides/getting-started.md`            |
| LLM index                                        | `https://telnyx.com/llms.txt`                             |
| OAuth authorization server                       | `https://api.telnyx.com/.well-known/oauth-authorization-server` |
| OAuth protected resource                         | `https://api.telnyx.com/.well-known/oauth-protected-resource` |
| MCP resource metadata                            | `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp` |
| MCP server card                                  | `https://telnyx.com/.well-known/mcp/server-card.json`     |
| MCP Apps registry                                | `https://developers.telnyx.com/.well-known/mcp-app-registry.json` |
| MCP Apps registry alias                          | `https://developers.telnyx.com/.well-known/mcp-apps.json` |
| MCP Apps catalog                                 | `https://developers.telnyx.com/apps`                      |
| MCP Apps proof app                               | `https://developers.telnyx.com/apps/number-intelligence`  |
| OpenAPI spec                                     | `https://telnyx.com/.well-known/openapi.json`             |
| AI catalog                                       | `https://telnyx.com/ai/catalog.json`                      |
| Capability index                                 | `https://telnyx.com/ai/capabilities.json`                 |
| Pricing                                          | `https://telnyx.com/ai/pricing.json`                      |
| Telnyx webhooks guide                           | `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` |

---

## Reporting issues

- **Bugs / feature requests**: open an issue.
- **Security issues**: see `.github/SECURITY.md` — do not file public issues for vulnerabilities.

---

_Last reviewed: 2026-05-07_
