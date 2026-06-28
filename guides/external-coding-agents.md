# External Coding Agents

> The smallest useful Telnyx package for Codex, Cursor, Claude Code, Gemini CLI, and similar coding agents: one curated skill-pack plus focused MCP apps for voice AI, messaging, and onboarding.

## Prerequisites

- Telnyx API key when you need authenticated MCP, SDK, or live API access
- One coding agent runtime such as Codex, Cursor, Claude Code, Gemini CLI, or OpenCode
- The Skills CLI when you want repo-hosted skill installation
- Basic familiarity with [AI Voice Assistants](/guides/ai-assistants.md), [SMS Messaging](/guides/sms-messaging.md), and [Webhooks](/guides/webhooks.md)

## Quick Start

Install the curated entrypoint skill, then add only the product skills your workflow needs:

```sh
npx skills add team-telnyx/ai --skill telnyx-external-coding-agents --agent codex
npx skills add team-telnyx/ai --skill telnyx-ai-assistants-python --agent codex
npx skills add team-telnyx/ai --skill telnyx-messaging-python --agent codex
```

Start discovery from the public agent surfaces before writing code:

```bash
curl https://telnyx.com/.well-known/agent-card.json
curl https://telnyx.com/.well-known/agent-skills/index.json
curl https://telnyx.com/auth.md
curl https://telnyx.com/ai/rate-limits.json
```

Then follow this order:

1. Use this skill-pack to pick the right surface.
2. Use the product guide and language skill for implementation.
3. Use `voice-monitor` for read-only voice debugging.
4. Use `governed-communications` for bounded messaging or outbound communication actions.

## The Package

The recommended Telnyx package for external coding agents is:

- `skills/telnyx-external-coding-agents/SKILL.md` as the entrypoint
- `tools/mcp-apps/apps/voice-monitor` for read-only voice diagnostics
- `tools/mcp-apps/apps/governed-communications` for bounded outbound messaging, calling, and verification
- the product guide and language skill that matches the workflow being implemented

This package is intentionally narrower than the full Telnyx API or the generic MCP proxy. The goal is to help coding agents build one working flow correctly before they touch the broad surface.

## Why This Shape

External coding agents are strongest when the platform gives them:

- one stable discovery path
- one clear auth path
- one bounded execution surface per workflow
- preserved operational IDs for debugging and escalation

This repo already has those pieces. The missing layer was a packaged starting point that tells external agents which surface to use first.

## Recommended Flow

### 1. Discovery And Auth

Start every integration here:

- `https://telnyx.com/agents/start`
- `https://telnyx.com/auth.md`
- `https://telnyx.com/agent-signup.md`
- `https://telnyx.com/.well-known/agent-card.json`
- `https://telnyx.com/.well-known/agent-skills/index.json`

Use those surfaces before broader docs search. They are the highest-signal entrypoints for agent runtimes.

### 2. Voice AI Bootstrap

For a first voice AI implementation:

1. Use [AI Voice Assistants](/guides/ai-assistants.md) to create the assistant.
2. Use [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) to wire the answer webhook.
3. Save `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id`.
4. Use [Voice Monitor](/tools/mcp-apps/apps/voice-monitor/README.md) for the first diagnosis pass after a real call.

This is the lowest-friction path for proving a real Telnyx voice agent without handing an external coding agent the entire voice API surface.

Python example:

```python
import requests

headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
assistant = requests.post(
    "https://api.telnyx.com/v2/ai/assistants",
    headers=headers,
    json={
        "name": "Evaluation Voice Agent",
        "instructions": "Answer briefly and capture the caller goal.",
        "model": "openai/gpt-5.4",
    },
).json()

print(assistant["data"]["id"])
```

### 3. Messaging And Follow-Up

For outbound messaging or SMS callback flows:

1. Use [SMS Messaging](/guides/sms-messaging.md) for request shape and resource model.
2. Use [Governed Communications](/tools/mcp-apps/apps/governed-communications/README.md) when the runtime should send messages or inspect their status from an allowlisted sender set.
3. Load only the matching language skill, such as `telnyx-messaging-python` or `telnyx-messaging-javascript`.

