# Production Voice-Agent Onboarding

> One paved-road path for a first Telnyx voice-agent evaluation: create the assistant, wire the answer webhook, capture the right IDs, and debug the first live call.

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- One Telnyx phone number you can assign to a Call Control application
- A real phone you can call from for the first bootstrap test
- Basic familiarity with [AI assistants](/guides/ai-assistants.md), [voice call control](/guides/voice-call-control.md), and [webhooks](/guides/webhooks.md)

If you are still deciding whether this native onboarding path is the right fit, read [Telnyx-Native Assistants Vs Third-Party Voice Orchestration](/guides/telnyx-native-vs-third-party-voice-orchestration.md) first.

## Quick Start

The production-friendly bootstrap path is:

1. Create an AI assistant.
2. Create a Call Control application whose webhook points at `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`.
3. Assign your phone number to that Call Control application.
4. Make one real call to the number and capture the IDs from the resulting webhook and debug surfaces.

```bash
# 1) Create the assistant
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Evaluation Voice Agent",
    "instructions": "You are a concise support voice agent. Confirm the caller goal, answer directly, and keep responses short.",
    "model": "openai/gpt-5.4",
    "voice": {
      "provider": "telnyx",
      "settings": {
        "voice_id": "en-US-Neural2-F"
      }
    },
    "greeting": "Thanks for calling Telnyx. How can I help today?"
  }'
```

Save the returned `assistant_id`.

```bash
# 2) Create the Call Control application wired to the assistant answer webhook
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Evaluation Voice Agent App",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'
```

Save the returned Call Control application ID as `connection_id`.

```bash
# 3) Assign a number to the Call Control application
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/{number_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "your-connection-id"
  }'
```

Now place a real call to that number from a mobile phone. After the call ends, inspect the webhook and debug surfaces below.

## What To Capture On The First Call

Capture these IDs during the first live bootstrap call. They are the minimum set that lets you debug and continue the conversation later.

| ID | Where to get it first | Why it matters |
| --- | --- | --- |
| `assistant_id` | Assistant creation response or `call.conversation.ended` | Confirms which assistant revision handled the call |
| `connection_id` | Call Control application creation response or webhook payload | Ties the call to the answer webhook configuration |
| `call_control_id` | Voice events and Voice Monitor | Required for Call Control follow-up actions and call status lookup |
| `call_session_id` | Voice webhooks and Voice Monitor | Correlates all call legs for the same session |
| `conversation_id` | `call.conversation.ended` webhook | Primary handle for post-call AI conversation inspection |

For the bootstrap path, the most important post-call webhook is `call.conversation.ended`. It includes `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, `conversation_id`, `llm_model`, `stt_model`, `tts_provider`, and `tts_voice_id`.

## API Reference

### Create The Assistant

Use the assistants guide for the full field surface: [AI assistants](/guides/ai-assistants.md).

```bash
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Evaluation Voice Agent",
    "instructions": "Answer inbound voice calls clearly and briefly.",
    "model": "openai/gpt-5.4",
    "voice": {
      "provider": "telnyx",
      "settings": {
        "voice_id": "en-US-Neural2-F"
      }
    }
  }'
```

### Wire The Assistant Answer Webhook

The paved-road answer webhook is:

`https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`

Point your Call Control application at that URL so inbound calls on the assigned number are answered by the assistant instead of a custom webhook handler.

```bash
curl -X POST "https://api.telnyx.com/v2/connections" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Evaluation Voice Agent App",
    "active": true,
    "webhook_api_url": "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer"
  }'
