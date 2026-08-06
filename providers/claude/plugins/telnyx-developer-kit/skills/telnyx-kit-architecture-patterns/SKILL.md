---
name: telnyx-kit-architecture-patterns
description: >-
  Reference architectures for Telnyx builds: AI voice agents, high-volume
  messaging, webhook processing, and multi-product apps. Use when DESIGNING a
  system (before code) to pick components, data flow, and failure handling.
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

## High-volume messaging

- One messaging profile per traffic class (marketing vs transactional vs
  OTP) — profiles carry the 10DLC campaign, throughput, and webhook config.
- Queue sends (worker + retry with backoff on 429 reading `Retry-After`);
  never loop sends inline in a request handler.
- Delivery truth: `message.finalized` webhook, outcome in
  `data.payload.to[0].status`. Key retries on the message `id`; make
  handlers idempotent (webhooks redeliver).
- Store conversation state server-side keyed on BOTH numbers (user × your
  number), with a TTL.

## Webhook processing (all products)

- Verify Ed25519 signatures on every webhook (`telnyx-public-key` +
  `telnyx-signature-ed25519` + timestamp) — see telnyx-kit-guardrails.
- Return 200 fast; enqueue work. Telnyx retries on timeout — dedupe on
  `data.id`.
- Payloads are nested: `data.event_type`, `data.payload.*` — never assume
  Twilio's flat form-encoded shape.
- One public webhook endpoint per app; route internally on `event_type`
  (explicit allowlist of handled events + a logged default arm).

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
- Config validation at startup: fail fast if the API key, profile ids, or
  connection ids are absent — not on first traffic.
