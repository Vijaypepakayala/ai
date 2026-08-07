# Webhooks

> Set up real-time event notifications for messaging, voice, and account events.

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- A publicly accessible HTTPS endpoint to receive webhooks

## What Are Webhooks?

Webhooks are HTTP callbacks that Telnyx sends to your server when events occur — a message reaches a final delivery state, a call is answered, etc. API v2 event webhooks use a nested JSON envelope under `data.*`. TeXML instruction requests and status callbacks are separate: configured POSTs use flat form-encoded fields, while configured GETs use query parameters.

## Quick Start

```bash
# Configure webhook URL on a messaging profile
curl -X PATCH "https://api.telnyx.com/v2/messaging_profiles/{profile_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-app.com/webhooks/telnyx"
  }'
```

## API Reference

### List Webhook Deliveries

**`GET /v2/webhook_deliveries`**

```bash
curl --globoff "https://api.telnyx.com/v2/webhook_deliveries?page[size]=20" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response:**

```json
{
  "data": [
    {
      "id": "delivery-uuid",
      "record_type": "webhook_delivery",
      "status": "delivered",
      "started_at": "2024-01-15T12:00:00Z",
      "finished_at": "2024-01-15T12:00:01Z",
      "webhook": {
        "url": "https://your-app.com/webhooks",
        "event_type": "message.finalized"
      },
      "attempts": [
        {
          "status": "delivered",
          "started_at": "2024-01-15T12:00:00Z",
          "finished_at": "2024-01-15T12:00:01Z",
          "http": {
            "request": {
              "url": "https://your-app.com/webhooks",
              "method": "POST"
            }
          },
          "errors": []
        }
      ]
    }
  ]
}
```

**Filters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page[size]` | integer | Results per page (max 250) |
| `filter[status]` | string | `success`, `failed` |
| `filter[event_type]` | string | e.g. `message.finalized`, `call.answered` |

```python
import requests

API_KEY = "KEY..."
BASE_URL = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# List recent deliveries
deliveries = requests.get(
    f"{BASE_URL}/webhook_deliveries",
    headers=headers,
    params={"page[size]": 20}
).json()

for d in deliveries["data"]:
    event_type = d["webhook"]["event_type"]
    status = d["status"]
    print(f"{event_type} → {status}")
```

```typescript
const API_KEY = process.env.TELNYX_API_KEY!;

const response = await fetch(
  "https://api.telnyx.com/v2/webhook_deliveries?page[size]=20",
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);
const { data } = await response.json();

for (const delivery of data) {
  console.log(`${delivery.webhook.event_type} → ${delivery.status}`);
}
```

### Get Webhook Delivery Details

**`GET /v2/webhook_deliveries/{id}`**

```bash
curl "https://api.telnyx.com/v2/webhook_deliveries/{delivery_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response:**

```json
{
  "data": {
    "id": "delivery-uuid",
    "record_type": "webhook_delivery",
    "status": "delivered",
    "started_at": "2024-01-15T12:00:00Z",
    "finished_at": "2024-01-15T12:00:01Z",
    "webhook": {
      "url": "https://your-app.com/webhooks",
      "event_type": "message.finalized"
    },
    "attempts": [
      {
        "status": "delivered",
        "started_at": "2024-01-15T12:00:00Z",
        "finished_at": "2024-01-15T12:00:01Z",
        "http": {
          "request": {
            "url": "https://your-app.com/webhooks",
            "method": "POST"
          }
        },
        "errors": []
      }
    ]
  }
}
```

```python
# Get delivery details
delivery_id = "delivery-uuid"
detail = requests.get(
    f"{BASE_URL}/webhook_deliveries/{delivery_id}",
    headers=headers
).json()
print(f"Status: {detail['data']['status']}")
print(f"Webhook URL: {detail['data']['webhook']['url']}")
```

```typescript
const deliveryId = "delivery-uuid";
const detail = await fetch(
  `https://api.telnyx.com/v2/webhook_deliveries/${deliveryId}`,
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);
const { data: delivery } = await detail.json();
console.log(`Status: ${delivery.status}, URL: ${delivery.webhook.url}`);
```

## Setting Up Webhooks

### Messaging Profile Webhooks

**`PATCH /v2/messaging_profiles/{id}`**

```bash
curl -X PATCH "https://api.telnyx.com/v2/messaging_profiles/{profile_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-app.com/webhooks/sms",
    "number_pool_settings": {
      "webhook_url": "https://your-app.com/webhooks/sms-pool"
    }
  }'
