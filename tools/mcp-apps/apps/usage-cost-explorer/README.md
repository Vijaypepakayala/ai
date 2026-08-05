# Telnyx Usage & Billing Explorer

Read-first MCP app for Telnyx balance, usage, billing groups, and guarded billing controls.

## Scope

Read tools:

- `billing_get_balance` — `GET /balance`
- `billing_get_auto_recharge_preferences` — `GET /payment/auto_recharge_prefs`
- `billing_list_billing_groups` — `GET /billing_groups`
- `billing_get_billing_group` — `GET /billing_groups/{id}`
- `billing_usage_report_options` — `GET /usage_reports/options` (**Usage Reports is beta**)
- `billing_query_usage` — `GET /usage_reports` (**Usage Reports is beta**)

Guarded mutation tools:

- `billing_preview_auto_recharge_update` — fetches current prefs and returns a before/after diff plus an expiring, one-time, credential-bound confirmation token; no mutation.
- `billing_update_auto_recharge_preferences` — atomically reserves the preview token, refetches current prefs, enforces app guardrail caps, then patches only if the reviewed state still matches.
- `billing_preview_stored_payment_transaction` — validates the resolved credential with a bounded balance read, validates the top-up amount, and returns an expiring, one-time confirmation token scoped to the app process and credential fingerprint; no mutation.
- `billing_create_stored_payment_transaction` — requires the preview token, then posts `POST /payment/stored_payment_transactions` using the account's saved payment method.
- `billing_preview_billing_group_update` — fetches current group and returns a before/after diff plus an expiring, one-time, credential-bound confirmation token; no mutation.
- `billing_update_billing_group` — atomically reserves the preview token and refetches current group before patching.
- `billing_preview_billing_group_create` — returns a before/after resource diff plus an expiring, one-time token bound to the credential and exact name; no mutation.
- `billing_create_billing_group` — reserves that preview token before creating one billing group.

## Safety guardrails

- Stored payment top-ups require a saved payment method in the Telnyx portal and a preview confirmation token. The token is reserved atomically before the charge attempt and an ambiguous outcome must be verified in Telnyx Portal transaction history or against account balance; do not retry automatically. New payment-method collection, invoice payment, card/bank management, and x402 operations are not exposed.
- All mutation confirmation state is process-local (5-minute TTL, three outstanding previews per credential, 256 entries per guarded confirmation store). Capacity limits fail closed instead of evicting another credential's live token. A restart invalidates unused pending tokens and loses in-flight ambiguous-action tombstones. The hosted catalog therefore explicitly disables stored-payment and billing-group create previews and confirmations before any Telnyx request. Those four create-style tools require a durable shared confirmation coordinator or upstream idempotency before hosted enablement.
- Auto-recharge and billing-group tokens are bound to the resolved credential, action, and exact requested fields. One logical preview may be outstanding at a time; confirmation reserves it synchronously before an upstream PATCH or POST, so same-token and distinct-preview duplicate mutations fail closed within the process. A known success releases the logical action only after the final MCP response passes sanitization, schema validation, and output-size enforcement. An ambiguous attempt stays blocked for the confirmation TTL in that process and requires the user to verify account state instead of retrying automatically.
- Stored confirmation records retain only the normalized amount and a domain-separated SHA-256 fingerprint of the resolved credential. Raw credentials and internal service confirmation values are neither retained nor logged.
- Live tools require `TELNYX_API_KEY`; missing keys return a safe MCP tool error without making network calls.
- API keys, authorization headers, payment-like numbers, tokens, and secrets are redacted from Telnyx errors.
- Operational identifiers such as `billing_group_id` are intentionally preserved so users can make follow-up calls.
- Sanitized MCP tool output is capped at 1 MiB. Narrow the date range, filters, or page size if a usage result exceeds that boundary.
- Auto-recharge caps default to `5000` for threshold and recharge amounts. Override with:
  - `USAGE_COST_EXPLORER_MAX_AUTO_RECHARGE_THRESHOLD`
  - `USAGE_COST_EXPLORER_MAX_AUTO_RECHARGE_AMOUNT`
- Stored payment top-up caps default to `5000`. Override with:
  - `USAGE_COST_EXPLORER_MAX_STORED_PAYMENT_AMOUNT`

These caps are app guardrails, not Telnyx API policy.

## Usage Reports beta defaults

`billing_query_usage` requires exactly one `product`, at least one `dimensions[]`, and at least one `metrics[]`. It defaults to:

- `format=json`
- `managed_accounts=false`
- `page_number=1`
- capped `page_size`

When explicit `start_date` and `end_date` are provided, this app limits the range to 31 days. Use either explicit dates or `date_range`, not both.

## Development

From `tools/mcp-apps`:

```bash
npm ci
npm test --workspace @telnyx-mcp-apps/usage-cost-explorer
npm run typecheck --workspace @telnyx-mcp-apps/usage-cost-explorer
npm run build --workspace @telnyx-mcp-apps/usage-cost-explorer
```

Run locally:

```bash
cp apps/usage-cost-explorer/.env.example apps/usage-cost-explorer/.env
npm run dev --workspace @telnyx-mcp-apps/usage-cost-explorer
```

For local-only mutation-safety testing, set
`USAGE_COST_EXPLORER_ALLOW_UNSAFE_PROCESS_LOCAL_CREATE_MUTATIONS=true` while
`NODE_ENV` is not `production`. This escape hatch must never be enabled in a
hosted deployment; the app catalog passes an explicit `false` regardless of
environment.

The UI resource is registered at `ui://usage-cost-explorer/index.html`.
