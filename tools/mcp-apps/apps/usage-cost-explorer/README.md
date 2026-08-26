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

- `billing_preview_auto_recharge_update` — fetches current prefs and returns a before/after diff plus stateless confirmation token; no mutation.
- `billing_update_auto_recharge_preferences` — requires the preview token, refetches current prefs, enforces app guardrail caps, then patches only if the token still matches.
- `billing_preview_stored_payment_transaction` — validates a top-up amount and returns a stateless confirmation token; no mutation.
- `billing_create_stored_payment_transaction` — requires the preview token, then posts `POST /payment/stored_payment_transactions` using the account's saved payment method.
- `billing_preview_billing_group_update` — fetches current group and returns a before/after diff plus stateless confirmation token; no mutation.
- `billing_update_billing_group` — requires the preview token and refetches current group before patching.
- `billing_create_billing_group` — requires `confirm=true` and a non-empty name.

## Safety guardrails

- Stored payment top-ups require a saved payment method in the Telnyx portal and a preview confirmation token. New payment-method collection, invoice payment, card/bank management, and x402 operations are not exposed.
- Live tools require `TELNYX_API_KEY`; missing keys return a safe MCP tool error without making network calls.
- API keys, authorization headers, payment-like numbers, tokens, and secrets are redacted from Telnyx errors.
- Operational identifiers such as `billing_group_id` are intentionally preserved so users can make follow-up calls.
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
npm install
npm test --workspace @telnyx-mcp-apps/usage-cost-explorer
npm run typecheck --workspace @telnyx-mcp-apps/usage-cost-explorer
npm run build --workspace @telnyx-mcp-apps/usage-cost-explorer
```

Run locally:

```bash
cp apps/usage-cost-explorer/.env.example apps/usage-cost-explorer/.env
npm run dev --workspace @telnyx-mcp-apps/usage-cost-explorer
```

The UI resource is registered at `ui://usage-cost-explorer/index.html`.