```

### Voice Connection Webhooks

**`PATCH /v2/connections/{id}`**

```bash
curl -X PATCH "https://api.telnyx.com/v2/connections/{connection_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_api_url": "https://your-app.com/webhooks/voice"
  }'
```

### Phone Number Webhooks

Override profile-level webhooks for specific numbers:

**`PATCH /v2/phone_numbers/{id}`**

```bash
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/{number_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-app.com/webhooks/custom"
  }'
```

## Webhook Payload Format

### Message Finalized (delivered outcome)

```json
{
  "data": {
    "event_type": "message.finalized",
    "id": "uuid",
    "occurred_at": "2024-01-15T12:00:00Z",
    "record_type": "event",
    "payload": {
      "id": "msg-uuid",
      "to": [
        {
          "phone_number": "+15559876543",
          "status": "delivered"
        }
      ],
      "from": {"phone_number": "+15551234567"},
      "errors": []
    }
  }
}
```

### Message Received (Inbound)

```json
{
  "data": {
    "event_type": "message.received",
    "id": "uuid",
    "occurred_at": "2024-01-15T12:00:00Z",
    "payload": {
      "to": "+15551234567",
      "from": "+15559876543",
      "text": "Hello!",
      "message_id": "msg-uuid"
    }
  }
}
```

### Call Events

```json
{
  "data": {
    "event_type": "call.answered",
    "id": "uuid",
    "occurred_at": "2024-01-15T12:00:00Z",
    "payload": {
      "call_control_id": "v3:abc123",
      "call_leg_id": "uuid",
      "from": "+15551234567",
      "to": "+15559876543"
    }
  }
}
```

## Verifying Webhook Signatures

Telnyx signs webhooks with Ed25519. Verify the signature to ensure requests are authentic.

```python
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
import base64
import binascii
import json
import os
import time

PUBLIC_KEY_PEM = os.environ["TELNYX_PUBLIC_KEY"]

def verify_telnyx_signature(payload: bytes, signature_header: str, timestamp_header: str, tolerance_seconds: int = 300) -> bool:
    """Verify Telnyx webhook signature."""
    if not timestamp_header.isascii() or not timestamp_header.isdecimal():
        return False
    try:
        timestamp = int(timestamp_header)
        if abs(time.time() - timestamp) > tolerance_seconds:
            return False
        signature = base64.b64decode(signature_header, validate=True)
        public_key = serialization.load_pem_public_key(PUBLIC_KEY_PEM.encode())
        if not isinstance(public_key, Ed25519PublicKey):
            return False
        signed_payload = timestamp_header.encode("ascii") + b"|" + payload
        public_key.verify(signature, signed_payload)
        return True
    except (InvalidSignature, ValueError, TypeError, binascii.Error):
        return False
```

## Debugging Webhooks
Use the list and detail requests in the API Reference above to inspect recent
delivery attempts and their errors.

## Testing Locally with ngrok

```bash
# Start ngrok
ngrok http 3000

# Use the ngrok URL for your webhook
# https://abc123.ngrok.io/webhooks/telnyx

