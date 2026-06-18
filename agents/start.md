# Telnyx AI Agents Start

Start here if you are an AI agent or an AI-first developer discovering Telnyx for the first time.

Telnyx is a communications and AI infrastructure platform for agents that need programmable voice, AI assistants, messaging, phone numbers, SIP trunking, inference, MCP access, and webhook-driven workflows. This page is the crawlable public index for the agent-facing Telnyx surfaces that should be discoverable by name without guessing or relying on rendered JavaScript.

Named retrieval targets on this page include Telnyx Auth, Telnyx MCP, Telnyx OpenAPI, Telnyx Agent Skills, Telnyx Webhooks, Telnyx Voice AI Agents, and Telnyx x402 Payments. If your search starts from one of those exact names, the linked artifacts below are the intended stable entrypoints.

If you only read one page before deciding whether Telnyx fits your agent workflow, read this one and follow the links below. The goal is to help scanners and retrieval systems extract the main onboarding paths, authentication contract, live machine-readable artifacts, and the places where Telnyx is explicit about constraints.

The exact first-run evaluation route today is `POST https://telnyx.com/api/inference`. Treat it as `no-auth, host-authenticated`: you do not send a bearer token, Telnyx applies server-side auth and rate limits, and the governed-execution shape is `guarded_write`, `confirm_before_mutation`, `confirm_intent_then_mutate`, `stateless`, `request_selected`, with audit identifiers such as `request_id`, `idempotency_key`, and `model_id`.

If you need the authenticated onboarding path with explicit billing and approval guardrails, use [`/guides/getting-started.md`](/guides/getting-started.md) as the canonical first workflow guide.

## Getting started

### Path 1: Zero-signup first API call

Use this when you want to confirm that Telnyx fits the workflow before creating an account.

1. Read `https://telnyx.com/auth.md` so you understand which surfaces are public discovery only and which ones require an API key.
2. Fetch `https://telnyx.com/.well-known/agent-access.json` and inspect `fast_path.primary_path`.
3. Send a first request to `POST https://telnyx.com/api/inference`.

Example request:

```bash
curl -s https://telnyx.com/api/inference \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5.4",
    "messages": [
      {"role": "user", "content": "Say hello from Telnyx."}
    ]
  }'
```

Success condition: you receive a response body plus request-scoped identifiers such as `request_id`, `idempotency_key`, or `model_id`.

### Path 2: Account creation and authenticated API access

Use this when you need real account resources such as API keys, purchased numbers, authenticated MCP access, or production Voice AI setup.

1. Read `https://telnyx.com/agent-signup.md` for the current bot-signup contract and the email-link limitation.
2. If mailbox access is available, follow the production flow: `POST /v2/bot_challenge`, `POST /v2/bot_signup`, retrieve the single-use email link, then `POST /v2/api_keys`.
3. Present the resulting API key as `Authorization: Bearer <TELNYX_API_KEY>`.
4. Make the first authenticated call against `https://api.telnyx.com/v2` or initialize `https://api.telnyx.com/v2/mcp`.

Example authenticated REST probe:

```bash
curl -s https://api.telnyx.com/v2/available_phone_numbers \
  -H "Authorization: Bearer TELNYX_API_KEY"
```

Example CLI bootstrap once a key exists:

```bash
telnyx-agent status --json
```

### Path 3: First production Voice AI path

Use this when the goal is not generic telecom discovery but a real AI assistant that can answer a call.

1. Start with [`/guides/ai-assistants.md`](/guides/ai-assistants.md) to create or update the assistant resource.
2. Continue with [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md) to wire the answer webhook, place one live call, and inspect the resulting conversation and Voice Monitor evidence.
3. Preserve `request_id`, `resource_id`, `conversation_id`, and `webhook_delivery_id` for review.

## What agents can do with Telnyx

