---
name: telnyx-kit-guardrails
description: >-
  Security and compliance guardrails for any Telnyx build: webhook signature
  verification, API key handling, US A2P compliance, spend controls, and
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
  request must validate the credential and tenant/resource binding before
  that request's first Telnyx action. Never cache one tenant's credential for
  another.

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

## Recording and payment-data privacy

- Before recording or transcribing, determine the notice and consent rules
  that apply to every participant and jurisdiction. Obtain the required
  consent before capture starts; failover and retries must preserve that gate.
- Minimize retention, encrypt recordings, restrict access, define deletion
  and legal-hold paths, and keep recording URLs and transcript content out of
  logs and model context.
- For Pay over Voice, use a configured Payment Connector and Telnyx's Pay
  session. Do not collect card or bank data in application logs, recordings,
  transcripts, webhook debug dumps, or model context; start in test mode.

## US A2P sender registration and consent

- Registration depends on sender type: local 10-digit long codes need a 10DLC
  brand and campaign; toll-free senders need toll-free verification; short
  codes need carrier approval/provisioning.
- Pre-flight the sender-appropriate registration and messaging-profile
  assignment. Surface a clear readiness error instead of letting carriers
  filter silently.
- Honor consent and opt-outs (STOP) for every sender type — Telnyx enforces
  block rules and a synchronous send can return error `40300` with a title or
  detail stating `Blocked due to STOP message`; never attempt to bypass a
  confirmed block. Do not classify every asynchronous delivery error with code
  `40300` as STOP — inspect the response/event phase, title, and detail.

## Spend controls

- Number purchases and calls/messages are billable. In any automated flow:
  surface the cost (`cost_information.monthly_cost` for numbers) and get
  explicit human approval BEFORE the purchase call.
- Cap loops that touch billable endpoints (max sends/calls per run); a bug
  or prompt injection must hit a ceiling, not a credit card.
- Configuration and compliance failures (for example, `errors[].code` 40312
  for a disabled messaging profile) require intervention. Do not put them in
  an automatic backoff loop merely because a transport status looks retryable.

## Agent-safety rules (when AI writes or runs the code)

- Never let generated code PATCH/DELETE an existing production resource
  (connection, profile, number) without explicit human opt-in naming the
  exact resource — create-your-own resources instead for tests.
- Refuse blanket account-wide deletion, release, or credential revocation.
  Require enumerated resource IDs, dependency and impact review, a recovery
  plan, safe ordering, and explicit confirmation of the final reviewed set.
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
      form/query shape and dedupe on TeXML identifiers
- [ ] US SMS paths check sender-appropriate registration, treat a confirmed
      STOP block as terminal, and do not infer STOP from an async error code alone
- [ ] Recording/transcription and Pay flows keep consent and sensitive-data
      boundaries intact across primary, retry, and failover paths
- [ ] Billable actions carry human approval and loop ceilings
- [ ] No mutation of pre-existing account resources without named opt-in
- [ ] Destructive work has exact IDs, impact and recovery review, safe order,
      and final confirmation; no blanket account-wide deletion is accepted