```

For general delivery debugging and signature verification patterns, see [webhooks](/guides/webhooks.md).

### Inspect The Conversation After The Call

Once the first call completes, use `conversation_id` from `call.conversation.ended` to inspect the stored conversation:

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

This is the fastest way to verify that the assistant path worked end-to-end before you change prompts, tools, or routing.

## `conversation_id` Lifecycle

- A new live voice conversation produces a `conversation_id`.
- The bootstrap answer-webhook path surfaces that ID on `call.conversation.ended`.
- Use `conversation_id` for post-call inspection, analytics, and to line up Voice Monitor or webhook evidence with the assistant run that just happened.
- Treat it as the durable handle for the AI side of the call, while `call_control_id` and `call_session_id` remain the telephony-side correlation IDs.

If your first goal is only "did the assistant answer and complete a call correctly?", `conversation_id` is the most important AI identifier to save immediately after the first test call.

## Production Memory Contract

The first live call proves that Telnyx is producing the right IDs. The next production step is to persist a small voice-memory record outside the call so a returning caller and a human escalation path can both reuse the same context.

Persist one record per completed call with:

- a stable customer key such as CRM account ID, verified phone number, or ticket ID
- `assistant_id`
- `conversation_id`
- `call_control_id`
- `call_session_id`
- the last user goal in plain language
- a short assistant-generated summary you are willing to show a human operator
- disposition metadata such as `resolved`, `follow_up_required`, or `escalated`
- retention metadata such as `created_at`, `expires_at`, and the policy or queue that governs deletion

The minimum production rule is: do not rely on `conversation_id` alone as the customer identity. Treat it as the AI-side run handle for one conversation, then map it to your customer key in your own system of record.

### Suggested Voice Memory Record

```json
{
  "customer_key": "acct_12345",
  "assistant_id": "assistant-uuid",
  "conversation_id": "conv-uuid",
  "call_control_id": "v3:call-control-id",
  "call_session_id": "session-uuid",
  "caller_e164": "+15551234567",
  "summary": "Caller reported a failed SIM activation after port-in and needs a same-day callback.",
  "last_user_goal": "Finish activation on the original business line.",
  "disposition": "follow_up_required",
  "created_at": "2026-06-19T12:34:56Z",
  "expires_at": "2026-07-19T12:34:56Z"
}
```

## Persisting Memory After Each Call

The cleanest source of truth for the persistence step is the post-call webhook plus a follow-up conversation fetch.

1. Read `call.conversation.ended` and capture the IDs above.
2. Fetch the conversation and messages with `conversation_id`.
3. Store the small memory record in your CRM, ticketing system, or app database.
4. Keep the full transcript only when your retention and consent policy explicitly allows it.

```bash
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

For voice-specific debugging later, also capture the `call.conversation_insights.generated` event when your workflow uses conversation insights. That event helps separate "the model chose poorly" from "the retrieved memory was already incomplete."

## Retrieving Prior Context For A Returning Caller

On the next inbound call, retrieve context in this order:

1. resolve the caller to your customer key
2. load the most recent still-valid memory record for that key
3. fetch Telnyx conversation messages only when you need more detail than the stored summary
4. pass a trimmed context window into `message_history` before starting the assistant

Keep the rehydrated context short and deliberate. The safest production pattern is to pass a compact summary plus the last one or two turns that matter, not an unbounded transcript dump.

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

Use `message_history` for the concise state you actively want the assistant to use in the next turn. Use the conversation APIs for audit, debugging, and optional deeper retrieval when the short state bundle is not enough.

## Reusing `message_history`

The assistant answer webhook is the paved road for the first evaluation call. When you later need to continue context in a custom call-control flow, reuse prior turns as `message_history` with voice AI actions such as `ai_assistant_start` or `gather_using_ai`.

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
        "role": "user",
        "content": "The caller already authenticated in the previous call."
      },
      {
        "role": "assistant",
        "content": "I confirmed the account and asked which order needed help."
      }
    ],
    "send_message_history_updates": true
  }'
```

Use this pattern when you intentionally move from the no-code answer-webhook bootstrap into a more controlled Call Control workflow. For the detailed field surface, see [`skills/telnyx-voice-gather-curl/SKILL.md`](/skills/telnyx-voice-gather-curl/SKILL.md).

## Escalation And Human Handoff Bundle

When the assistant cannot safely finish the request, persist and hand off one operator-ready bundle before you transfer or queue the call.

The minimum handoff bundle is:

- `customer_key`
- `assistant_id`
- `conversation_id`
- `call_control_id`
- `call_session_id`
- current caller phone number
- short summary of what already happened
- explicit reason for escalation
- last successful verification state, if any

If the caller is still on the line, use call transfer for the telephony move and attach the same bundle to the operator workspace, CRM ticket, or queue metadata your humans already monitor.

```bash
curl -X POST "https://api.telnyx.com/v2/calls/{call_control_id}/actions/transfer" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+18005550199"
  }'
