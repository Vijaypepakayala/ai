# Telnyx AI Voice Production Playbook

> A first-party production path for shipping a Telnyx voice assistant with support containment, human handoff, observability, and one smallest-live verification loop.

## What This Playbook Covers

Use this guide when the goal is not only "make the assistant answer a call" but "ship one production-shaped workflow without stitching several vendors and playbooks together."

The reference outcome in this guide is **support containment with safe human escalation**:

1. answer inbound support calls on a Telnyx number
2. resolve narrow requests inside the assistant when the workflow is confident and allowed
3. transfer to a human queue when identity, policy, tool results, or caller sentiment make continued automation unsafe
4. preserve the exact call and conversation IDs the support team needs for follow-up and debugging

This guide packages the paved road across existing Telnyx surfaces:

- [AI Voice Assistants](/guides/ai-assistants.md) for assistant creation, tests, versions, and canary rollout
- [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) for the answer webhook, first live call, and Voice Monitor debugging
- [Webhooks](/guides/webhooks.md) for signature verification and delivery handling
- [Voice Call Control](/guides/voice-call-control.md) for call transfer and live call actions

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- One Telnyx phone number assigned to a Call Control application
- A live human destination or queue for escalation
- One webhook endpoint you control for tool events, post-call processing, or CRM updates
- Basic familiarity with [AI Voice Assistants](/guides/ai-assistants.md), [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md), and [webhooks](/guides/webhooks.md)

## Production Outcome

The support-containment workflow is successful when all of these are true:

- the assistant answers a real inbound support call on the first-party answer-webhook path
- the assistant resolves only the narrow requests you explicitly allow
- the assistant transfers cleanly when it cannot proceed safely
- the operator can debug the call later from `assistant_id`, `version_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id`
- one live verification path proves both the automated and escalated branches before traffic increases

## Quick Start

1. Create a narrow support assistant and keep the first-turn path on the Telnyx-managed answer webhook.
2. Define one bounded tool surface for safe lookups or ticket creation; do not start with broad account-mutation tools.
3. Write hard escalation rules before launch so identity, payment, compliance, or sentiment edge cases leave the AI path quickly.
4. Version the assistant, run one rubric-backed assistant test, and canary the candidate version.
5. Place one real call through the number, inspect `call.conversation.ended`, and run a Voice Monitor debug report before increasing traffic.

## Workflow At A Glance

The quickest reference implementation is:

1. create the assistant
2. wire `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer` on a Call Control application
3. assign the target number to that application
4. keep one approved human queue ready for transfer
5. run one contained test call and one escalated test call

```bash
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Containment App",
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

## 1. Secure Deployment And Hardening

Treat the first production rollout as a release of telecom behavior, AI behavior, and tool behavior at the same time.

### Hardening rules

- Keep the first-turn answer path on `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer` so the greeting does not depend on an extra orchestration hop.
- Verify webhook signatures for any custom webhook receiver and keep the handler idempotent.
- Store API keys, CRM tokens, and external model credentials outside prompts and tool descriptions.
- Start with read-like or append-only tools such as order lookup or ticket creation. Delay payment changes, refunds, or broad account writes until the escalation path is already proven.
- Restrict outbound transfer destinations and human queues to approved numbers or SIP targets.
- Put AI disclosure, recording disclosure, and retention policy in the live call flow when policy requires it.
- Preserve correlation IDs in every support log, warehouse record, and handoff note.

## API Reference

### Create The Assistant

Use a narrow first-release assistant instead of a general support agent:

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Containment Agent",
    "model": "openai/gpt-5.4",
    "greeting": "Thanks for calling Acme Support. I can help with order status, basic troubleshooting, or connect you to a specialist.",
    "instructions": "You are a production support voice assistant. Keep replies short. Resolve only the supported workflows you are explicitly given. If identity is uncertain, the caller asks for billing changes, the request becomes emotional or safety-sensitive, a tool response is missing, or the user asks for a human, explain that you are transferring to a specialist and stop trying to contain the call. Never invent policy, credits, or account changes.",
    "voice": {
      "provider": "telnyx",
      "settings": {
        "voice_id": "en-US-Neural2-F"
      }
    },
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "lookup_ticket_status",
          "description": "Read the current status of an existing support ticket.",
          "parameters": {
            "type": "object",
            "properties": {
              "ticket_id": { "type": "string" }
            },
            "required": ["ticket_id"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "create_followup_ticket",
          "description": "Create a follow-up support ticket when the call needs human action.",
          "parameters": {
            "type": "object",
            "properties": {
              "caller_name": { "type": "string" },
              "phone_number": { "type": "string" },
              "summary": { "type": "string" },
              "priority": { "type": "string" }
            },
            "required": ["phone_number", "summary"]
          }
        }
      }
    ]
  }'
```

Use the returned `assistant_id` on the assistant answer webhook path from [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md).

### Wire The Answer Webhook

Keep the first turn on the first-party answer path:

`https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`

## 2. Handoff Contract Before Go-Live

Do not let the prompt decide ad hoc when to stop. Write the transfer boundary as an operational rule.

Transfer to a human when any of these conditions are true:

