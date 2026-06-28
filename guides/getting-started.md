# Getting Started With Telnyx For Agents

> A compact onboarding path for agents and AI-first developers who need one safe, explicit first workflow before they touch live telecom writes.

## Success condition

You should finish this guide with:

- one Telnyx account and API key
- a local bearer-auth setup that works against `https://api.telnyx.com/v2`
- a recorded read-only first workflow result
- the operational IDs needed for later review

## Safety and execution rules

Use this guide as the default first-run path when you need real Telnyx account access but do not yet have approval to buy numbers, place calls, or send messages.

- Start with read-only discovery and inspection before any live-write workflow.
- Treat account signup, payment-method changes, number purchases, message sends, call placement, and assistant deployment as approval-sensitive actions.
- Inspect `https://telnyx.com/ai/rate-limits.json` before mutating automation so your client knows the canonical rate-limit header names and the `429` retry contract.
- Preserve `request_id` on every API call you may need to review later.
- Preserve `resource_id`, `conversation_id`, and `webhook_delivery_id` once you move into assistants, messaging, or voice workflows.
- Assume memory is host-managed or stateless at the discovery layer. Do not promise persistent assistant memory unless you explicitly configure it in the assistant workflow.
- Prefer sandbox-first or read-only probes until a human or policy explicitly approves telecom actions with external effects.

If you only need a no-signup product check first, use `POST https://telnyx.com/api/inference` from `https://telnyx.com/agents/start`, then return here when you need authenticated account resources.

## Prerequisites

- shell access with `curl`
- `jq` for response inspection
- mailbox access if you want a production API key today

## Quick Start

If you need the shortest authenticated path, do this in order:

1. Read `https://telnyx.com/agent-signup.md`.
2. Create the account and API key.
3. Export `TELNYX_API_KEY`.
4. Run the read-only number search example in this guide.
5. Save the returned `x-request-id` before you move to any write workflow.

## Step 1: Create the account and API key

Read `https://telnyx.com/agent-signup.md` first. That guide is the current source of truth for the bot-signup contract and the email-link limitation.

The authenticated flow is:

1. `POST /v2/bot_challenge`
2. `POST /v2/bot_signup`
3. open the single-use email link
4. `POST /v2/api_keys`

Keep the returned API key in a secure secret store. Do not commit it.

## Step 2: Configure bearer auth locally

Export the key into your shell:

```bash
export TELNYX_API_KEY="KEY_..."
```

Use bearer auth for REST and MCP:

- REST: `Authorization: Bearer $TELNYX_API_KEY`
- MCP: connect to `https://api.telnyx.com/v2/mcp` with the same bearer token

Quick auth probe:

```bash
curl -sS https://api.telnyx.com/v2/available_phone_numbers \
  -D /tmp/telnyx-auth-probe.headers \
  -o /tmp/telnyx-auth-probe.json \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -G \
  --data-urlencode "filter[country_code]=US" \
  --data-urlencode "filter[limit]=1"

jq /tmp/telnyx-auth-probe.json
rg -i '^x-request-id:' /tmp/telnyx-auth-probe.headers
```

Success condition: you get a normal JSON response instead of an auth error.

Also save any returned rate-limit headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After`
- `X-Request-Id`

## Step 3: Confirm billing and approval posture

Before any live telecom write, confirm these preconditions:

- a payment method or funded balance exists for the account you intend to use
- the operator has explicitly approved live telecom actions
- product-specific prerequisites are understood before writes

Common examples:

- buying a phone number needs funding and usually a clear intended use
- sending US A2P traffic may require 10DLC registration
- placing live calls or deploying assistants should preserve the IDs needed for later review

For long-running voice agents or assistant workflows, do one additional preflight before the first real call:

- set a daily pilot budget and a monthly ceiling that includes model inference, voice minutes, transcription, synthesis, and any downstream tools the agent can trigger
- decide where alerts fire at 50%, 80%, and 100% of that envelope
- decide how you will attribute spend by assistant, phone number or campaign, environment, and customer or billing group
- preserve `assistant_id`, `phone_number`, `call_control_id`, `call_session_id`, `conversation_id`, and `request_id` so cost reviews can be tied back to specific runs
- if you use external models or tools, place quotas or alerts there too so model spend and telecom spend fail closed together

This is budget and attribution guidance, not a replacement for the broader governed-execution and discovery work tracked elsewhere in the repo.

If any of those are unclear, stop at the read-only workflow in the next step and do not widen to live writes yet.

## Step 4: Run one complete read-only first workflow

The recommended first workflow is: search for one available US phone number candidate without purchasing it.

Why this path:

- it proves authenticated access
- it exercises a real Telnyx telecom surface
- it avoids billing, provisioning, and outbound traffic

Run:

```bash
curl -sS https://api.telnyx.com/v2/available_phone_numbers \
  -D /tmp/telnyx-number-search.headers \
  -o /tmp/telnyx-number-search.json \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -G \
  --data-urlencode "filter[country_code]=US" \
  --data-urlencode "filter[features][]=sms" \
  --data-urlencode "filter[features][]=voice" \
  --data-urlencode "filter[limit]=1"

