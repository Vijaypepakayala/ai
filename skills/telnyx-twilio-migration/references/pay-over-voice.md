# Pay over Voice Migration

Use this reference when discovery reports the `pay` product. First identify
which source surface is present; do not translate between them implicitly.

## TeXML `<Pay>`

For TwiML/TeXML documents, use the `<Pay>` contract in `texml-verbs.md` and run
`validate-texml.sh` on every migrated XML document. Configure the Payment
Connector in test mode before exercising the flow.

## Direct Voice API

The generated language reference snapshots do not currently expose a Pay SDK
method. Do not invent one. Use the documented HTTP endpoint directly with the
project's normal HTTP client:

```http
POST /v2/calls/{call_control_id}/actions/pay
Authorization: Bearer $TELNYX_API_KEY
Content-Type: application/json
```

```json
{
  "connector_name": "my-payment-connector",
  "amount": 10.00,
  "currency": "USD",
  "payment_method": "credit-card",
  "transaction_type": "charge",
  "description": "Order #12345"
}
```

For tokenization, set `transaction_type` to `tokenize` and omit `amount`.
Never rely on the server to infer charge versus tokenization semantics.

The direct API defaults `connector_name` to `Default`, `currency` to `USD`, and
`payment_method` to `credit-card`. A positive `amount` is required for a charge;
`transaction_type` is optional but this migration reference sets it explicitly
to avoid changing charge/tokenize behavior. The API also documents
`payment_token`, `description`, `metadata`, `parameters`, `prompts`,
`max_attempts`, `timeout_millis`, `inter_digit_timeout_millis`, `voice`,
`language`, `service_level`, and `client_state`. Preserve only fields required
by the source behavior and verify their current schema before adding optional
fields.

Handle `call.payment.progress` and `call.payment.completed` API v2 webhooks.
Keep payment digits out of application logs, recordings, transcripts, webhook
dumps, and model context.

Authoritative contract: [Pay over Voice](https://developers.telnyx.com/docs/voice/programmable-voice/pay).