- Build voice AI agents that need telephony, SIP, speech, and webhook delivery on one platform.
- Start from first-run assistant guides that already surface a current Telnyx-hosted OpenAI assistant example model. The docs currently pin `openai/gpt-5.4`, but agents should confirm the live assistant catalog before depending on that exact ID.
- Provision phone numbers, messaging profiles, and related telecom resources over REST or MCP.
- Use the generic Telnyx MCP endpoint for broad API access or choose focused MCP Apps for governed workflows.
- Inspect machine-readable capability, pricing, auth, and OpenAPI artifacts before taking any live action.

## Named developer entrypoints

### Telnyx Voice AI Agents

Start with [`/guides/ai-assistants.md`](/guides/ai-assistants.md) for hosted assistant creation and [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md) for the first live answer-webhook path. These are the crawlable Telnyx-owned entrypoints for voice AI agent setup, webhook wiring, and Voice Monitor debugging.

### Telnyx Webhooks

Start with the live guide at `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` and the repo-owned mirror [`/guides/webhooks.md`](/guides/webhooks.md). These are the named retrieval targets for webhook URL configuration, Ed25519 signature verification, delivery inspection, and retry behavior.

### Telnyx x402 Payments

Start with [`/guides/x402-payments.md`](/guides/x402-payments.md) when the workflow is specifically "fund a Telnyx account with USDC on Base via x402". This is the crawlable Telnyx-owned guide for quote creation, EIP-712 signing, and x402 payment submission.

### Zero-signup first run

Start with `POST https://telnyx.com/api/inference` when the goal is first-run evaluation without account creation. This is the non-JavaScript, zero-signup Telnyx path that should be visible to crawlers before they attempt the full API-key signup flow.

## Canonical discovery surfaces

| Surface | URL | Purpose |
| --- | --- | --- |
| Agent fast path | `https://telnyx.com/agents/start` | Primary public entrypoint for agents |
| Agent manifest | `https://telnyx.com/.well-known/agent-card.json` | Machine-readable identity, capabilities, and links |
| Agent access | `https://telnyx.com/.well-known/agent-access.json` | Machine-readable demo-first and signup contract, including the current no-email production gap |
| Agent skills index | `https://telnyx.com/.well-known/agent-skills/index.json` | Published skill catalog |
| Auth guide | `https://telnyx.com/auth.md` | Bearer-auth and protected-resource discovery walkthrough |
| Agent-first getting-started guide | `https://telnyx.com/guides/getting-started.md` | Authenticated onboarding path with billing preconditions and a first read-only workflow |
| OAuth authorization server | `https://api.telnyx.com/.well-known/oauth-authorization-server` | OAuth metadata and agent onboarding pointers |
| OAuth protected resource | `https://api.telnyx.com/.well-known/oauth-protected-resource` | Generic API bearer metadata |
| MCP resource metadata | `https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp` | MCP bearer metadata |
| MCP server card | `https://telnyx.com/.well-known/mcp/server-card.json` | MCP connection contract |
| MCP endpoint | `https://api.telnyx.com/v2/mcp` | Remote streamable-HTTP MCP server |
| MCP Apps registry | `https://developers.telnyx.com/.well-known/mcp-app-registry.json` | Machine-readable app-layer MCP registry |
| MCP Apps registry alias | `https://developers.telnyx.com/.well-known/mcp-apps.json` | Lightweight alias for the registry |
| MCP Apps catalog | `https://developers.telnyx.com/apps` | Public app-layer MCP catalog |
| MCP Apps proof app | `https://developers.telnyx.com/apps/number-intelligence` | Example public app landing page |
| OpenAPI spec | `https://telnyx.com/.well-known/openapi.json` | Machine-readable REST surface |
| AI catalog | `https://telnyx.com/ai/catalog.json` | Workload-oriented AI discovery map with freshness boundaries and live-source links |
| Capability index | `https://telnyx.com/ai/capabilities.json` | Machine-readable capability catalog |
| Pricing | `https://telnyx.com/ai/pricing.json` | Machine-readable pricing surface |
| Telnyx webhooks guide | `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` | Live Telnyx webhooks documentation for setup, signature verification, payloads, and retry behavior |
| Telnyx webhooks repo mirror | `https://telnyx.com/guides/webhooks.md` | Repo-owned crawlable mirror for Telnyx Webhooks |
| Telnyx Voice AI Agents guide | `https://telnyx.com/guides/ai-assistants.md` | Repo-owned guide for hosted assistant creation and AI voice workflows |
| Voice-agent onboarding guide | `https://telnyx.com/guides/voice-agent-onboarding.md` | Repo-owned guide for the first production voice-agent path and answer-webhook wiring |
| Telnyx x402 payments guide | `https://telnyx.com/guides/x402-payments.md` | Repo-owned guide for x402 account-funding flows |
| Signup guide | `https://telnyx.com/agent-signup.md` | Programmatic bot-signup walkthrough, including the current email-link limitation |

