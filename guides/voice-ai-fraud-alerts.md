# Voice AI Fraud Alerts For Regulated Customers

> A bounded reference flow for urgent voice-AI fraud alerts: disclose the AI call, confirm or deny the transaction, escalate to a human when trust drops, and send an SMS review link with an auditable trail.

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- One Telnyx phone number assigned to a Call Control application
- A staffed human escalation destination or fraud queue
- One webhook endpoint you control for tool events and post-call audit writes
- Basic familiarity with [AI Voice Assistants](/guides/ai-assistants.md), [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md), [Voice Call Control](/guides/voice-call-control.md), and [webhooks](/guides/webhooks.md)

## Workflow At A Glance

Use this pattern when the business goal is narrow and high trust:

1. Place or answer a fraud-alert call on the first-party Telnyx voice path.
2. Disclose that the caller is an automated assistant for the regulated institution.
3. Ask the customer to confirm, deny, or request a callback for one specific event.
4. Escalate to a human immediately when identity, caller trust, or sentiment makes continued automation unsafe.
5. Send an SMS review link so the customer has a durable written record after the call.
6. Persist the decision, disclosure timestamp, and correlation IDs for audit and follow-up.

This guide is intentionally narrow:

- it does not claim legal certification or jurisdiction-wide compliance
- it does not replace your institution's identity-verification policy
- it does show where to attach disclosure, retention, and operator-review controls

## Quick Start

The smallest reference flow is:

1. Create one fraud-alert assistant with explicit disclosure and three bounded tools.
2. Point a Call Control application at `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`.
3. Route the fraud hotline or outbound alert number through that application.
4. On tool events, record the decision, transfer urgent callers, and send one SMS review message.
5. Inspect the stored conversation and your audit record after each test call.

```bash
# 1) Create the assistant
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fraud Alert Voice Agent",
    "model": "openai/gpt-5.4",
    "greeting": "Hello, this is the automated fraud assistant for Example Bank. This AI call is about a potentially suspicious card transaction and may be recorded for review.",
    "instructions": "You are a bounded fraud-alert assistant for a regulated financial institution. Keep replies short. In the first turn, disclose that the caller is an automated assistant acting for Example Bank. Then ask the customer to confirm one recent transaction, deny it, or request a callback from a human fraud specialist. Never ask for a full card number, PIN, password, one-time passcode, or full social security number. If the caller sounds confused, distressed, angry, asks for a human, or identity cannot be established with the approved institution policy, stop automation and escalate immediately. Before ending any non-transferred call, summarize the recorded outcome and state that a follow-up SMS will be sent for review.",
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
          "name": "record_fraud_decision",
          "description": "Store the customer's decision for the suspicious event and the disclosure/audit fields required for review.",
          "parameters": {
            "type": "object",
            "properties": {
              "event_id": { "type": "string" },
              "decision": { "type": "string", "enum": ["confirmed_valid", "reported_fraud", "requested_callback"] },
              "disclosure_given": { "type": "boolean" },
              "caller_last4_verified": { "type": "boolean" },
              "summary": { "type": "string" }
            },
            "required": ["event_id", "decision", "disclosure_given", "summary"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "create_human_escalation",
          "description": "Open a live or follow-up fraud escalation when automation should stop.",
          "parameters": {
            "type": "object",
            "properties": {
              "event_id": { "type": "string" },
              "reason": { "type": "string" },
              "priority": { "type": "string" }
            },
            "required": ["event_id", "reason"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "send_review_sms",
          "description": "Send one durable follow-up SMS containing the institution name, event summary, and review instructions.",
          "parameters": {
            "type": "object",
            "properties": {
              "to": { "type": "string" },
              "event_id": { "type": "string" },
              "message": { "type": "string" }
            },
            "required": ["to", "event_id", "message"]
          }
        }
      }
    ]
  }'
```

Save the returned `assistant_id`.

```bash
# 2) Create the Call Control application wired to the assistant answer webhook
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fraud Alert Voice App",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'
```

Save the returned `connection_id`.

```bash
# 3) Assign the number to that Call Control application
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/{number_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "your-connection-id"
  }'
```

```bash
# 4) Send the durable SMS review message after your tool webhook stores the decision
curl -X POST "https://api.telnyx.com/v2/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559876543",
    "text": "Example Bank fraud review: we recorded your response for alert EVT-1024. If you reported fraud, a specialist is reviewing it now. If you did not complete this review, call the number on the back of your card."
  }'
```

Run three test calls before wider rollout:

1. one caller confirms the transaction as valid
2. one caller reports fraud and transfers to a human queue
3. one caller requests a callback and receives the SMS follow-up

## API Reference

### Create The Assistant

The first release should stay narrow. Ask about one event, one decision, and one escalation boundary.

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fraud Alert Voice Agent",
    "model": "openai/gpt-5.4",
    "greeting": "Hello, this is the automated fraud assistant for Example Bank. This AI call is about a potentially suspicious card transaction.",
    "instructions": "Disclose the AI assistant, collect only the allowed confirm or deny outcome, and escalate when trust drops.",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "record_fraud_decision",
          "description": "Persist a fraud-alert decision for review."
        }
      }
    ]
  }'
