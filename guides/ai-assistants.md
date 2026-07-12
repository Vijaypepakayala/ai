# AI Voice Assistants

> Deploy AI-powered voice assistants that answer calls with custom personalities and tools.

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- At least one phone number
- AI credits or pay-as-you-go enabled

## Model Selection

- Resolve the live assistant model catalog first with `GET /v2/ai/models` or `telnyx ai models`. Treat named model IDs in this guide as examples, not a long-lived default contract.
- Use `openai/gpt-5.4` when you want the current Telnyx-hosted OpenAI reasoning model for voice assistants and the live catalog for your account still exposes it.
- Prefer Telnyx-hosted models first for production voice flows. Keeping STT, LLM, TTS, and telephony on the same Telnyx-managed path removes an extra vendor hop and simplifies billing and operations.
- Reach for a custom OpenAI-compatible endpoint only when you have a hard requirement that the hosted model selector does not meet.

## Reusable Setup Workflows

Use these workflow artifacts when the job is a repeatable setup path rather than a one-off API call:

- [`skills/telnyx-ai-voice-agent-bootstrap/SKILL.md`](/skills/telnyx-ai-voice-agent-bootstrap/SKILL.md) for first-run callable assistant setup, answer-webhook wiring, and first live-call verification
- [`skills/telnyx-ai-conversation-memory/SKILL.md`](/skills/telnyx-ai-conversation-memory/SKILL.md) for post-call memory persistence, returning-caller retrieval, and `message_history` reuse
- [`skills/telnyx-ai-tts-provider-switching/SKILL.md`](/skills/telnyx-ai-tts-provider-switching/SKILL.md) for TTS provider choice, assistant voice switching, and post-change validation
- [`skills/telnyx-ai-outbound-voice-python/SKILL.md`](/skills/telnyx-ai-outbound-voice-python/SKILL.md) for outbound assistant calls, number assignment, and telephony settings

## Quick Start

```bash
# Create an assistant
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Bot",
    "instructions": "You are a helpful customer support assistant. Be friendly and concise.",
    "model": "openai/gpt-5.4",
    "voice": {"provider": "telnyx", "settings": {"voice_id": "en-US-Neural2-F"}}
  }'

# Wire to a phone number (via Call Control application settings in portal)
# Or use the assistant ID in your webhook response
```

## API Reference

### Create Assistant

**`POST /v2/ai/assistants`**

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sales Assistant",
    "instructions": "You are a sales representative for Acme Corp. Help customers find the right product. Be enthusiastic but not pushy. Ask qualifying questions about their needs and budget.",
    "voice": {
      "provider": "telnyx",
      "settings": {
        "voice_id": "en-US-Neural2-F",
        "speed": 1.0,
        "pitch": 0
      }
    },
    "model": "openai/gpt-5.4",
    "greeting": "Hello! Thanks for calling Acme Corp. How can I help you today?",
    "hold_music_url": "https://example.com/hold.mp3"
  }'
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Assistant name |
| `instructions` | string | System prompt / personality |
| `voice.provider` | string | `telnyx` or `elevenlabs` |
| `voice.settings.voice_id` | string | Voice identifier |
| `model` | string | LLM model — use `GET /v2/ai/models` or `telnyx ai models` to list available models. Not all inference models work for assistants. |
| `greeting` | string | Initial greeting message |
| `hold_music_url` | string | Music to play on hold |

**Response:**

```json
{
  "id": "assistant-uuid",
  "name": "Sales Assistant",
  "instructions": "...",
  "model": "openai/gpt-5.4",
  "created_at": "2024-01-15T12:00:00Z"
}
```

> **Note:** The AI assistants API returns the object directly — not wrapped in a `"data"` field like other v2 endpoints.

