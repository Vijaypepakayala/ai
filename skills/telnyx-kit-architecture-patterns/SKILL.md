---
name: telnyx-kit-architecture-patterns
description: >-
  Reference architectures for Telnyx builds: AI voice agents, high-volume
  messaging, webhook processing, and multi-product apps. Use when DESIGNING a
  system (before code) to pick components, data flow, and failure handling. Do
  not use for a fixed-design guardrail review, a runtime incident diagnosis,
  or a channel/product comparison that does not request system architecture.
metadata:
  author: telnyx
  product: platform
  kind: architect
---

# Telnyx Architecture Patterns

## AI voice agent (the most requested build)

```
Caller → Telnyx number → TeXML app: <Connect><Stream url="wss://you"/></Connect>
       → your WebSocket: audio in → STT → LLM → TTS → audio out
       → optional Call Control commands for transfer/hangup
```

- Answer + stream in one TeXML response; keep the webhook fast (<2s) —
  heavy work happens on the WebSocket, never in the webhook handler.
- Interruption handling: send `{"event":"clear"}` to flush queued audio when
  the caller barges in. `stream_id` appears on server-to-client events but is
  not part of the client clear frame.
- For fully managed flows, `<Connect>` supports AI assistant nouns
  (AIAssistant, ConversationRelay) — no WebSocket server needed.
- Scale unit = concurrent streams; keep per-call state keyed on
  `call_control_id`, never in process globals.
- If the flow records or transcribes, put an explicit notice/consent gate
  before the first recording command. Persist that consent state across
  workers and failover, and design recording retention, access, and deletion
  before enabling capture — see telnyx-kit-guardrails.

## High-volume messaging

- One messaging profile per traffic class (marketing vs transactional vs
  OTP) — profiles carry throughput and webhook config. For US A2P, a local
  10-digit long-code sender uses a messaging profile linked to its 10DLC
  campaign; a toll-free sender needs toll-free verification, while a short
  code sender needs carrier approval/provisioning.
- Queue sends (worker + retry with backoff on 429 reading `Retry-After`);
  never loop sends inline in a request handler.
- Delivery truth: `message.finalized` webhook, outcome in
  `data.payload.to[0].status`. Key retries on the message `id`; make
  handlers idempotent (webhooks redeliver).
- Store conversation state server-side keyed on BOTH numbers (user × your
  number), with a TTL.

## Webhook processing by API family

For API v2 JSON event webhooks (including Messaging and Call Control):

- Verify the raw request bytes before parsing using the
  `telnyx-signature-ed25519` and `telnyx-timestamp` request headers plus the
  public key from Mission Control Portal (`TELNYX_PUBLIC_KEY`) — see
  telnyx-kit-guardrails.
- Return 200 fast; enqueue work. Telnyx retries on timeout — dedupe on the
  event `data.id` before side effects.
- The event envelope is nested: `data.event_type`, `data.payload.*`. Route on
  `data.event_type` with an explicit allowlist and a logged default arm.

TeXML instruction requests and status callbacks are a separate wire format:

- A configured POST carries flat, PascalCase form fields as
  `application/x-www-form-urlencoded`; a configured GET carries the same
  fields in the query string. Do not parse these as JSON or read `data.*`.
- For signed callbacks, verify the raw request before decoding the form. Treat
  retries as duplicates and dedupe status callbacks on the composite
  `(CallSid, SequenceNumber)` rather than `data.id`.
- Keep API v2 JSON and TeXML routes separate so content-type, parsing,
  validation, and idempotency rules cannot be confused.

## Multi-product apps (e.g. contact center)

- Numbers are the join point: a number carries voice (connection) AND
  messaging (profile) assignments — provision both at purchase time.
- Use `connection_id` (voice) and `messaging_profile_id` (messaging)
  explicitly in config, never inferred at runtime.
- Keep provisioning (buy number, attach profile/connection) in setup
  scripts, not request paths — provisioning APIs have distinct rate/auth
  characteristics from runtime APIs.

## Failure design defaults

- Every Telnyx client call: timeout + surfaced error code (codes are
  precise — see telnyx-kit-debugging) + no retry on 4xx except 429.
- Idempotency: `command_id` on Call Control commands; message `id` dedupe
  on webhooks.
- Configure distinct primary and failover webhook URLs for critical call
  paths. Exercise failover before launch; both endpoints must verify
  signatures, share the same durable dedupe store, and fast-ack before work.
- Correlate `data.id`, `call_control_id`, `call_session_id`, `call_leg_id`,
  `command_id`, Telnyx request IDs, and error codes across ingress, commands,
  and workers. Alert on primary/failover delivery failures, queue age, and
  duplicate suppression. Never log API keys or webhook secrets, recording
  URLs, recording media, or transcript content.
- In every architecture response that includes observability or recording,
  state that logging must exclude API keys, webhook secrets, recording URLs,
  recording media, and transcript content; do not leave this boundary implied.
- For a static single-tenant service, validate its process-wide API key,
  profile IDs, and connection IDs at startup. In a delegated multi-tenant
  service, validate the current tenant's credential and resource IDs before
  that request's first outbound Telnyx action; a tenant credential cannot be
  validated globally at process boot.
