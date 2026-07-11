# Telnyx AI Voice Production Playbook

> A first-party production loop for shipping a Telnyx voice assistant with mandatory guardrails, optional accelerators, human handoff, observability, async tools, and one smallest-live verification path.

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

The production loop in this guide is split into:

- mandatory production steps you should complete before widening live traffic
- optional accelerators that make the loop easier to debug, safer to evaluate, or faster to operate at scale

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
- the operator can inspect post-call evidence from conversation insights, Voice Monitor, and any external trace sink you wire in
- one live verification path proves both the automated and escalated branches before traffic increases

## Mandatory Steps Vs Optional Accelerators

Complete the mandatory path before broadening traffic. Add accelerators when you need stronger evaluation, traceability, or multi-system operations.

| Area | Mandatory before wider rollout | Optional accelerator |
| --- | --- | --- |
| Assistant setup | Narrow assistant, explicit escalation rules, first-party answer webhook | Additional prompt variants for A/B evaluation |
| Testing | At least one containment case and one escalation case on the candidate version | Larger rubric suites or staged regression suites |
| Observability | Preserve core Telnyx IDs, capture `call.conversation.ended`, inspect Voice Monitor | Stream traces to Langfuse or another trace sink |
| AI evidence | Fetch conversation and message records for every live verification call | Persist and review conversation insights for trend analysis |
| Tools | Start with safe read-like or append-only functions | Async tools for slow or post-call workflows |
| Rollout | Canary the candidate version and verify contained plus escalated calls | Multi-step traffic ramps with deeper scorecards |

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

### Mandatory hardening

Do these before you treat the workflow as production-ready:

- keep the answer webhook on the Telnyx-managed assistant path
- define explicit escalation triggers for human transfer
- verify webhook signatures on every custom receiver
- restrict tools to safe operations and approved destinations
- retain the call, assistant, and conversation identifiers needed for later triage

### Optional accelerators

Add these when the base loop already works and you need stronger operator leverage:

- Langfuse or another trace sink for cross-system prompt, tool, and latency traces
- AI conversation insights retention for pattern review beyond a single call
- async tools for workflows that should continue after the caller hangs up
- broader regression suites for canary promotion decisions

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
- `call.conversation_insights.generated` when conversation insights are enabled for the workflow
- conversation fetch via `GET /v2/ai/conversations/{conversation_id}`
- conversation messages via `GET /v2/ai/conversations/{conversation_id}/messages`
- Voice Monitor debug output for the call
- assistant test run history for the version you promoted

### Langfuse or external trace sinks

Langfuse is optional, not required for the first release. Add it when you need one operator view that correlates prompt behavior, tool activity, and business-side latency outside the Telnyx surfaces.

If you wire Langfuse or another trace sink:

- keep Telnyx-native IDs such as `conversation_id`, `call_session_id`, and `call_control_id` on every trace
- send prompt, tool, and handoff milestones as structured spans instead of free-form logs
- avoid putting API keys, raw secrets, or unnecessary regulated data into trace payloads
- use the external trace as a supplement, not a replacement, for `call.conversation.ended`, conversation fetches, and Voice Monitor evidence

### AI conversation insights

Conversation insights are the Telnyx-native way to separate "the model chose poorly" from "the retrieved context or caller state was already weak."

Use conversation insights when you need to review:

- whether the assistant stayed inside the intended policy boundary
- whether the caller asked for a human before the transfer happened
- whether containment failures cluster around one prompt, tool, or call segment

Preserve the returned `conversation_insights_id` with the rest of your call evidence whenever it is available.

### Async tools

Not every production action should complete before the voice turn ends. Use async tools when the workflow needs slow or post-call work such as CRM enrichment, follow-up ticket processing, or offline fraud review.

Rules for async tools in the first production loop:

- keep the caller-facing path deterministic; do not make the live call wait on slow backoffice work
- return a clear status to the assistant such as queued, accepted, or unavailable
- make the tool handler idempotent and correlate it to the same call and conversation identifiers
- prefer async follow-up for non-urgent writes and keep urgent or policy-sensitive actions on the human escalation path

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
8. inspect `call.conversation.ended`, `conversation_id`, conversation insights when enabled, and a Voice Monitor debug report for both calls
9. if you use Langfuse or another trace sink, confirm the same call IDs appear there before increasing traffic

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
- conversation insights and any external traces do not show scope drift or tool misuse on the candidate path

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