```

### Wire The Assistant Answer Webhook

Keep the first-turn disclosure on the Telnyx-managed answer path:

`https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`

```bash
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fraud Alert Voice App",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'
```

### Escalate To A Human Specialist

Use transfer when the caller denies the transaction, requests a person, or the assistant should stop because identity confidence is too low.

```bash
curl -X POST "https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15557654321"
  }'
```

Transfer immediately when:

- the caller says the transaction is fraudulent
- the assistant cannot complete the approved verification step safely
- the caller asks for a human or legal department
- the assistant hears distress, coercion, or repeated confusion

### Send The Durable SMS Review

The SMS follow-up should record receipt, not final case resolution.

```bash
curl -X POST "https://api.telnyx.com/v2/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559876543",
    "text": "Example Bank fraud review: your response for alert EVT-1024 was recorded. If you did not complete this review, contact Example Bank using a trusted number."
  }'
```

Keep the SMS content minimal:

- institution name
- event or case reference
- the fact that the response was recorded
- a trusted human follow-up path

### Inspect The Conversation And Audit Trail

After each call, inspect the stored conversation and messages:

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

Capture at least these fields from your webhook events and audit write:

- `assistant_id`
- `connection_id`
- `call_control_id`
- `call_session_id`
- `conversation_id`
- `event_id`
- `decision`
- `disclosure_given`
- `policy_version`

## Disclosure And Audit Hooks

Use these hooks to satisfy common disclosure and operator-review expectations without overclaiming legal compliance:

- identify the institution truthfully in the first turn
- say that the call is automated or AI-assisted before collecting the decision
- store whether disclosure was delivered successfully
- preserve the exact escalation reason, not just the final disposition
- write the policy or prompt version used for the call so reviewers can reconstruct the operating rule
- keep one durable written follow-up path such as SMS or secure portal review

The minimum practical audit record is one append-only event per call outcome:

```json
{
  "event_id": "EVT-1024",
  "policy_version": "fraud-alert-v1",
  "assistant_id": "assistant-uuid",
  "call_control_id": "v3:call-control-id",
  "call_session_id": "session-uuid",
  "conversation_id": "conv-uuid",
  "decision": "reported_fraud",
  "disclosure_given": true,
  "transferred_to_human": true,
  "sms_followup_sent": true,
  "created_at": "2026-06-26T17:30:00Z"
}
```

## Security And Data Boundaries

Treat this as a trust-sensitive voice workflow, not a broad support bot:

- never ask for full card numbers, PINs, passwords, passcodes, or full national identifiers
- keep secret material such as API keys and case-management tokens outside prompts and tool descriptions
- retain only the transcript and message content your policy actually needs
- log operator-facing identifiers and outcomes separately from the raw transcript when possible
- restrict transfer targets and callback numbers to approved destinations
- review outbound caller identity, STIR or SHAKEN data, and SMS copy like any other fraud-sensitive customer contact

## Minimal Tool Handler Example

Use your webhook receiver to keep the call path small and the side effects explicit.

```python
from typing import Any


def handle_function_call(payload: dict[str, Any]) -> dict[str, Any]:
    function_call = payload["data"]["function_call"]
    name = function_call["name"]
    arguments = function_call["arguments"]

    if name == "record_fraud_decision":
        write_audit_event(arguments)
        return {"status": "ok", "recorded": True}

    if name == "create_human_escalation":
        create_case(arguments)
        return {"status": "ok", "escalation_created": True}

    if name == "send_review_sms":
        send_sms(arguments["to"], arguments["message"])
        return {"status": "ok", "sms_sent": True}

    raise ValueError(f"unexpected function call: {name}")
```

```typescript
type FraudToolArgs = Record<string, unknown>;

export async function handleFunctionCall(payload: any) {
  const functionCall = payload.data.function_call;
  const name = functionCall.name as string;
  const args = functionCall.arguments as FraudToolArgs;

  if (name === "record_fraud_decision") {
    await writeAuditEvent(args);
    return { status: "ok", recorded: true };
  }

  if (name === "create_human_escalation") {
    await createCase(args);
    return { status: "ok", escalationCreated: true };
  }

  if (name === "send_review_sms") {
    await sendSms(String(args.to), String(args.message));
    return { status: "ok", smsSent: true };
  }

  throw new Error(`unexpected function call: ${name}`);
}
```

## Known Gaps

This reference flow is a starter, not a certification packet:

- it does not define your institution's legal disclosure text
- it does not implement full customer identity verification
- it does not include card-core or case-management integrations
- it assumes a human fraud queue already exists for transfers and callbacks

Use the guide to prove the bounded voice path, escalation path, SMS fallback, and audit hooks before you widen scope.
