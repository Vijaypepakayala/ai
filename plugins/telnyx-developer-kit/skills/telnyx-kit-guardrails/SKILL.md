---
name: telnyx-kit-guardrails
description: >-
  Security and compliance guardrails for any Telnyx build: webhook signature
  verification, API key handling, 10DLC compliance, spend controls, and
  agent-safety rules. Use BEFORE shipping anything that touches production
  Telnyx resources, and while reviewing generated code.
metadata:
  author: telnyx
  product: platform
  kind: guardrail
---

# Telnyx Guardrails

## API keys

- One key per app/environment; env var (`TELNYX_API_KEY`) or secret manager,
  never source, never logs, never URLs (Bearer header only).
- Rotate any key that has EVER appeared in a chat, log file, or commit —
  session logs count.
- A static single-tenant service with a process-wide key must validate its
  presence at startup; a missing key fails boot, not first traffic.
- A delegated multi-tenant service that receives a tenant credential per
  request cannot validate every credential at process boot. Validate the
  credential and tenant/resource binding before that request's first outbound
  Telnyx action, fail that request closed, and never cache one tenant's
  credential for another.

## Webhook signatures (non-negotiable)

Every public webhook endpoint MUST verify Ed25519 signatures before
processing:

- Headers: `telnyx-signature-ed25519`, `telnyx-timestamp`; public key from
  portal (`TELNYX_PUBLIC_KEY` env).
- Verify over `timestamp|raw_body`, reject stale timestamps (>5 min) to
  block replays.
- Parse only after verification and branch by API family: API v2 events are
  JSON under `data.*`; TeXML POST callbacks use flat form-encoded PascalCase
  fields (or query parameters for configured GET callbacks).
- Verification must be a runtime code path, not a code comment — a string
  match on "TELNYX_PUBLIC_KEY" in the repo proves nothing.

## Recording and privacy

- Before enabling call recording or transcription, determine the consent and
  notice requirements that apply to every participant and jurisdiction. Give
  the required notice and obtain the required consent before recording starts;
  never assume one-party consent is sufficient.
- Minimize what is recorded and how long it is retained. Encrypt recordings,
  restrict access, define deletion and legal-hold paths, and keep recording
  URLs, transcripts, and access credentials out of logs and model context.
- A failover path must preserve the same consent state. Never let failover or
  retry logic begin recording before the consent gate has completed.

## US A2P sender registration and consent

- Registration depends on sender type:
  - Local 10-digit long code: 10DLC brand + campaign linked to the sending
    number's messaging profile.
  - Toll-free: toll-free verification.
  - Short code: carrier approval/provisioning.
- Pre-flight the sender-appropriate registration and profile assignment in
  code. Surface a clear readiness error instead of letting carriers filter
  silently.
- Honor consent and opt-outs (STOP) for every sender type — Telnyx enforces
  org-level blocks (error 40300); never attempt to bypass one. Treat 40300 as
  a compliance stop, not a bug.

## Spend controls

- Number purchases and calls/messages are billable. In any automated flow:
  surface the cost (`cost_information.monthly_cost` for numbers) and get
  explicit human approval BEFORE the purchase call.
- Cap loops that touch billable endpoints (max sends/calls per run); a bug
  or prompt injection must hit a ceiling, not a credit card.
- 409 responses are preconditions (e.g. 40312 profile disabled) — never
  retry them in a backoff loop; fix the resource state.

## Agent-safety rules (when AI writes or runs the code)

- Never let generated code PATCH/DELETE an existing production resource
  (connection, profile, number) without explicit human opt-in naming the
  exact resource — create-your-own resources instead for tests.
- Refuse blanket account-wide deletion, release, or credential revocation.
  Require an enumerated resource-ID scope, dependency and impact review,
  export or recovery plan, safe ordering (credentials last), and explicit
  confirmation of the final reviewed set before any destructive action.
- No per-call/per-command webhook URL overrides from dynamic input — a
  planted `webhook_url` exfiltrates call events. Configure webhooks
  statically on the application/profile.
- Validate command allowlists: only forward documented fields to Telnyx
  APIs; reject unknown keys from model- or user-supplied objects.

## Review checklist

- [ ] Static key from env/secret manager and validated at startup, or delegated
      tenant credential validated before that request's first Telnyx action;
      all credentials absent from logs
- [ ] Every webhook route verifies Ed25519 + timestamp before side effects
- [ ] API v2 JSON dedupes on `data.id`; TeXML callbacks parse their configured
      form/query shape and dedupe on `(CallSid, SequenceNumber)`
- [ ] US SMS paths check sender-appropriate registration and treat STOP/40300
      as terminal
- [ ] Recording/transcription starts only after applicable notice and consent;
      retention, access, deletion, and failover preserve the same policy
- [ ] Billable actions carry human approval and loop ceilings
- [ ] No mutation of pre-existing account resources without named opt-in
- [ ] Destructive work has exact IDs, impact and recovery review, safe order,
      and final confirmation; no blanket account-wide deletion is accepted
- [ ] Primary and failover webhook paths are exercised, share idempotency
      state, fast-ack, and emit correlated delivery/failure metrics