## Hosted Inference Guidance
- `openai/gpt-5.4` is the current example value in this guide, but availability can change by account or over time. Confirm with `GET /v2/ai/models` or `telnyx ai models` before relying on it in automation.
- Telnyx-hosted inference is the default recommendation for real-time voice agents because the LLM stays on the same private Telnyx path as transcription, synthesis, and call media.
- If you need a provider or routing policy outside the hosted catalog, use the custom OpenAI-compatible LLM path deliberately and document the external dependency in your deployment runbook.

## Model Routing And Provider Failover Policy

Use these defaults unless you have a concrete requirement that forces a different shape:

- Pick one primary Telnyx-hosted assistant model for each production voice path and verify it from the live catalog before rollout. Do not treat example model IDs in this guide as a permanent routing contract.
- Keep the first fallback simple and reviewable: a last-known-good Telnyx-hosted model or assistant version that you can promote deliberately after a failed canary, incident, or quality regression.
- Add an external OpenAI-compatible provider only for a hard product gap such as a missing model capability, a required provider policy, or an already-approved external runtime. Do not add one only because it might be useful later.
- Prefer failover between calls, not mid-call. If a live call degrades, the safer first fallback is usually a human transfer, voicemail capture, or SMS follow-up rather than swapping model providers while the conversation is in progress.
- Write the routing policy down in the deployment runbook: primary model, fallback branch, trigger condition, rollback owner, and the correlation IDs you retain when you debug the path.

Use [Telnyx-Native Assistants Vs Third-Party Voice Orchestration](/guides/telnyx-native-vs-third-party-voice-orchestration.md) when you need the deeper decision framework for when to stay on the Telnyx-managed assistant path, when to add an external runtime, and how to keep Telnyx as the telecom system of record if you do.

## Cost Governance Checklist

Treat assistant rollout as a spend-governed release, not just a prompt release. The first production question is not only "does it work?" but also "what budget envelope does this workflow own when calls run long, tools retry, or traffic spikes?"

- Set an explicit pilot envelope before production traffic: a daily budget, a monthly budget, and a maximum tolerated single-call duration for the assistant.
- Model the full path cost, not only the LLM token line item. Include call minutes, transcription, synthesis, assistant inference, webhook or tool retries, and any external model or SaaS calls the assistant can trigger.
- Keep correlation identifiers in every operational log or warehouse sink: `assistant_id`, `phone_number`, `call_control_id`, `call_session_id`, `conversation_id`, and request IDs from any external tools.
- Attribute spend by assistant version, phone number or campaign, environment, and customer or billing group so you can isolate one runaway workflow without muting the entire account.
- Alert before the hard stop. A practical first pass is 50% of the pilot budget, 80% of the monthly budget, and 100% of the approved envelope, plus anomaly alerts for unusually long calls, looping transfers, or repeated tool failures.
- Put account-level controls in Telnyx billing and usage surfaces such as billing groups, usage reports, balance checks, and auto-recharge policy, then mirror those alerts in any external model or workflow provider so telecom spend and model spend fail closed together.
- Keep a human escalation path for billing disputes, outages, cancellations, or any request likely to prolong the call without resolution.

The CLI bootstrap path `telnyx-agent setup-ai` now emits the same cost-governance preflight after setup. Use that output as the operator handoff for first deployment.

This checklist is intentionally narrower than the broader governed-execution and discovery work tracked in [TEL-421](/TEL/issues/TEL-421), [TEL-430](/TEL/issues/TEL-430), and [TEL-482](/TEL/issues/TEL-482). Here the goal is lightweight spend ownership and alerting guidance, not a new approval framework or billing product surface.

## Voice Trust Checklist

Use this checklist for production voice assistants, especially outbound AI or callback flows:

- Use a Telnyx number you control and present a truthful caller identity. Do not imply a bank, carrier, or government caller if the call is actually from your own workflow.
- If your policy or local law requires AI or recording disclosure, put that disclosure in the first turn the callee hears. Do not claim blanket or implied consent in prompts or examples.
- For outbound AI, treat iOS Call Screening and Live Voicemail as a separate branch. Use `answering_machine_detection: "premium_ios_call_screening_detection"` and wait for the screening prompt to finish before identifying the caller or starting the assistant.
- Keep outbound reach narrow with outbound voice profile allowlists such as `whitelisted_destinations`, and review changes to those allowlists like any other fraud-sensitive config change.
- Log webhook outcomes for screening, voicemail, and hangups. On inbound trust-sensitive flows, inspect available caller trust signals such as SHAKEN/STIR attestation before allowing high-risk actions.
- Describe voice-data handling honestly. Avoid claims such as "always listening" unless your product really captures audio continuously and your disclosure, consent, and retention policy all support that behavior.

### List Assistants

**`GET /v2/ai/assistants`**

```bash
curl "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Get Assistant

**`GET /v2/ai/assistants/{id}`**

```bash
curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Update Assistant

**`PATCH /v2/ai/assistants/{id}`**

```bash
curl -X PATCH "https://api.telnyx.com/v2/ai/assistants/{assistant_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "Updated instructions here",
    "greeting": "Hi! How can I help?"
  }'
```

### Delete Assistant

**`DELETE /v2/ai/assistants/{id}`**

```bash
curl -X DELETE "https://api.telnyx.com/v2/ai/assistants/{assistant_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Configuring Tools (Function Calling)

Assistants can call tools/functions to perform actions.

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order Assistant",
    "instructions": "Help customers check their order status. Use the check_order tool when they provide an order number.",
    "tools": [{
      "type": "function",
      "function": {
        "name": "check_order",
        "description": "Check the status of an order",
        "parameters": {
          "type": "object",
          "properties": {
            "order_id": {
              "type": "string",
              "description": "The order ID number"
            }
          },
          "required": ["order_id"]
        }
      }
    }]
  }'
```

When the assistant calls a tool, your webhook receives a `function_call` event.

## Knowledge Bases

Add documents the assistant can reference.

```bash
curl -X POST "https://api.telnyx.com/v2/ai/knowledge_bases" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Product FAQ",
    "documents": [{
      "title": "Product Specs",
      "content": "Our products are made from..."
    }]
  }'

# Attach to assistant
curl -X PATCH "https://api.telnyx.com/v2/ai/assistants/{id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"knowledge_base_ids": ["kb-uuid"]}'
```

## Conversation History

Assistants maintain conversation context automatically. To view history:

**`GET /v2/ai/conversations`**

```bash
curl "https://api.telnyx.com/v2/ai/conversations?assistant_id={id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**`GET /v2/ai/conversations/{conversation_id}`**

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Production Voice AI Operations

Use the first-call bootstrap from [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) to prove the assistant can answer one live call. After that, treat production changes as a four-part loop: version, evaluate, canary, then monitor.

### 1. Version before rollout
Before you change instructions, model, tools, or voice settings, capture the current assistant state and list versions:

```bash
curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/versions" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

Use a specific `version_id` as the unit you promote, test, or roll back. This keeps rollback concrete when latency, tool behavior, or turn-taking degrades after a change.

### 2. Turn expected behavior into assistant tests
Create assistant tests for the narrow scenarios you cannot afford to regress: first response latency, authentication, order lookup accuracy, safe refusal, voicemail handling, and escalation behavior.

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants/tests" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support refund escalation",
    "destination": "+15551234567",
    "instructions": "Act as a frustrated customer asking for a refund on a damaged order. Escalate if the assistant refuses or invents policy.",
    "test_suite": "voice-prod",
    "max_duration_seconds": 120,
    "rubric": [
      { "name": "Identity", "criteria": "Assistant identifies itself and the company truthfully." },
      { "name": "Refund policy", "criteria": "Assistant states the refund policy without inventing steps or guarantees." },
      { "name": "Escalation", "criteria": "Assistant offers human escalation when it cannot complete the request safely." }
    ]
  }'
```

Run that test against the exact version you plan to promote:

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants/tests/{test_id}/runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_version_id": "your-version-id"
  }'
```

