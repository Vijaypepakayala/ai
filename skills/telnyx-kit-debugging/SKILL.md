---
name: telnyx-kit-debugging
description: >-
  Triage Telnyx API errors and runtime failures fast: exact error-code
  meanings, retryability, silent-failure traps (TeXML attribute case, dead
  webhooks, 10DLC filtering), and where to look when calls or messages fail
  with no error at all. Do not use for pre-launch architecture or compliance
  review when no runtime failure has occurred.
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
| 422 | 10004 | Missing required parameter | No — add the required field |
| 404 | 10005 | Resource or URL not found | No — fix the ID or path |
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
  documents against the current Telnyx TeXML Verbs & Nouns reference before
  deploying; do not rely on a fixed verb count. The current vocabulary
  includes newer instructions such as `<AIGather>`, `<AIAssistant>`,
  `<ConversationRelay>`, and `<HttpRequest>`.
- **Messages "sent" but never delivered**: delivery outcome only exists in
  the `message.finalized` webhook (`data.payload.to[0].status`) — there is
  no `message.delivered` event. If you keyed on one, your retries never
  fire.
- **US SMS delivered=false with no API error**: check sender-specific carrier
  readiness before blaming code. US local long-code SMS needs 10DLC campaign
  linkage; toll-free traffic needs toll-free verification, while short-code
  traffic needs carrier approval.
- **Webhooks not arriving**: webhook URL is configured on the application/
  profile (not per-request); inspect Webhook Deliveries for the primary and
  configured failover URL, then check endpoint TLS and response time (slow
  200 = retry storm). For API v2 JSON events, trace `data.id`; for flat TeXML
  callbacks, trace `(CallSid, SequenceNumber)` and confirm the route parses its
  configured form/query method rather than expecting `data.*`.
- **Push notifications never arrive (WebRTC mobile)**: a push credential
  that exists but is not ATTACHED to the credential connection delivers
  nothing — set `ios_push_credential_id`/`android_push_credential_id` on
  the connection.

## Observability defaults

- Log Telnyx request id + error code + `detail` on every failure (codes are
  specific; `detail` names the offending field via `source.pointer`).
- Emit metrics per error code, not per HTTP status — 40305 and 40310 are
  different bugs.
- Keep a replayable, access-controlled store of webhook envelopes (they are
  the ground truth for delivery disputes), with personal content redacted or
  encrypted and a defined retention/deletion policy.
- Correlate event `data.id` (or TeXML `CallSid` + `SequenceNumber`),
  `call_session_id`, `call_leg_id`, `command_id`, Telnyx request ID, and error
  code. Monitor primary/failover delivery failures, queue age, and duplicates
  instead of relying on unstructured logs.
