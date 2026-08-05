---
name: telnyx-kit-quickstart
description: >-
  Go from zero to a working Telnyx integration in one session: account and key
  setup, the first verified API call, and the provisioning each product needs
  before it will work. Use when starting a NEW Telnyx build or when a first
  call fails with an auth, provisioning, or compliance error.
metadata:
  author: telnyx
  product: platform
  kind: setup
---

# Telnyx Quickstart

The fastest correct path from nothing to a working call or message. Do these
in order — most first-call failures are a skipped step here, not a code bug.

## 1. Key and connectivity (2 minutes)

```bash
export TELNYX_API_KEY="KEY..."   # portal.telnyx.com/#/app/api-keys
curl -s -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/balance
```

A `200` with a balance object means auth works. `401` with code `10009` means
the key is wrong or missing — fix that before anything else. Put the key in an
env var or secret manager, never in source (see `telnyx-kit-guardrails`).

Check the balance value too: a negative balance blocks billable actions
(sends, calls, number purchases) with errors that do not obviously say
"you are out of money".

## 2. A number, with the right capability

```bash
# search (free, read-only)
curl -s -G -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "filter[country_code]=US" \
  --data-urlencode "filter[features][]=sms" \
  --data-urlencode "filter[features][]=voice" \
  --data-urlencode "filter[limit]=5" \
  "https://api.telnyx.com/v2/available_phone_numbers"

# order (BILLABLE — recurring monthly charge; confirm the cost first)
curl -s -X POST -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_numbers":[{"phone_number":"+1..."}]}' \
  "https://api.telnyx.com/v2/number_orders"
```

Numbers carry capabilities. A voice-only number will not send SMS no matter
how correct your code is — filter on the features you need at search time.
Immediately before ordering, re-query the selected number, present its current
authoritative upfront and recurring costs with currency, and obtain explicit
human approval naming that number. Do not approve against a caller-supplied or
stale quote.

## 3. Provisioning per product (the step people skip)

A number alone is not enough. Each product needs its own association before
traffic flows:

| To do this | The number needs | Set via |
|---|---|---|
| Send/receive SMS | a **messaging profile** assigned | `PATCH /v2/phone_numbers/{id}/messaging` (separate sub-resource — not the base PATCH) |
| Receive calls to your app | a **connection / Call Control app** assigned | `PATCH /v2/phone_numbers/{id}` with `connection_id` |
| Make outbound calls | connection + an **outbound voice profile** attached to it | `PATCH /v2/{credential\|ip}_connections/{id}` with `outbound.outbound_voice_profile_id` |
| Send US A2P SMS | messaging profile linked to a **10DLC campaign** | 10DLC brand + campaign registration |
| Send/receive fax | a **fax application** (`connection_id` is required on send) | `POST /v2/fax_applications` |

Note the internal id vs E.164 distinction: `PATCH`/`DELETE` on numbers take the
**internal numeric id**, not the phone number. Look it up first:
`GET /v2/phone_numbers?filter[phone_number]=+1...`.

## 4. First verified call

Send one message to your own phone and confirm delivery end to end. This is a
billable action: first check the current price for the exact sender,
destination, and route; present a one-message maximum with currency; and get
explicit human approval for that cap. Do not infer approval from the presence
of a destination number or API key.

```bash
curl -s -X POST -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"+1YOURNUMBER","from":"+1YOURTELNYXNUMBER","text":"hello"}' \
  "https://api.telnyx.com/v2/messages"
```

Then fetch the message by id: delivery truth is `data.to[0].status`, not the
send response. `queued` or `sending` is not delivered — poll or use the
`message.finalized` webhook.

## 5. Webhooks, if your product needs them

Voice (beyond fire-and-forget), inbound SMS, fax, and verify all deliver
results by webhook. Before writing handlers:

- Configure the webhook URL on the **application/profile**, not per request.
- Verify Ed25519 signatures before processing (`telnyx-kit-guardrails`).
- Return `200` fast and do work asynchronously; Telnyx retries on timeout, so
  make handlers idempotent on `data.id`.
- Payloads are nested: `data.event_type`, `data.payload.*`.

For local development, expose a tunnel (ngrok or similar) and point the
application's webhook URL at it — Telnyx must reach your endpoint from the
public internet.

## First-call failure decode

| Symptom | Cause | Fix |
|---|---|---|
| `401` / `10009` | bad or missing key | check `TELNYX_API_KEY` |
| `400` / `40305` | `from` number not on the sending messaging profile | assign the number to the profile |
| `409` / `40312` | messaging profile disabled | enable it, do not retry |
| `409` / `40300` | STOP/compliance block | terminal — do not work around |
| `422` / `10004` | required parameter missing (e.g. fax `connection_id`) | add the parameter |
| API `200` but nothing arrives | provisioning or 10DLC filtering | check step 3, then `telnyx-kit-debugging` |

Deeper triage lives in `telnyx-kit-debugging`; product selection in
`telnyx-kit-product-navigator`; the compliance and safety rules you should
apply from day one in `telnyx-kit-guardrails`.
