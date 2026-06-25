---
name: telnyx-ai-voice-agent-bootstrap
description: >-
  Repeatable first-run setup for a callable Telnyx AI voice assistant. Covers
  hosted-assistant versus programmable-call-control choices, assistant
  creation, answer-webhook wiring, first live-call verification, and the IDs
  to preserve for debugging and rollout.
user_invocable: true
metadata:
  author: telnyx
  product: ai-assistants
  compatibility: "Use with Telnyx REST, telnyx-agent setup-ai, or a language-specific telnyx-ai-assistants skill when you need exact SDK syntax."
---

# Telnyx AI Voice Agent Bootstrap

Use this skill when the task is "get a real voice assistant answering a real Telnyx phone number" and the repo's raw API reference is too low-level. This is the workflow layer above `telnyx-ai-assistants-*`.

## Success Condition

The workflow is complete when all of these are true:

1. an assistant exists
2. a Telnyx number is wired to the assistant answer path
3. one live test call succeeds
4. you preserve `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id`

## When To Choose This Path

Choose **managed AI Assistants** when:

- Telnyx should own the voice runtime, STT, TTS, telephony, and assistant lifecycle
- you want the paved-road answer webhook
- you want assistant tests, versions, workflows, and canary deploys on the same surface

Choose a **programmable Call Control path** when:

- your app must decide call behavior turn by turn
- you need to inject `message_history` or custom logic at call time
- you plan to start, stop, join, or transfer AI inside a broader call-control workflow

Choose **Conversation Relay or raw media** instead when:

- your application already owns the LLM runtime
- you need text-over-WebSocket orchestration or direct audio-frame control

If you are still deciding between Telnyx-native and third-party orchestration, read [guides/telnyx-native-vs-third-party-voice-orchestration.md](/guides/telnyx-native-vs-third-party-voice-orchestration.md) first.

## Prerequisites

- `TELNYX_API_KEY`
- one Telnyx phone number you can assign
- AI credits or pay-as-you-go enabled
- one real phone for the first live call

## Paved-Road Workflow

### Option A: Fast bootstrap with the CLI

Use this when the goal is a working starter without hand-authoring every API call:

```bash
telnyx-agent setup-ai --json
telnyx-agent setup-ai --preset appointment-reminders --json
telnyx-agent setup-ai --preset support-handoff --json
```

This path creates the assistant, buys a number, and wires the assistant to a TeXML app for a quick bootstrap.

### Option B: Explicit first-party answer-webhook path

Use this when you want the clearest production-shaped inbound setup:

1. Create the assistant from [guides/ai-assistants.md](/guides/ai-assistants.md).
2. Create a Call Control application with `webhook_api_url` set to `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`.
3. Assign the target phone number to that application.
4. Place one real call and inspect the resulting conversation and webhook evidence.

```bash
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bootstrap Voice Agent App",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'
```

```bash
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/{number_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "your-connection-id"
  }'
```

## First Live-Call Verification

After the first test call, capture:

- `assistant_id`
- `connection_id`
- `call_control_id`
- `call_session_id`
- `conversation_id`

Then verify:

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

Use [guides/voice-agent-onboarding.md](/guides/voice-agent-onboarding.md) as the canonical debugging path once the number is live.

## Decision Rules During Setup

- Prefer the answer-webhook path for the first inbound evaluation call.
- Prefer `telnyx-agent setup-ai` when the operator needs a fast account bootstrap rather than a custom production topology.
- Do not hard-code the model ID from old examples. Resolve the current assistant model catalog first.
- Keep the first tool surface narrow. Start with read-like lookups or append-only ticket creation before broader mutations.

## What To Load Next

- `telnyx-ai-assistants-python` or another language variant when you need exact SDK syntax
- [guides/voice-agent-onboarding.md](/guides/voice-agent-onboarding.md) for the first live call and evidence capture
- [guides/voice-ai-production-playbook.md](/guides/voice-ai-production-playbook.md) for escalation, tests, versioning, and canary rollout
- `telnyx-ai-conversation-memory` when the next task is returning-caller context or retrieval
- `telnyx-ai-tts-provider-switching` when the next task is voice-provider choice or migration