Inspect run history until you have a stable pass/fail signal and preserve the returned `conversation_id` and `conversation_insights_id` for later debugging:

```bash
curl "https://api.telnyx.com/v2/ai/assistants/tests/{test_id}/runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/assistants/tests/test-suites/voice-prod/runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

If you run a suite instead of a single test, send `destination_version_id` with the suite run so every scenario measures the same candidate version.

### 3. Canary a new version instead of switching all traffic at once
Telnyx assistants expose canary deploy operations. Use them when the change could affect speech timing, tool choice, or call containment.

```bash
curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/canary-deploys" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl -X POST "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/canary-deploys" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "versions": [
      { "version_id": "stable-version-id" },
      { "version_id": "candidate-version-id" }
    ]
  }'
```

Keep one known-good version available while the candidate warms up on a smaller traffic slice. Use the same eval suite on both stable and candidate versions before increasing the canary, and roll back by restoring the prior version mix or removing the canary deploy if live calls show worse latency, tool misuse, or transfer failures.

### 4. Define the human handoff contract before go-live
Voice AI failures are operational failures, not just prompt failures. Decide in advance when the assistant must stop trying and hand the call to a person or queue. Use these two Telnyx primitives differently:

- `POST /v2/calls/{call_control_id}/actions/transfer` when the AI leg should leave the call and the caller should move to a human destination or queue.
- `POST /v2/calls/{call_control_id}/actions/ai_assistant_join` when you need an additional participant joined to the existing `conversation_id` and want continuity inside the same call flow.

The minimum handoff bundle to preserve in logs, webhook payloads, or CRM notes is `assistant_id`, `version_id`, `conversation_id`, `call_control_id`, `call_session_id`, the last user request, and the exact reason for escalation.

If the assistant is uncertain about identity, payment, compliance, or tool results, escalate instead of continuing optimistically. A clean transfer is better than a confident hallucination on a live phone call.
### 5. Monitor post-call evidence, not just subjective call quality
For every production rollout, inspect the same minimum evidence set after live traffic starts:

- webhook success and failure rates for the assistant answer path
- `call.conversation.ended` fields such as `assistant_id`, `call_control_id`, `call_session_id`, `conversation_id`, `llm_model`, `stt_model`, `tts_provider`, and `tts_voice_id`
- test run status, logs, and trend changes by `test_suite`
- live call event gaps, terminal hangup causes, and provider usage in Voice Monitor

The paved-road debugger is the read-only Voice Monitor MCP app at [`tools/mcp-apps/apps/voice-monitor/README.md`](/tools/mcp-apps/apps/voice-monitor/README.md). Its `voice_monitor_debug_report` is built for the first questions operators ask after a rollout: did webhook delivery fail, did latency spike, which model and voice handled the call, and how did the call terminate?

### Live-account verification path
This is the smallest production-style verification that proves the loop works with a real account: create or update the assistant and record the target `version_id`, create one rubric-backed assistant test, trigger `POST /v2/ai/assistants/tests/{test_id}/runs` with `destination_version_id`, configure or update the canary deploy, place one real phone call through the answer webhook path from [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md), then inspect `call.conversation.ended`, the stored `conversation_id`, and a Voice Monitor debug report for that call.

If any of those steps fail, do not increase traffic. Fix the regression on the candidate version, rerun the test, and only then adjust the canary.

### Reliability and security guardrails
- Re-test after every model, tool, webhook, or voice change. In voice AI, small configuration edits can change turn-taking, latency, and failure modes.
- Keep the assistant answer webhook and any function-calling webhooks idempotent. Duplicate delivery is survivable; non-idempotent side effects are not.
- Store API keys, external LLM credentials, and tool secrets outside the assistant prompt. Use configuration references, not embedded secrets.
- Keep outbound calling destinations and any payment- or account-changing tools narrowly scoped and auditable.
- Put AI disclosure, recording disclosure, and escalation policy in the call flow itself, not only in internal docs.
- Preserve correlation IDs in every handoff or incident note. Telecom incidents are debugged from `call_control_id`, `call_session_id`, and `conversation_id`, not from summaries alone.

## Python Examples

```python
import requests