For direct REST writes outside the governed app boundary, follow this contract:

- Generate and send a fresh `Idempotency-Key` on every mutating request that creates, confirms, retries, or otherwise changes state.
- Reuse that same key only when retrying the exact same intended write after a timeout, transport failure, or ambiguous client-side result.
- Read `https://telnyx.com/ai/rate-limits.json` so the client uses the canonical `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` headers instead of inventing its own throttle model.
- Treat `202 Accepted` as incomplete work. Poll the resource or operation-status endpoint until you see a terminal status, and honor `Retry-After` when Telnyx returns it.
- Do not let the model invent completion from the initial write response alone when the API family documents asynchronous processing.

TypeScript example:

```typescript
import { randomUUID } from "node:crypto";

const response = await fetch("https://api.telnyx.com/v2/messages", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
  },
  body: JSON.stringify({
    from: "+15551234567",
    to: "+15557654321",
    text: "Your Telnyx workflow is live.",
  }),
});

const body = await response.json();
console.log(body.data.id);
```

### 4. Onboarding And Webhooks

For onboarding and trust boundaries:

1. Use `agent-signup.md` and `auth.md` for account and bearer-auth expectations.
2. Use [Webhooks](/guides/webhooks.md) for Ed25519 signature verification and delivery debugging.
3. Prefer a focused read-first or governed-write MCP app before using the broad proxy.

## Example Bundles

### Python Voice Agent Bundle

- `telnyx-external-coding-agents`
- `telnyx-ai-assistants-python`
- `telnyx-voice-python`
- `telnyx-messaging-python`
- `voice-monitor` MCP app
- `governed-communications` MCP app

### TypeScript Messaging Bundle

- `telnyx-external-coding-agents`
- `telnyx-messaging-javascript`
- `telnyx-messaging-profiles-javascript`
- `telnyx-account-javascript`
- `governed-communications` MCP app

## How This Reduces Hallucination

This package reduces integration mistakes in concrete ways:

- It keeps discovery, auth, implementation, and diagnostics on named repo surfaces instead of generic web search.
- It pushes live execution into focused MCP apps with bounded tool lists and least-privilege expectations.
- It preserves the exact IDs humans need for escalation instead of letting the model summarize them away.
- It separates read-only diagnosis from mutating follow-up work, which keeps prompts simpler and safer.

## When To Use The Broad MCP Proxy

Use `https://api.telnyx.com/v2/mcp` only when the focused apps are too narrow for the job. Good examples:

- a custom workflow needs an API family that is not yet packaged as an MCP app
- an expert operator is doing exploratory work across multiple Telnyx products
- the coding agent is implementing against the SDK or OpenAPI surface directly and only needs occasional MCP discovery

For first-run implementations, the focused package is the better default.

## API Reference

The package is built from these stable repo and public surfaces:

| Surface | URL or path | Use |
| --- | --- | --- |
| Agent entrypoint | `https://telnyx.com/agents/start` | First discovery hop for external runtimes |
| Auth contract | `https://telnyx.com/auth.md` | Bearer auth, protected-resource discovery, MCP auth hints |
| Signup guide | `https://telnyx.com/agent-signup.md` | Onboarding path for agents that need real account resources |
| Skill-pack source | `skills/telnyx-external-coding-agents/SKILL.md` | Curated workflow selector for coding agents |
| Voice diagnostics app | `tools/mcp-apps/apps/voice-monitor` | Read-only voice incident diagnosis |
| Governed communications app | `tools/mcp-apps/apps/governed-communications` | Bounded messaging, outbound calling, and verification |

The preferred live endpoints behind this package are:

- `GET https://telnyx.com/.well-known/agent-card.json`
- `GET https://telnyx.com/.well-known/agent-skills/index.json`
- `POST https://api.telnyx.com/v2/ai/assistants`
- `POST https://api.telnyx.com/v2/messages`
- `POST https://api.telnyx.com/v2/mcp`