jq /tmp/telnyx-number-search.json
rg -i '^x-request-id:' /tmp/telnyx-number-search.headers
```

Record:

- the candidate phone number
- the `x-request-id` from the saved response headers
- the exact filters you used

Do not buy the number in this first workflow unless a human or policy has already approved a live-write step.

## Step 5: Pick the next bounded path

After the read-only workflow succeeds, choose the narrowest next guide:

- `https://telnyx.com/guides/sms-messaging.md` for messaging
- `https://telnyx.com/guides/voice-call-control.md` for direct voice APIs
- `https://telnyx.com/guides/ai-assistants.md` for hosted assistants
- `https://telnyx.com/guides/voice-agent-onboarding.md` for the first live assistant answer-webhook path
- `https://telnyx.com/guides/webhooks.md` before implementing inbound event handling

## What to preserve for review

Keep these IDs in your task notes, runbook, or escalation artifact:

- `request_id` for every meaningful probe or write
- `resource_id` for created or mutated resources
- `conversation_id` for assistant reviews
- `webhook_delivery_id` for webhook debugging

That is the minimum audit trail that lets another operator reproduce what happened without guessing.

## Write contract for agent-facing REST mutations

Before your first real write, adopt this retry contract:

- Send `Idempotency-Key` on covered `POST`, `PUT`, `PATCH`, and `DELETE` requests.
- The initial rollout scope is the highest-value agent-facing write surfaces: `/v2/messages`, `/v2/messages/{id}`, `/v2/calls`, `/v2/calls/{id}/actions/*`, `/v2/number_orders`, `/v2/phone_numbers/{id}`, `/v2/ai/assistants`, and `/v2/ai/assistants/{id}`.
- Use a fresh caller-generated opaque ASCII token for each intended mutation. UUIDv4 is the recommended default.
- Reuse that same key only when retrying the exact same intended write after a timeout, transport failure, or ambiguous client-side result.
- Expect duplicate-safe behavior: the same key plus the same normalized request should replay the original success response once completed, or return a deterministic in-progress response while the first write is still running.
- Expect a conflict response if the same key is reused with a materially different payload.
- Expect malformed, oversized, or non-ASCII keys to fail validation before any side effect occurs.
- Preserve the key in your run notes for at least the server retention window, which is a minimum of 24 hours in the published contract.

Use `number_orders` as the representative async workflow for your polling logic:

1. Create the order with `POST https://api.telnyx.com/v2/number_orders`.
2. Save `data.id` from the create response as the poll target.
3. If the response is `202 Accepted`, treat it as incomplete work.
4. If `Retry-After` is present, wait that long before polling again.
5. Poll `GET https://api.telnyx.com/v2/number_orders/{id}` until `data.status` becomes `success` or `failed`.

## API Reference

This guide uses these surfaces first:

- `POST https://telnyx.com/api/inference` for the zero-signup evaluation path
- `GET https://api.telnyx.com/v2/available_phone_numbers` for the first authenticated read-only workflow
- `https://api.telnyx.com/v2/mcp` for authenticated MCP access after key creation
- `https://telnyx.com/auth.md` for auth discovery
- `https://telnyx.com/agent-signup.md` for the current production signup contract

Python example:

```python
import os
import requests

response = requests.get(
    "https://api.telnyx.com/v2/available_phone_numbers",
    headers={"Authorization": f"Bearer {os.environ['TELNYX_API_KEY']}"},
    params={
        "filter[country_code]": "US",
        "filter[limit]": 1,
    },
    timeout=30,
)

print(response.status_code)
print(response.headers.get("x-request-id"))
print(response.json())
```

TypeScript example:

```typescript
const response = await fetch(
  "https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[limit]=1",
  {
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    },
  },
);

console.log(response.status);
console.log(response.headers.get("x-request-id"));
console.log(await response.json());
```
