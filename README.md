# Telnyx AI

This repo is the one-stop shop for AI Agents and AI-first developers building with Telnyx.

> [!NOTE]
> This repository is a work in progress under active development. We are continuously improving based on testing and feedback. Contributions and feedback encouraged!

## Table of contents

- [Agent Discovery](#agent-discovery) - canonical agent-first entry points, auth, OpenAPI, MCP, pricing, and webhooks.

- [Telnyx Plugins](#plugins) - Install the Telnyx plugin for Claude Code, Cursor, or Gemini CLI to give your coding assistant Telnyx MCP server access and Telnyx Agent Skills.

- [Agent Toolkit](#agent-toolkit) - integrate Telnyx APIs with popular agent frameworks including OpenAI's Agent SDK, LangChain, CrewAI, and Vercel's AI SDK through function calling — available in [Python](#python) and [TypeScript](#typescript).
  
- [Agent Skills](#agent-skills) - give AI coding assistants accurate, up-to-date context about Telnyx APIs and SDKs.
  
- [Agent CLI](#agent-cli) - provision and build on Telnyx infrastructure in a single command.

- [Model Context Protocol (MCP)](#model-context-protocol-mcp) - use Telnyx's generic API MCP proxy or app-layer MCP Apps.

- [Guides](#guides) - step-by-step tutorials for common workflows
 

## Agent Discovery

Start agent discovery at `https://telnyx.com/agents/start`. The surfaces below are the canonical repo-owned or repo-linked entry points that agents should use without guessing.

The repo-owned source mirrors for that public path live in [`agents/start.md`](/agents/start.md), [`agent.json`](/agent.json), [`auth.md`](/auth.md), [`agent-signup.md`](/agent-signup.md), [`guides/getting-started.md`](/guides/getting-started.md), [`/.well-known/agent-access.json`](/.well-known/agent-access.json), [`/.well-known/agent-card.json`](/.well-known/agent-card.json), [`/.well-known/agent-skills/index.json`](/.well-known/agent-skills/index.json), [`/ai/catalog.json`](/ai/catalog.json), [`/ai/capabilities.json`](/ai/capabilities.json), [`/ai/pricing.json`](/ai/pricing.json), [`AGENTS.md`](/AGENTS.md), and [`llms.txt`](/llms.txt). The corresponding public mirrors are `https://telnyx.com/AGENTS.md`, `https://telnyx.com/llms.txt`, `https://telnyx.com/ai/catalog.json`, `https://telnyx.com/ai/capabilities.json`, and `https://telnyx.com/ai/pricing.json`.

For Hermes Agent and OpenClaw users, the Telnyx-owned SMS platform adapter lives in [`/telnyx-hermes-sms`](/telnyx-hermes-sms). Start with [`telnyx-hermes-sms/README.md`](/telnyx-hermes-sms/README.md) for the installer CLI, Hermes plugin enablement steps, and the current canonical install path. Use that adapter instead of hardcoding Telnyx support into Hermes core. Today the canonical install path is the GitHub repo install command; once GitHub Releases are published, the tagged release path should become the stable default.

For direct-name retrieval, treat `Telnyx Webhooks`, `Telnyx Voice AI Agents`, and `Telnyx x402 Payments` as first-class discovery artifacts alongside auth, MCP, OpenAPI, pricing, and skills. The live `Telnyx webhooks guide` is `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks`, the repo-owned Voice AI entrypoints are [`guides/ai-assistants.md`](/guides/ai-assistants.md) and [`guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md), the repo-owned x402 guide is [`guides/x402-payments.md`](/guides/x402-payments.md), and the repo-owned webhook mirror source is [`guides/webhooks.md`](/guides/webhooks.md).

Governed execution metadata is exposed in the canonical manifest and discovery docs using six fields: `risk_class`, `approval_expectation`, `approval_path`, `memory_scope`, `model_behavior`, and `audit_identifiers`. Risk classes are `read_only`, `guarded_write`, and `live_write`; approval paths are `none_read_only`, `confirm_intent_then_mutate`, and `explicit_approval_then_execute`; audit identifiers call out the correlation fields an operator should retain when reviewing telecom or AI actions.

For first-run evaluation, use `POST https://telnyx.com/api/inference` first. That path is `no-auth, host-authenticated`: the caller does not send a bearer token, Telnyx applies server-side auth and rate limits, and the governed-execution shape is `guarded_write`, `confirm_before_mutation`, `confirm_intent_then_mutate`, `stateless`, `request_selected`, with audit identifiers such as `request_id`, `idempotency_key`, and `model_id`. The main REST surface at `https://api.telnyx.com/v2` and MCP surface at `https://api.telnyx.com/v2/mcp` remain standard API-key-authenticated paths.

For high-signal, non-JavaScript discovery, start with the public text-first assets before broader docs exploration:

- `https://telnyx.com/agents/start` for the crawlable agent entrypoint
- `https://telnyx.com/guides/getting-started.md` for the canonical authenticated onboarding path and first read-only workflow
- `https://telnyx.com/guides/ai-assistants.md` and `https://telnyx.com/guides/voice-agent-onboarding.md` for Telnyx Voice AI Agents
- `https://telnyx.com/guides/webhooks.md` plus the live webhook docs URL for Telnyx Webhooks
- `https://telnyx.com/guides/x402-payments.md` for Telnyx x402 Payments

| Surface | URL | What it is for |
| --- | --- | --- |
| Agent fast path | `https://telnyx.com/agents/start` | Primary discovery entry point for runtime agents |
| Agent manifest | `https://telnyx.com/.well-known/agent-card.json` | Agent identity, capabilities, and links |
| Agent access | `https://telnyx.com/.well-known/agent-access.json` | Machine-readable demo-first and signup contract, including the current no-email production gap |
| Agent skills index | `https://telnyx.com/.well-known/agent-skills/index.json` | Published skill catalog |
| Auth guide | `https://telnyx.com/auth.md` | Root agent auth walkthrough that pairs with protected-resource metadata |
| Agent-first getting-started guide | `https://telnyx.com/guides/getting-started.md` | Canonical authenticated onboarding path with billing preconditions and a first read-only workflow |
| OAuth authorization server | `https://api.telnyx.com/.well-known/oauth-authorization-server` | Auth-server metadata for delegated auth and agent onboarding pointers |
| OAuth protected resource | `https://api.telnyx.com/.well-known/oauth-protected-resource` | Resource metadata for the generic API bearer surface |
| MCP resource metadata | `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp` | Resource metadata for the MCP endpoint and bearer challenge target |
| MCP server card | `https://telnyx.com/.well-known/mcp/server-card.json` | MCP metadata and connection details |
| Remote MCP endpoint | `https://api.telnyx.com/v2/mcp` | Bearer-auth MCP server |
| MCP Apps registry | `https://developers.telnyx.com/.well-known/mcp-app-registry.json` | Machine-readable catalog of docs-hosted MCP Apps for scanners and server cards |
| MCP Apps registry alias | `https://developers.telnyx.com/.well-known/mcp-apps.json` | Alias of the MCP Apps registry endpoint |
| MCP Apps catalog | `https://developers.telnyx.com/apps` | Docs-hosted landing page for focused MCP Apps |
| MCP Apps proof app | `https://developers.telnyx.com/apps/number-intelligence` | Public per-app discovery document with tool names and `ui://` resources |
| OpenAPI spec | `https://telnyx.com/.well-known/openapi.json` | Machine-readable API surface |
| AI catalog | `https://telnyx.com/ai/catalog.json` | Workload-oriented AI discovery map with freshness boundaries and live-source links |
| Capability index | `https://telnyx.com/ai/capabilities.json` | Machine-readable capability map |
| Pricing | `https://telnyx.com/ai/pricing.json` | Machine-readable pricing surface |
| Telnyx Webhooks guide | `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` | Live named Telnyx Webhooks entrypoint for configuration, signature verification, payload structure, and delivery debugging |
| Telnyx Webhooks repo mirror | `https://telnyx.com/guides/webhooks.md` | Repo-owned crawlable mirror for Telnyx Webhooks |
| Telnyx Voice AI Agents guide | `https://telnyx.com/guides/ai-assistants.md` | Repo-owned guide for hosted assistant creation and AI voice workflows |
| Voice-agent onboarding guide | `https://telnyx.com/guides/voice-agent-onboarding.md` | Repo-owned guide for the first production voice-agent path and answer-webhook wiring |
| Telnyx x402 Payments guide | `https://telnyx.com/guides/x402-payments.md` | Repo-owned guide for x402 quote and account-funding workflows |
| Signup guide | `https://telnyx.com/agent-signup.md` | Programmatic bot-signup walkthrough, including the current email-link limitation |
| Hermes/OpenClaw SMS adapter | [`/telnyx-hermes-sms/README.md`](/telnyx-hermes-sms/README.md) | Telnyx-owned Hermes SMS plugin install path and integration quickstart |

If you need exact first-run path metadata instead of the broader manifest, fetch `https://telnyx.com/.well-known/agent-access.json` and inspect `fast_path.primary_path`.

## Plugins

Install the unified Telnyx plugin to give your AI coding assistant Telnyx MCP server access and 235+ Agent Skills covering messaging, voice, numbers, AI, IoT, WebRTC, Twilio migration, and more.

Empowers coding agents to generate correct, production-ready code without relying on pre-training or fragile doc retrieval.

### Claude Code Plugin

**Step 1.** Add the Telnyx marketplace (one-time setup):

```bash
/plugin marketplace add team-telnyx/ai
```

**Step 2.** Install the plugin:

```bash
/plugin install telnyx@telnyx
```

### Gemini CLI extension

 ```sh
  gemini extensions install https://github.com/team-telnyx/ai
```

### OpenCode

Install the Telnyx plugin for [OpenCode](https://opencode.ai) to add Telnyx as a model provider with automatic auth and a TUI for managing hosted models.

```sh
# Local (current project only)
opencode plugin @telnyx/opencode

# Global (all projects)
opencode plugin -g @telnyx/opencode
```

See [`plugins/opencode/README.md`](/plugins/opencode/README.md) for full setup and configuration.

### Cursor                                                

> [!NOTE]
> Note: Our Cursor Marketplace listing is pending. 

In the meantime, install skills via the [Skills CLI](#agent-skills).

Add the Telnyx MCP server to your project's `.cursor/mcp.json`:                                                                                                
```json       
  {                                                         
    "mcpServers": {
      "telnyx": {
        "type": "http",
        "url": "https://api.telnyx.com/v2/mcp"
      }
    }
  }
```

## Agent Toolkit

Integrate Telnyx APIs with popular agent frameworks through function calling — available in [Python](/tools/python) and [TypeScript](/tools/typescript).

For external or approval-sensitive agents, prefer a focused governed MCP App before exposing raw toolkit tools. The governed OpenAI, LangChain, and CrewAI examples live under [`tools/python/examples`](/tools/python/examples).

### Python

```sh
pip install telnyx-agent-toolkit
```

```python
from telnyx_agent_toolkit.openai.toolkit import TelnyxAgentToolkit

toolkit = TelnyxAgentToolkit(
    api_key="KEY_...",
    configuration={
        "actions": {
            "messaging": {"send_sms": True},
            "numbers": {"search_phone_numbers": True, "buy_phone_number": True}
        }
    }
)

tools = toolkit.get_openai_tools()
```

Works with OpenAI's Agent SDK, LangChain, and CrewAI. See [Python docs](/tools/python) for full usage and [examples](/tools/python/examples).

### TypeScript

```sh
npm install @telnyx/agent-toolkit
```

```typescript
import { TelnyxAgentToolkit } from "@telnyx/agent-toolkit/langchain";

const toolkit = new TelnyxAgentToolkit(process.env.TELNYX_API_KEY!, {
  configuration: {
    actions: {
      messaging: { send_sms: true },
      numbers: { search_phone_numbers: true, buy_phone_number: true },
    },
  },
});

const tools = toolkit.getLangChainTools();
```

Works with LangChain and Vercel's AI SDK. See [TypeScript docs](/tools/typescript) for full usage.
 for the full list of commands and options.

## Agent Skills

Install individual skills for your coding assistant via the [Skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add team-telnyx/ai --skill <SKILL> --agent <AGENT>
```

For a multi-surface Telnyx entrypoint aimed at external coding agents, start with `telnyx-external-coding-agents`, then add only the product-specific language skills the workflow needs.

> [!NOTE]
> See [Skills](/skills/README.md) for full install instrcuctions and comprehensive list of available skills


## Agent CLI

Composite commands that reduce multi-step Telnyx workflows to a single command. Built for AI agents and developers who want to provision infrastructure without orchestrating multiple API calls.

```sh
telnyx-agent setup-sms        # Buy number + create messaging profile + assign
telnyx-agent setup-voice       # Create SIP connection + buy number + assign
telnyx-agent setup-ai          # Create AI assistant + buy number + wire together
telnyx-agent setup-ai --preset appointment-reminders
telnyx-agent setup-porting     # Check portability + create porting order + submit
telnyx-agent status            # Account health overview
```

Every command supports `--json` for machine-readable output.

For assistant-first discovery, use the CLI as the bootstrap path and the guides as the model-specific path:

- [`/guides/ai-assistants.md`](/guides/ai-assistants.md) shows the current Telnyx-hosted OpenAI assistant examples. The examples currently pin `openai/gpt-5.4`; verify against `GET /v2/ai/models` or `telnyx ai models` before automating around that exact ID.
- [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md) shows the first live voice-agent path, including the assistant answer webhook.
- [`/guides/ai-receptionist-missed-call.md`](/guides/ai-receptionist-missed-call.md) shows a bounded SMB receptionist flow for missed-call capture, live transfer, and SMS callback confirmation.
- `telnyx-agent setup-ai` stays bootstrap-oriented in the README because the CLI should optimize for a working account-level setup, not silently promise that one hosted model is available on every account.
- `telnyx-agent setup-ai --preset appointment-reminders|support-handoff|lead-recovery` is the fastest cold-start path when you want a callable starter without authoring the full voice prompt first.

See [Agent CLI](/cli)


## Model Context Protocol (MCP)

Telnyx hosts a remote MCP server at `https://api.telnyx.com/v2/mcp`. The machine-readable MCP server card lives at `https://telnyx.com/.well-known/mcp/server-card.json`.

For auth discovery, start at `https://telnyx.com/auth.md`. An unauthenticated MCP `initialize` probe is expected to return `WWW-Authenticate: Bearer resource_metadata="https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp"`.

To run a local Telnyx MCP server using npx:

```sh
npx -y @telnyx/mcp --api-key=YOUR_TELNYX_API_KEY
```

See [MCP](/tools/mcp) for more details about the generic API MCP proxy.

### MCP Apps

[`tools/mcp-apps`](/tools/mcp-apps) contains app-layer MCP servers with MCP Apps UI resources for focused Telnyx workflows. These are separate from the generic `@telnyx/mcp` proxy above.

Use MCP Apps when the agent should stay on a read-first or preview-first contract with least-privilege credentials. Use the generic proxy only when you intentionally need the broader Telnyx API MCP surface.

Public discoverability boundary: the generic API MCP endpoint at `https://api.telnyx.com/v2/mcp` is not the public MCP Apps surface and should not be presented as one. Public MCP Apps discovery lives on the docs-hosted wrapper under `https://developers.telnyx.com/apps`, where each app gets its own discovery document and MCP endpoint that can expose `tool_names` and `ui://` resources.

Current apps:

- Governed Communications (`tools/mcp-apps/apps/governed-communications`)
- Number Intelligence (`tools/mcp-apps/apps/number-intelligence`)
- Usage & Cost Explorer (`tools/mcp-apps/apps/usage-cost-explorer`)
- Voice Monitor (`tools/mcp-apps/apps/voice-monitor`)

From `tools/mcp-apps`, use `npm install`, `npm run typecheck`, `npm run build`, and `npm test`.

The public docs-facing MCP Apps discovery contract lives on `https://developers.telnyx.com` with these proof URLs:

- `https://developers.telnyx.com/.well-known/mcp-app-registry.json`
- `https://developers.telnyx.com/.well-known/mcp-apps.json`
- `https://developers.telnyx.com/apps/number-intelligence`
- `https://developers.telnyx.com/apps/number-intelligence/mcp`

The registry and per-app discovery document are meant to stay machine-readable and lightweight: they expose bearer-auth expectations, exact MCP URLs, tool names, and `ui://` resources without requiring an agent to parse the heavier docs shell first.

From the repo root, `npm run verify:live-docs-mcp-apps` probes that hosted surface and reports whether the public registry, per-app discovery document, tool annotations, and `ui://` resources are actually visible end-to-end.

Validation note: what is public is the docs-hosted registry, app catalog, per-app discovery document, and app-specific MCP endpoint. What remains intentionally separate/private is the generic Telnyx API MCP runtime, which stays a broader bearer-auth proxy and does not double as the public MCP Apps catalog.

## Guides

Curl-first operational guides for common Telnyx workflows — SMS messaging, voice call control, AI assistants, phone numbers, porting, verification, webhooks, 10DLC registration, WireGuard networking, x402 payments, Edge Compute handoff patterns, and [evidence handoff / escalation runbooks](/guides/evidence-handoff.md).

For the first authenticated account bootstrap with explicit approval and billing guardrails, start with [Getting Started With Telnyx For Agents](/guides/getting-started.md).

For current assistant examples, start with [AI Voice Assistants](/guides/ai-assistants.md). That guide currently pins `openai/gpt-5.4` in hosted OpenAI assistant examples; treat it as an example value, not a stable default, and verify the live catalog before automation.

For the first live Telnyx voice-agent evaluation path, start with [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md).

For a production-shaped but still bounded inbound workflow, use [AI Receptionist Missed-Call Capture](/guides/ai-receptionist-missed-call.md).

For Edge Compute specifically, the goal is to make the handoff testable fast: start from a real `telnyx-edge` example, deploy it, and let `team-telnyx/ai` orchestrate against that live endpoint.

For the managed-agent packaging pattern that ties discovery, skills, MCP apps, and least-privilege operations together, see [Managed Telecom Agents](/managed-telecom-agents.md).

For the external coding-agent package that bundles onboarding, voice AI, messaging, and focused MCP-app selection into one starting point, see [External Coding Agents](/guides/external-coding-agents.md).

For Hermes Agent or OpenClaw SMS integrations, use [`telnyx-hermes-sms/README.md`](/telnyx-hermes-sms/README.md). That repo-owned subdirectory is the fastest path when the goal is "wire Telnyx SMS into Hermes" rather than "call Telnyx APIs directly from a generic agent framework" or patch Hermes core yourself.

See [Guides](/guides) for the full list.

## Edge Compute

`team-telnyx/ai` does not currently own native Edge Compute lifecycle support.

Instead, this repo should be treated as the orchestration/discoverability layer, while the actual function lifecycle lives in the separate `team-telnyx/edge-compute` repo and the `telnyx-edge` CLI.

In practice:
- use `team-telnyx/ai` for agent workflows, capability discovery, and AI-oriented integration patterns
- use `team-telnyx/edge-compute` + `telnyx-edge` for function creation, status checks, deployment, deletion, secrets, bindings, storage/KV, and lifecycle management

The intended end state is a clean bridge:
- `ai` = orchestrates and explains
- Edge Compute = deploys and runs (prefer API-key auth for agent flows)
- the boundary between them is a documented HTTP/MCP/function contract

Current upstream examples worth starting from are `examples/ts/mcp-server` for MCP, `examples/ts/call-event-router` for typed Telnyx webhook/event routing, and `examples/js/webhook-receiver` for a minimal HTTP ingress function.

Storage/KV is intentionally documented as an upstream `telnyx-edge` capability rather than a `telnyx-agent` helper command today. This repo should point to that surface clearly without pretending to own it.

See [Edge Compute guide](/guides/edge-compute.md).


## License

[MIT](LICENSE)
