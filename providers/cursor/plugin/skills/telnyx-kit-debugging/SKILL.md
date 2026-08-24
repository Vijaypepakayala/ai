---
name: telnyx-kit-debugging
description: >-
  Triage Telnyx API errors and runtime failures fast: exact error-code
  meanings, retryability, silent-failure traps (TeXML attribute case, dead
  webhooks, sender-registration filtering), and where to look when calls or messages fail
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
| 40300 on a synchronous send with `Blocked due to STOP message` in the title/detail | Recipient is blocked by a STOP rule | Never — compliance stop |
| 10004 | Missing required parameter | No — add the required field |
| 10005 | Resource or URL not found | No — fix the ID or path |
| HTTP 429 | Rate limited | Yes — after `Retry-After`, not before |
| HTTP 5xx or timeout | Upstream failure; mutation outcome may be unknown | Reads: bounded backoff. Mutations: retry only with documented idempotency (for Call Control, resend the identical command with the same `command_id`); otherwise reconcile the outcome before reissuing. |

- The HTTP status for a structured Telnyx error can vary by endpoint and
  validation stage. Branch on transport status and `errors[0].code`; never
  infer retryability from the first two digits of the Telnyx code.
- Error codes are also phase-sensitive. A synchronous send can return `40300`
  for a STOP block, while an asynchronous `message.finalized` delivery error
  can use `40300` for an unreachable or otherwise permanent destination.
  Classify it using the response/event phase plus `title` and `detail`, never
  the code alone. Likewise, `40008` is an asynchronous undeliverable/filtered
  outcome, not a universal opt-out code.
- A 5xx or timeout does not prove a mutation failed before commit. Never
  automatically replay a billable send, call, or number order merely because
  backoff is bounded. Retry only when that endpoint documents idempotency and
  reuse the original idempotency value; otherwise inspect account state or
  delivery events and reconcile the first attempt before issuing another.
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
- **Webhooks not arriving**: first check the application/profile default and
  any endpoint-supported per-request override. Messaging send requests can set
  `webhook_url`/`webhook_failover_url`, which take priority over the profile.
  Then check the portal debugging tool for delivery attempts + your endpoint's
  TLS and response time (slow 200 = retry storm).
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
- Keep an encrypted, access-controlled, retention-limited store of the minimum
  webhook data needed for replay and delivery disputes.
