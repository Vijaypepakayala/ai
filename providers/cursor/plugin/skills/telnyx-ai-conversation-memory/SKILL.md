---
name: telnyx-ai-conversation-memory
description: >-
  Repeatable setup for Telnyx AI conversation history, voice-memory
  persistence, and retrieval into future calls. Covers when to use
  `conversation_id`, `message_history`, and knowledge bases, plus the minimum
  record to store outside Telnyx for returning-caller context.
user_invocable: true
metadata:
  author: telnyx
  product: ai-assistants
  compatibility: "Pairs with guides/voice-agent-onboarding.md and telnyx-ai-assistants-* when implementing persistent caller context."
---

# Telnyx AI Conversation Memory

Use this skill when the task is not only "answer a call" but "remember enough of the last call to help the next one." This packages the repo's recommended memory contract for Telnyx voice assistants.

## Success Condition

The workflow is complete when:

1. completed calls produce a stored memory record outside the live call
2. that record keeps the correlation IDs needed for debugging
3. a future inbound or outbound call can rehydrate concise context through `message_history`

## Choose The Right Memory Surface

Use **`conversation_id`** when:

- you need the durable handle for one assistant conversation
- you want to fetch the stored conversation or messages after a call

Use **`message_history`** when:

- you want to inject short, deliberate context into the next live AI turn
- you already know the exact state you want the assistant to reuse

Use a **knowledge base** when:

- the content is stable reference material shared across many callers
- the assistant should consult documents, FAQs, or policy content rather than one caller's prior state

Use your **own CRM or application database** when:

- you need caller identity, retention policy, or business state that outlives one Telnyx conversation
- you need to join calls to tickets, accounts, orders, or escalation workflows

## Production Rule

Do not treat `conversation_id` as customer identity. Treat it as the AI-side run handle for one conversation, then map it to your own customer key.

## Minimum Memory Record

Persist one record per completed call with:

- `customer_key`
- `assistant_id`
- `conversation_id`
- `call_control_id`
- `call_session_id`
- `caller_e164`
- a short human-readable summary
- the last user goal
- `disposition`
- `created_at`
- `expires_at`

Example:

```json
{
  "customer_key": "acct_12345",
  "assistant_id": "assistant-uuid",
  "conversation_id": "conv-uuid",
  "call_control_id": "v3:call-control-id",
  "call_session_id": "session-uuid",
  "caller_e164": "+15551234567",
  "summary": "Caller reported a failed SIM activation and needs a callback.",
  "last_user_goal": "Finish activation on the original business line.",
  "disposition": "follow_up_required",
  "created_at": "2026-06-19T12:34:56Z",
  "expires_at": "2026-07-19T12:34:56Z"
}
```

## Capture Workflow After Each Call

1. Read the `call.conversation.ended` webhook.
2. Save `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id`.
3. Fetch the conversation and messages if you need a summary or audit trail.
4. Write the compact memory record into your own system of record.

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Rehydrate Workflow For A Returning Caller

On the next call:

1. resolve the caller to your `customer_key`
2. load the most recent still-valid memory record
3. fetch deeper conversation messages only if the short record is not enough
4. pass a compact state bundle into `message_history`

```bash
curl -X POST "https://api.telnyx.com/v2/calls/{call_control_id}/actions/ai_assistant_start" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "assistant": {
      "id": "your-assistant-id"
    },
    "message_history": [
      {
        "role": "system",
        "content": "Returning caller context: account acct_12345 had a failed SIM activation earlier today. Confirm whether the activation completed before taking new action."
      },
      {
        "role": "user",
        "content": "The caller already verified the account and wants to continue the previous activation case."
      }
    ],
    "send_message_history_updates": true
  }'
```

## Guardrails

- Keep `message_history` short and intentional. Do not dump an unbounded transcript back into the live call.
- Keep high-risk data out of `message_history` unless your workflow explicitly supports it.
- Use knowledge bases for shared product facts, not caller-specific temporary state.
- Preserve the telecom IDs alongside the AI IDs so operators can debug failures later.

## What To Load Next

- [guides/voice-agent-onboarding.md](/guides/voice-agent-onboarding.md) for the full post-call memory and handoff pattern
- `telnyx-ai-assistants-*` when you need SDK-specific calls
- `telnyx-ai-voice-agent-bootstrap` when the number is not yet wired to a live assistant