```

The production rule is simple: the human should receive the same identifiers you would use to debug the call later. Do not collapse the handoff into a prose-only summary if that means `conversation_id` or `call_session_id` gets lost.

## Debugging After The First Bootstrap Call

After one successful or failed live call, move to the read-only Voice Monitor path:

- Voice Monitor app: [`tools/mcp-apps/apps/voice-monitor/README.md`](/tools/mcp-apps/apps/voice-monitor/README.md)
- Core voice controls and event patterns: [voice call control](/guides/voice-call-control.md)

Start with at least one of these IDs:

- `call_control_id`
- `call_session_id`
- `connection_id`
- `assistant_id`
- `conversation_id`

Voice Monitor is the paved-road debugger for:

- event timelines
- webhook delivery failures for the Call Control application
- provider and model confirmation
- terminal hangup or failure causes
- post-call recording discovery

## Wrong Action Or Wrong Memory Triage

When the assistant chose the wrong action or seemed to remember the wrong thing, inspect the failure in this order:

1. Was the right customer record selected before the call started?
2. Did the stored summary already contain stale or incorrect information?
3. Did `message_history` over-specify the task and bias the assistant into a bad action?
4. Did the live conversation messages show the caller correcting the assistant, but your persistence step missed that correction?
5. Did the call-control timeline or webhook delivery fail before the retrieval or escalation branch completed?

Use these surfaces together:

- Voice Monitor for call timeline, webhook failures, provider confirmation, and terminal events
- `GET /v2/ai/conversations/{conversation_id}` for conversation metadata
- `GET /v2/ai/conversations/{conversation_id}/messages` for the exact turns the assistant saw
- your own stored memory record for the summary and customer-key mapping that were fed back into the next call

If the memory record is wrong but the conversation messages are right, fix your persistence or summarization path. If the memory record is right but the assistant still acted incorrectly, tighten the instructions, shorten the retrieved context, or add an explicit confirmation turn before risky actions.

## Privacy And Retention Notes

Voice memory is useful only if it is deliberately scoped.

- Persist the minimum context needed for continuity and escalation, not every possible transcript field.
- Set a retention window for conversation summaries, transcripts, and recordings before production rollout.
- Keep customer identity keys separate from raw transcripts when your internal policy allows that split.
- Redact or avoid storing payment data, secrets, or high-risk identifiers in `message_history` unless the workflow is explicitly designed and approved for that data class.
- Make sure your caller disclosure, recording disclosure, and retention policy match what you actually store after the call.

If policy requires short-lived memory only, store the operator handoff bundle and delete the detailed conversation payload on the schedule your compliance owner approved.

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
        "name": "Evaluation Voice Agent",
        "instructions": "Answer inbound support calls clearly and briefly.",
        "model": "openai/gpt-5.4",
        "voice": {"provider": "telnyx", "settings": {"voice_id": "en-US-Neural2-F"}},
    },
).json()

assistant_id = assistant["id"]

connection = requests.post(
    f"{BASE_URL}/connections",
    headers=headers,
    json={
        "name": "Evaluation Voice Agent App",
        "active": True,
        "webhook_api_url": f"https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer",
    },
).json()

print({"assistant_id": assistant_id, "connection_id": connection["data"]["id"]})
```

## TypeScript Example

```typescript
const API_KEY = process.env.TELNYX_API_KEY!;
const BASE_URL = "https://api.telnyx.com/v2";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const assistantRes = await fetch(`${BASE_URL}/ai/assistants`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "Evaluation Voice Agent",
    instructions: "Answer inbound support calls clearly and briefly.",
    model: "openai/gpt-5.4",
    voice: { provider: "telnyx", settings: { voice_id: "en-US-Neural2-F" } },
  }),
});

const assistant = await assistantRes.json();

const connectionRes = await fetch(`${BASE_URL}/connections`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "Evaluation Voice Agent App",
    active: true,
    webhook_api_url: `https://api.telnyx.com/v2/ai/assistants/${assistant.id}/answer`,
  }),
});

const connection = await connectionRes.json();
console.log({ assistantId: assistant.id, connectionId: connection.data.id });
```