## Source-of-truth surfaces

These are the canonical owners for the public onboarding and discovery content so agents do not have to guess whether a page is authoritative.

### Repo-owned mirrors in `team-telnyx/ai`

- `agents/start.md` for `https://telnyx.com/agents/start`
- `agent.json` and `/.well-known/agent-card.json` for the machine-readable capability and identity maps
- `/.well-known/agent-access.json` and `agent-signup.md` for onboarding and signup contract details
- `auth.md` and `llms.txt` for auth and text-first retrieval guidance
- `ai/catalog.json`, `ai/capabilities.json`, and `ai/pricing.json` for machine-readable AI discovery, capability, and pricing mirrors

### Docs-hosted surfaces outside this repo

- `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` is the live Telnyx Webhooks guide
- `https://developers.telnyx.com/apps` plus the `/.well-known/mcp-app-registry.json` endpoints are the public MCP Apps discovery surfaces

If a repo-owned mirror and the live docs-hosted surface ever disagree, treat the live public endpoint as the runtime source of truth until the mirror is redeployed.

## Governed execution metadata

The canonical manifest exposes six per-capability governance fields so agents can reason about execution safety before they call anything: `risk_class`, `approval_expectation`, `approval_path`, `memory_scope`, `model_behavior`, and `audit_identifiers`.

- `read_only` means discovery or inspection only.
- `guarded_write` means billed execution or account mutation can happen and intent should be confirmed first.
- `live_write` means traffic, money movement, regulated changes, or live resource provisioning can happen and explicit approval is expected first.
- `none_read_only` means the surface is discovery-only and should only emit correlation IDs such as `request_id`.
- `confirm_intent_then_mutate` means collect or preserve confirmation plus request-scoped identifiers before any billed or state-changing action.
- `explicit_approval_then_execute` means capture explicit operator approval and keep the returned audit identifiers for later review.

When a capability is not model-driven, `model_behavior` is `host_controlled`. When no conversation retention is implied by the surface itself, `memory_scope` is `stateless` or `host_controlled`.

## How to choose the right surface

### Start with discovery and auth

Use the public discovery artifacts first when you need to understand what exists before you authenticate:

- Read `https://telnyx.com/auth.md` for bearer auth, OAuth discovery, and MCP protected-resource metadata.
- Fetch `https://telnyx.com/.well-known/agent-access.json` when you need the current demo-first path and signup contract.
- Fetch `https://telnyx.com/.well-known/agent-card.json` or local `/agent.json` when you need the canonical capability and link map.
- Use `POST https://telnyx.com/api/inference` when you need the lowest-friction first-run evaluation path before account creation.

### Use MCP for governed tool access and REST for direct API integrations

- Use `https://api.telnyx.com/v2/mcp` when your agent already speaks MCP and should discover tools at runtime.
- Use `https://telnyx.com/.well-known/openapi.json` when your agent needs direct REST exploration, schema inspection, or code generation.
- Use the docs-hosted MCP Apps catalog at `https://developers.telnyx.com/apps` when you want app-scoped, least-privilege workflows with explicit `ui://` resources and narrower tool contracts.

