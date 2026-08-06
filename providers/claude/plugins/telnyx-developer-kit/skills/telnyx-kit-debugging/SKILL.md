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

| Code | Meaning | Retry? |
|---|---|---|
| 10009 | Bad/missing API key | No — fix auth |
| 40310 | Invalid `to` number | No — fix input |
| 40305 | `from` number not on the sending messaging profile | No — fix provisioning |
| 40312 | Messaging profile disabled | No — enable the profile, then retry deliberately |
| 40300 | Blocked by STOP/org compliance | Never — compliance stop |
| 10004 | Missing required parameter | No — add the required field |
| 10005 | Resource or URL not found | No — fix the ID or path |
| HTTP 429 | Rate limited | Yes — after `Retry-After`, not before |
| HTTP 5xx | Upstream failure | Yes — bounded backoff |

- The HTTP status for a structured Telnyx error can vary by endpoint and
  validation stage. Branch on transport status and `errors[0].code`; never
  infer retryability from the first two digits of the Telnyx code.
- SDK errors (Node telnyx@6): HTTP status is `err.status`; the Telnyx code
  is `err.error?.errors?.[0]?.code`. (`err.statusCode` and `err.rawErrors`
  are undefined — dead branches if you use them.)

## Silent failures (no error, nothing happens)

- **TeXML attributes are case-sensitive and unknown ones are silently
  ignored** — `transcribe=`, `Timeout=`, `numdigits=`, `speechModel=` are
  dead at runtime. Same for unknown verbs: silently dropped. Validate
  documents against the current TeXML Verbs & Nouns reference before
  deploying; do not rely on a fixed verb count.
- **Messages "sent" but never delivered**: use `message.finalized`
  (`data.payload.to[0].status`) as final delivery truth. Treat the synchronous
  send response and intermediate events as acceptance/progress, not delivery.
- **US SMS delivered=false with no API error**: check sender-specific carrier
  readiness before blaming code — 10DLC for local long codes, toll-free
  verification for toll-free senders, and carrier approval for short codes.
- **Webhooks not arriving**: webhook URL is configured on the application/
  profile (not per-request); check the portal debugging tool for delivery
  attempts + your endpoint's TLS and response time (slow 200 = retry storm).
  API v2 events are JSON under `data.*`; TeXML POST callbacks are flat forms
  and configured GET callbacks use query parameters.
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
