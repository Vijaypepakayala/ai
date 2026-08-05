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
- Validate presence at startup; a missing key must fail boot, not first call.

## Webhook signatures (non-negotiable)

Every public webhook endpoint MUST verify Ed25519 signatures before
processing:

- Headers: `telnyx-signature-ed25519`, `telnyx-timestamp`; public key from
  portal (`TELNYX_PUBLIC_KEY` env).
- Verify over `timestamp|raw_body`, reject stale timestamps (>5 min) to
  block replays.
- Verification must be a runtime code path, not a code comment — a string
  match on "TELNYX_PUBLIC_KEY" in the repo proves nothing.

## 10DLC (US A2P SMS)

- No US application-to-person SMS flows without a registered brand +
  campaign linked to the sending number's messaging profile.
- Pre-flight in code: number → messaging profile assigned? → profile
  linked to a campaign? Surface a clear "not 10DLC-ready" error instead of
  letting carriers filter silently.
- Honor opt-outs (STOP) — Telnyx enforces org-level blocks (error 40300);
  never attempt to bypass one. Treat 40300 as a compliance stop, not a bug.

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
- No per-call/per-command webhook URL overrides from dynamic input — a
  planted `webhook_url` exfiltrates call events. Configure webhooks
  statically on the application/profile.
- Validate command allowlists: only forward documented fields to Telnyx
  APIs; reject unknown keys from model- or user-supplied objects.

## Review checklist

- [ ] Key from env/secret manager, validated at startup, absent from logs
- [ ] Every webhook route verifies Ed25519 + timestamp before side effects
- [ ] US SMS paths check 10DLC readiness and handle STOP/40300 as terminal
- [ ] Billable actions carry human approval and loop ceilings
- [ ] No mutation of pre-existing account resources without named opt-in
- [ ] Webhook handlers idempotent (`data.id` dedupe) and fast-ack