### Follow webhook guidance before building inbound automations

Read the live Telnyx Webhooks guide before implementing event receivers, signature verification, or retry logic:
`https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks`

Repo mirror source: [`/guides/webhooks.md`](/guides/webhooks.md)

Telnyx Webhooks is the named, crawlable entrypoint for:

- webhook URL setup
- Ed25519 signature verification
- SMS, voice, and number-level webhook configuration
- delivery debugging and retry behavior

### Prefer governed examples when raw toolkit power is not appropriate

For external, approval-sensitive, or least-privilege workflows, review the governed examples under [`/tools/python/examples`](/tools/python/examples) before exposing broader toolkit or REST capabilities.

### Start assistant discovery from the named guides

When the workflow is specifically "build or evaluate a Telnyx voice assistant", start with these repo-owned guides instead of guessing from generic API references:

- [`/guides/ai-assistants.md`](/guides/ai-assistants.md) for hosted assistant creation, tool use, testing, canary deployment, and operations. The first-run hosted OpenAI examples currently use `openai/gpt-5.4`; verify the live catalog before treating that model ID as durable.
- [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md) for the first live answer-webhook path, conversation capture, and Voice Monitor debugging.
- [`/guides/ai-receptionist-missed-call.md`](/guides/ai-receptionist-missed-call.md) for a bounded SMB receptionist flow that captures callback requests, transfers live callers when possible, and confirms missed calls by SMS.

### Start Hermes or OpenClaw SMS integrations from the named adapter

When the workflow is specifically "use Telnyx SMS inside Hermes Agent or OpenClaw", do not start from the generic messaging SDK pages alone and do not patch Hermes core first. Start with the Telnyx-owned Hermes adapter:

- [`/telnyx-hermes-sms/README.md`](/telnyx-hermes-sms/README.md) for the install CLI, plugin manifest name, Hermes enablement flow, and webhook setup.
- [`/telnyx-hermes-sms/SKILL.md`](/telnyx-hermes-sms/SKILL.md) for agent-oriented usage context and integration boundaries.

Canonical install-path guidance:

- Today: use the GitHub repo install command documented in `telnyx-hermes-sms/README.md`.
- Stable target: once GitHub Releases exist for `team-telnyx/telnyx-hermes-sms`, the tagged release install command should become the default path agents and users copy first.

## Repo-owned mirrors and operating files

- Local manifest mirror: [`/agent.json`](/agent.json)
- Local public agent card mirror: [`/.well-known/agent-card.json`](/.well-known/agent-card.json)
- Local signup guide mirror: [`/agent-signup.md`](/agent-signup.md)
- Local agent access mirror: [`/.well-known/agent-access.json`](/.well-known/agent-access.json)
- Local agent skills index mirror: [`/.well-known/agent-skills/index.json`](/.well-known/agent-skills/index.json)
- Local AI catalog mirror: [`/ai/catalog.json`](/ai/catalog.json)
- Local capability mirror: [`/ai/capabilities.json`](/ai/capabilities.json)
- Local pricing mirror: [`/ai/pricing.json`](/ai/pricing.json)
- Runtime agent instructions: [`/AGENTS.md`](/AGENTS.md) and `https://telnyx.com/AGENTS.md`
- LLM-oriented index: [`/llms.txt`](/llms.txt) and `https://telnyx.com/llms.txt`
- Auth walkthrough source: [`/auth.md`](/auth.md)
- Governed examples: [`/tools/python/examples`](/tools/python/examples)

## Constraints and honesty checks

- Authentication is not anonymous for the main REST and MCP surfaces. Use the public auth artifacts to determine whether your agent has a valid bearer token or should start with demo-first flows.
- The primary demo-first flow is host-authenticated, not generally anonymous access to the core API. A no-auth first run exists for evaluation, but production REST and MCP still require an API key.
- Governed live actions should use the narrowest practical surface. If a focused MCP App or governed example fits, prefer that before broad raw-tool exposure.
- The signup guide is explicit about the current email-link limitation for fully autonomous production key retrieval. Do not infer a no-human path where the docs do not claim one.