- the caller explicitly asks for a person
- identity verification is incomplete or ambiguous
- the request involves billing disputes, refunds, cancellations, fraud, or regulated changes
- the model cannot answer from approved knowledge or tool output
- sentiment or urgency means a failed automation attempt would be more expensive than escalation

Use transfer when the AI leg should leave the call and the caller should move to a human queue:

```bash
curl -X POST "https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15557654321"
  }'
```

The minimum handoff bundle is:

- `assistant_id`
- `version_id`
- `connection_id`
- `call_control_id`
- `call_session_id`
- `conversation_id`
- the last customer request in plain language
- the exact reason for escalation

If the workflow creates a follow-up ticket instead of a live transfer, store the same identifiers on that ticket. Do not reduce the handoff to a prose summary alone.

## 3. Observability And Evidence

The production loop is only useful if the operator can answer four questions after a real call:

1. did the assistant answer through the intended webhook path?
2. which version, model, and voice handled the call?
3. did the call stay contained or escalate?
4. if something failed, was it the webhook path, a tool, turn-taking, or the transfer itself?

Capture these evidence sources on every live call:

- `call.conversation.ended` webhook payload
- conversation fetch via `GET /v2/ai/conversations/{conversation_id}`
- conversation messages via `GET /v2/ai/conversations/{conversation_id}/messages`
- Voice Monitor debug output for the call
- assistant test run history for the version you promoted

The paved-road debugger is the read-only Voice Monitor MCP app at [`tools/mcp-apps/apps/voice-monitor/README.md`](/tools/mcp-apps/apps/voice-monitor/README.md).

## 4. Smallest-Live Verification

This is the smallest production-style check that proves the packaged path before you widen traffic:

1. create or update the assistant
2. record the candidate `version_id`
3. create one assistant test for a containment case and one escalation case
4. run the tests against the candidate version
5. configure the answer webhook on a real Telnyx number
6. place one real inbound call that should stay contained
7. place one real inbound call that should escalate to the human queue
8. inspect `call.conversation.ended`, `conversation_id`, and a Voice Monitor debug report for both calls

### Assistant test example

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants/tests" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support containment and escalation",
    "destination": "+15551234567",
    "instructions": "Act as a support caller. First ask for a normal ticket-status lookup. In a second run, ask for a refund and insist on a human if the assistant cannot process it.",
    "test_suite": "voice-prod",
    "max_duration_seconds": 120,
    "rubric": [
      { "name": "Containment", "criteria": "The assistant resolves the supported lookup without inventing policy or changing the scope." },
      { "name": "Escalation", "criteria": "The assistant transfers or opens a follow-up path when the request becomes refund-related or otherwise unsafe." },
      { "name": "Identity", "criteria": "The assistant identifies itself and the company truthfully." }
    ]
  }'
```

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants/tests/{test_id}/runs" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_version_id": "your-version-id"
  }'
```

If either the synthetic test path or the real call path fails, do not increase traffic. Fix the candidate version, rerun the test, and repeat the smallest-live verification.

## 5. Canary Rollout

Once the smallest-live verification passes, move traffic gradually instead of flipping every call to the new version at once.

```bash
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

Increase the canary only after:

- assistant tests stay stable
- the contained live call still resolves cleanly
- the escalation live call still reaches the intended queue
- Voice Monitor evidence shows no webhook failures, transfer regressions, or unexplained latency spikes

## Python Example

```python
import requests

API_KEY = "KEY..."
BASE_URL = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

assistant = requests.post(
    f"{BASE_URL}/ai/assistants",
    headers=headers,
    json={
        "name": "Support Containment Agent",
        "model": "openai/gpt-5.4",
        "instructions": "Resolve narrow support requests and transfer when the request becomes unsafe for automation.",
        "greeting": "Thanks for calling Acme Support. How can I help today?",
    },
    timeout=30,
).json()

print(assistant["id"])
```

## TypeScript Example

```typescript
const response = await fetch("https://api.telnyx.com/v2/ai/assistants", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY!}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Support Containment Agent",
    model: "openai/gpt-5.4",
    instructions:
      "Resolve narrow support requests and transfer when the request becomes unsafe for automation.",
    greeting: "Thanks for calling Acme Support. How can I help today?",
  }),
});

const assistant = await response.json();
console.log(assistant.id);
```

## 6. Support Containment Runbook

Use this condensed operational path for the first real deployment:

1. Start with [AI Voice Assistants](/guides/ai-assistants.md) and create a narrow assistant.
2. Use [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) to wire the answer webhook and place the first real call.
3. Keep tool scope narrow and idempotent.
4. Predefine the transfer queue and the escalation triggers.
5. Run assistant tests and canary the candidate version.
6. Prove one contained call and one escalated call with live evidence.
7. Promote traffic only after the operator can inspect the call from Telnyx-native IDs alone.

## Related Guides

- [AI Voice Assistants](/guides/ai-assistants.md)
- [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md)
- [AI Receptionist Missed-Call Capture](/guides/ai-receptionist-missed-call.md)
- [Telnyx-Native Assistants Vs Third-Party Voice Orchestration](/guides/telnyx-native-vs-third-party-voice-orchestration.md)
- [Webhooks](/guides/webhooks.md)
