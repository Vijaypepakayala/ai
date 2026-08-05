---
name: telnyx-kit-debugging
description: >-
  Triage Telnyx API errors and runtime failures fast: exact error-code
  meanings, retryability, silent-failure traps (TeXML attribute case, dead
  webhooks, 10DLC filtering), and where to look when calls or messages fail
  with no error at all.
metadata:
  author: telnyx
  product: platform
  kind: guardrail
---

# Telnyx Debugging & Observability

## Error-code triage (memorize the retry column)

| HTTP | Code | Meaning | Retry? |
|---|---|---|---|
| 401 | 10009 | Bad/missing API key | No — fix auth |
| 400 | 40310 | Invalid phone number | No — fix input |
| 400 | 40305 | `from` number not on the sending messaging profile | No — fix provisioning |
| 409 | 40312 | Messaging profile disabled | No — enable profile (`PATCH /v2/messaging_profiles/{id}` `enabled:true`) |
| 409 | 40300 | Blocked (STOP/org compliance) | Never — compliance stop |
| 422 | 10004/10005 | Missing/invalid required param | No — fix request |
| 429 | — | Rate limited | Yes — after `Retry-After` seconds, not before |
| 5xx | — | Upstream | Yes — bounded backoff |

- 409 is a PRECONDITION class with no Twilio counterpart — code ported
  from Twilio usually lacks a 409 branch and surfaces it as an unhandled
  exception. Add the branch; never blind-retry it.
- SDK errors (Node telnyx@6): HTTP status is `err.status`; the Telnyx code
  is `err.error?.errors?.[0]?.code`. (`err.statusCode` and `err.rawErrors`
  are undefined — dead branches if you use them.)

## Silent failures (no error, nothing happens)

- **TeXML attributes are case-sensitive and unknown ones are silently
  ignored** — `transcribe=`, `Timeout=`, `numdigits=`, `speechModel=` are
  dead at runtime. Same for unknown verbs: silently dropped. Validate
  documents against the 18-verb whitelist before deploying.
- **Messages "sent" but never delivered**: delivery outcome only exists in
  the `message.finalized` webhook (`data.payload.to[0].status`) — there is
  no `message.delivered` event. If you keyed on one, your retries never
  fire.
- **US SMS delivered=false with no API error**: carrier 10DLC filtering.
  Check campaign linkage before blaming code.
- **Webhooks not arriving**: webhook URL is configured on the application/
  profile (not per-request); check the portal debugging tool for delivery
  attempts + your endpoint's TLS and response time (slow 200 = retry storm).
- **Push notifications never arrive (WebRTC mobile)**: a push credential
  that exists but is not ATTACHED to the credential connection delivers
  nothing — set `ios_push_credential_id`/`android_push_credential_id` on
  the connection.

## Observability defaults

- Log Telnyx request id + error code + `detail` on every failure (codes are
  specific; `detail` names the offending field via `source.pointer`).
- Emit metrics per error code, not per HTTP status — 40305 and 40310 are
  different bugs.
- Keep a replayable store of webhook payloads (they are the ground truth
  for delivery disputes).