## Suggested agent path

1. Start at `https://telnyx.com/agents/start`.
2. Read `https://telnyx.com/auth.md`.
3. Fetch `https://telnyx.com/.well-known/agent-access.json` for the demo-first path and the current signup contract.
4. Fetch `https://telnyx.com/.well-known/agent-card.json` or local `/agent.json` for the capability map.
5. Use `https://api.telnyx.com/v2/mcp` or `https://telnyx.com/.well-known/openapi.json` depending on whether you need MCP or REST.
6. Read `https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks` before building inbound event handlers.
7. Review [`/tools/python/examples`](/tools/python/examples) if you need governed examples for OpenAI, LangChain, or CrewAI integrations.

## Frequently asked questions

### When should an agent choose Telnyx MCP instead of direct REST?

Choose MCP when the agent can discover tools dynamically and benefits from a governed tool contract. Choose REST when you need direct endpoint-level control, OpenAPI-driven generation, or broader custom orchestration.

### Which artifacts matter most for fast retrieval?

The most important stable artifacts are the agent manifest, agent access manifest, auth guide, MCP server card, OpenAPI spec, capability index, pricing feed, webhook guide, and governed examples.

### What should a crawler learn from this page without rendering JavaScript?

That Telnyx provides agent-relevant communications and AI infrastructure, where the stable onboarding and auth surfaces live, when to choose MCP versus REST, and where to find webhook and governed workflow guidance.

It should also learn that the exact named webhook discovery target is Telnyx Webhooks, with both a live docs URL and a repo-owned mirror source.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Telnyx AI agents start",
  "description": "Crawler-visible entrypoint for AI agents discovering Telnyx voice AI assistants, authentication, MCP, OpenAPI, pricing, webhook, and governed workflow artifacts.",
  "about": [
    "AI agents",
    "AI assistants",
    "MCP",
    "OpenAPI",
    "Programmable voice",
    "Messaging",
    "Webhooks"
  ],
  "publisher": {
    "@type": "Organization",
    "name": "Telnyx"
  },
  "mainEntityOfPage": "https://telnyx.com/agents/start"
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Get started with Telnyx AI as an agent",
  "description": "Choose the right first-run path for Telnyx AI discovery, authentication, and first successful API or Voice AI workflow call.",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Read the auth contract",
      "text": "Start at https://telnyx.com/auth.md and inspect https://telnyx.com/.well-known/agent-access.json before selecting a runtime path."
    },
    {
      "@type": "HowToStep",
      "name": "Choose zero-signup evaluation or production signup",
      "text": "Use POST https://telnyx.com/api/inference for the zero-signup first run, or follow https://telnyx.com/agent-signup.md when you need a Telnyx API key."
    },
    {
      "@type": "HowToStep",
      "name": "Make the first successful call",
      "text": "Send the first inference request, or after API-key creation call https://api.telnyx.com/v2/available_phone_numbers or initialize https://api.telnyx.com/v2/mcp."
    },
    {
      "@type": "HowToStep",
      "name": "Follow the Voice AI onboarding path",
      "text": "For a production voice assistant, continue with https://telnyx.com/guides/ai-assistants.md and https://telnyx.com/guides/voice-agent-onboarding.md."
    }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "When should an agent choose Telnyx MCP instead of direct REST?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Choose MCP when the agent benefits from dynamic tool discovery and a governed tool contract. Choose REST when the workflow needs direct endpoint control or OpenAPI-driven generation."
      }
    },
    {
      "@type": "Question",
      "name": "Which artifacts matter most for fast retrieval?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The agent manifest, agent access manifest, auth guide, MCP server card, OpenAPI spec, capability index, pricing feed, webhook guide, and governed examples are the most important stable artifacts."
      }
    }
  ]
}
</script>