API_KEY = "KEY..."
BASE_URL = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

assistant = requests.post(
    f"{BASE_URL}/ai/assistants",
    headers=headers,
    json={
        "name": "Support Bot",
        "instructions": "You are a helpful customer support agent.",
        "model": "openai/gpt-5.4",
        "voice": {"provider": "telnyx", "settings": {"voice_id": "en-US-Neural2-F"}},
        "greeting": "Hello! How can I help you today?",
    }
).json()
requests.patch(
    f"{BASE_URL}/ai/assistants/{assistant['id']}",
    headers=headers,
    json={"greeting": "Hi there! What can I do for you?"},
)
print(requests.get(f"{BASE_URL}/ai/assistants", headers=headers).json())
```

## TypeScript Examples

```typescript
const API_KEY = process.env.TELNYX_API_KEY!;
const BASE_URL = "https://api.telnyx.com/v2";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const createRes = await fetch(`${BASE_URL}/ai/assistants`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "Support Bot",
    instructions: "You are a helpful customer support agent.",
    model: "openai/gpt-5.4",
    voice: { provider: "telnyx", settings: { voice_id: "en-US-Neural2-F" } },
    greeting: "Hello! How can I help you today?",
  }),
});
const assistant = await createRes.json();
await fetch(`${BASE_URL}/ai/assistants/${assistant.id}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ greeting: "Hi there! What can I do for you?" }),
});
console.log(await (await fetch(`${BASE_URL}/ai/assistants`, { headers })).json());
```

## Agent Toolkit Examples
Use the `telnyx-agent-toolkit` Python package for simplified tool execution:

```python
from telnyx_agent_toolkit import TelnyxToolkit

toolkit = TelnyxToolkit(api_key="KEY...")
assistant = toolkit.execute("create_ai_assistant", {
    "name": "Support Bot",
    "model": "openai/gpt-5.4",
    "instructions": "You are a helpful customer support agent."
})
print(assistant)
print(toolkit.execute("list_ai_assistants", {"page_size": 10}))
```

## Wiring to a Phone Number

1. Create a Call Control application in the portal
2. Set the webhook URL to: `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`
3. Assign your phone number to this application

Or programmatically:

```bash
# Create connection pointing to assistant
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI Assistant Connection",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'

# Assign phone number to connection
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/{number_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "connection-id"}'
```

## Available Voices
**Telnyx voices:**
- `en-US-Neural2-F` (female, US)
- `en-US-Neural2-M` (male, US)
- `en-GB-Neural2-F` (female, UK)
- `en-GB-Neural2-M` (male, UK)

**ElevenLabs:** Provide your API key in voice settings for access to all ElevenLabs voices.

## Operational Notes

- For the lowest-friction deployment path, start with a Telnyx-hosted model such as `openai/gpt-5.4` and a Telnyx-managed voice.
- Keep custom tool calling and knowledge-base attachments inside the assistant configuration where possible before adding an external orchestration layer.
- Re-test latency and turn-taking after every model change. Moving from one hosted model to another is usually low risk; moving to a custom LLM endpoint changes the network path and failure surface.

## Pricing
- **AI model:** Per-token pricing (pricing varies by model)
- **Voice synthesis:** Per-character pricing
- **Phone call:** Standard voice rates

## Error Handling

| Error | HTTP Status | Resolution |
|-------|-------------|------------|
| `insufficient_credits` | 402 | Add AI credits |
| `model_not_available` | 400 | Check model name |
| `voice_not_found` | 400 | Verify voice_id |

## Resources
- [AI Assistants API Reference](https://developers.telnyx.com/docs/api/v2/ai-assistants)
- [AI Assistants Documentation](https://developers.telnyx.com/docs/ai/assistants)
- [Voice Call Control Guide](/guides/voice-call-control.md)