# Configure in messaging profile
curl -X PATCH "https://api.telnyx.com/v2/messaging_profiles/{id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url": "https://abc123.ngrok.io/webhooks/telnyx"}'
```

## Python Webhook Handler
The handler verifies the exact raw request body with `verify_telnyx_signature`
from the previous section before parsing JSON or performing any work.

```python
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/webhooks/telnyx", methods=["POST"])
def handle_webhook():
    raw_payload = request.get_data(cache=False)
    signature = request.headers.get("telnyx-signature-ed25519")
    timestamp = request.headers.get("telnyx-timestamp")
    if not signature or not timestamp or not verify_telnyx_signature(
        raw_payload, signature, timestamp
    ):
        return jsonify({"error": "invalid webhook signature"}), 401

    try:
        payload = json.loads(raw_payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return jsonify({"error": "invalid JSON"}), 400

    event_type = payload.get("data", {}).get("event_type")
    
    if event_type == "message.received":
        handle_inbound_sms(payload["data"]["payload"])
    elif event_type == "message.finalized":
        message = payload["data"]["payload"]
        if message["to"][0]["status"] == "delivered":
            log_delivery(message)
    elif event_type == "call.answered":
        handle_call_answered(payload["data"]["payload"])
    
    return jsonify({"status": "ok"}), 200

def handle_inbound_sms(payload):
    from_number = payload["from"]
    text = payload["text"]
    print(f"SMS from {from_number}: {text}")
```

## TypeScript Webhook Handler

```typescript
import { createPublicKey, verify } from "node:crypto";
import express from "express";

const app = express();
const publicKeyPem = process.env.TELNYX_PUBLIC_KEY;
type TelnyxEventPayload = {
  from?: string;
  text?: string;
  to?: Array<{ status?: string; phone_number?: string }>;
  call_control_id?: string;
};

function verifyTelnyxSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
): boolean {
  if (!publicKeyPem || !signatureHeader || !timestampHeader) return false;
  if (!/^\d+$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  try {
    const signedPayload = Buffer.concat([
      Buffer.from(`${timestampHeader}|`, "ascii"),
      payload,
    ]);
    return verify(
      null,
      signedPayload,
      createPublicKey(publicKeyPem),
      Buffer.from(signatureHeader, "base64"),
    );
  } catch {
    return false;
  }
}

app.post("/webhooks/telnyx", express.raw({ type: "application/json" }), (req, res) => {
  const rawPayload = req.body as Buffer;
  if (!verifyTelnyxSignature(
    rawPayload,
    req.get("telnyx-signature-ed25519"),
    req.get("telnyx-timestamp"),
  )) {
    return res.status(401).json({ error: "invalid webhook signature" });
  }

  let body: { data?: { event_type?: string; payload?: TelnyxEventPayload } };
  try {
    body = JSON.parse(rawPayload.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid JSON" });
  }

  const eventType = body.data?.event_type;
  const payload = body.data?.payload;

  switch (eventType) {
    case "message.received":
      console.log(`SMS from ${payload?.from}: ${payload?.text}`);
      break;
    case "message.finalized":
      if (payload?.to?.[0]?.status === "delivered") {
        console.log(`Delivered to ${payload.to[0].phone_number}`);
      }
      break;
    case "call.answered":
      console.log(`Call answered: ${payload?.call_control_id}`);
      break;
  }

  res.json({ status: "ok" });
});

app.listen(3000, () => console.log("Webhook server on :3000"));
```

## Common Failure Modes

| Issue | Symptoms | Resolution |
|-------|----------|------------|
| Invalid URL | 404 responses | Check URL is accessible |
| SSL errors | Delivery failures | Ensure valid TLS certificate |
| Timeout | Delivery is retried or sent to a configured failover URL | Return `2xx` within 2 seconds and process asynchronously |
| Wrong content-type | Parse errors | API v2 events use JSON; TeXML POST callbacks use form encoding |
| Signature mismatch | Rejected requests | Verify signature correctly |

## Retry Behavior

Telnyx retries failed webhook deliveries with backoff and may try a configured
failover URL. Attempt counts and schedules are product- and configuration-specific,
so do not build correctness around one universal retry sequence. Treat every
delivery as potentially duplicated and use the event identifier as an idempotency
key.

## Best Practices

1. **Respond quickly** — For API v2 webhooks, return `2xx` within 2 seconds and process asynchronously
2. **Verify signatures** — Ensure requests are from Telnyx
3. **Handle duplicates** — API v2 events dedupe on `data.id`; TeXML status callbacks dedupe on `(CallSid, SequenceNumber)`
4. **Log everything** — Store raw payloads for debugging
5. **Monitor deliveries** — Check webhook_deliveries API regularly

## Resources

- [Webhook API Reference](https://developers.telnyx.com/docs/api/v2/webhooks)
- [Webhook Security](https://developers.telnyx.com/docs/webhooks/security)
