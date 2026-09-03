# Twilio → Telnyx Error Code Mapping

## Telnyx Error Response Format

All Telnyx API errors return JSON in this structure:

```json
{
  "errors": [
    {
      "code": "10009",
      "title": "Authentication failed",
      "detail": "The API key looks malformed. Check that you copied it correctly.",
      "source": { "pointer": "/field_name" },
      "meta": { "url": "https://developers.telnyx.com/docs/overview/errors/10009" }
    }
  ]
}
```

**Key difference from Twilio**: Twilio returns `{ "code": 21211, "message": "..." }` with numeric codes. Telnyx returns `{ "errors": [{ "code": "10009", ... }] }` with string codes in an array.

---

## Authentication Errors

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning | HTTP |
|---|---|---|---|---|
| 20003 | Authentication error | 10009 | Authentication failed — malformed or invalid API key | 401 |
| 20008 | Account not active | 10009 | Authentication failed — credentials not found | 401 |
| 20403 | Forbidden | 10009 | Authentication failed (single code for all auth errors) | 401 |

**Migration note**: Twilio uses Basic Auth (`AccountSID:AuthToken`), Telnyx uses Bearer Token (`Authorization: Bearer $TELNYX_API_KEY`). A missing or invalid auth header returns error `10009` with HTTP `401` (Authentication failed) — the same code used for all authentication failures.

---

## Common API Errors

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning | HTTP |
|---|---|---|---|---|
| 20404 | Resource not found | 10005 | Resource not found | 404 |
| 20429 | Too many requests | 10011 | Too many requests | 429 |
| — | — | 10000 | Invalid parameter (generic validation) | 400 |
| — | — | 10004 | Missing required parameter | 400 |
| — | — | 10027 | Unprocessable entity | 422 |

---

## Messaging Errors — API Response (Synchronous)

These appear in the immediate API response when sending a message.

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning | HTTP |
|---|---|---|---|---|
| 21211 | Invalid 'To' number | 40310 | Invalid 'to' address | 400 |
| 21606 | 'From' number not provisioned | 40305 | Invalid 'from' address — number not on messaging profile | 400 |
| 21408 | Permission not allowed for region | 40309 | Invalid destination region — not in whitelisted_destinations | 400 |
| 21603 | Max body length exceeded | 10015 | Invalid value — message too long (see note on `10015` below) | 400 |
| 21612 | Messaging Service has no numbers | 40321 | No usable numbers on messaging profile | 400 |
| 21610 | Recipient opted out (STOP) | 40300 | Recipient is opted out | 400 |
| — | *(no Twilio equivalent)* | 40312 | **Messaging profile is disabled** | **409** |

> **HTTP 409 has no Twilio counterpart — handle it explicitly.** Twilio has no "profile disabled" precondition, so code ported straight across usually has no 409 branch and the failure surfaces as an unhandled exception. `40312` means the request was valid but the messaging profile is disabled. **409 is NOT retryable** — a backoff loop cannot enable the profile. Enable the profile (`PATCH /v2/messaging_profiles/{id}` with `enabled: true`) or send with an enabled `messaging_profile_id`.

**Migration note:** Twilio's `MessagingServiceSid` maps to Telnyx's `messaging_profile_id`, but usage depends on the sender. A phone-number or short-code send can use the Messaging Profile already assigned to `from`; pass `messaging_profile_id` only to override it. Number-pool and alphanumeric-sender sends require `messaging_profile_id` in the request.

> **About `10015`**: This is a generic "invalid value / bad request" code reused across products and endpoints. Its HTTP status is endpoint- and context-specific (official schemas include both `400` and `422` examples), so read the actual response status plus the `detail` and `source.pointer` fields rather than inferring status or cause from the code alone.

## Messaging Errors — Delivery Webhook (Asynchronous)

These appear in `data.payload.errors[0].code` in `message.finalized` webhook events when delivery fails. They are NOT in the synchronous API response.

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning |
|---|---|---|---|
| 30003 | Unreachable destination | 40001 | Not routable — landline or non-routable number |
| 30007 | Message filtered (carrier) | Endpoint/carrier-specific | Inspect the finalized event's error code and detail |
| 30008 | Unknown/general error | Endpoint/carrier-specific | Inspect the finalized event's error code and detail |
| 30006 | Landline destination | 40001 | Not routable |

`40300` is the immediate API error for a recipient who previously opted out. Treat it as non-retryable and do not attempt to send again until the recipient opts back in. `40008` is a general asynchronous undeliverable result; it is not an opt-out signal.

**Migration note**: Twilio sends `MessageStatus` callbacks with flat params. Telnyx sends `message.finalized` webhooks with nested JSON under `data.payload`. Check `data.payload.to[0].status` for delivery status (`delivered`, `sending_failed`, `delivery_failed`).

---

## Voice Errors

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning | HTTP |
|---|---|---|---|---|
| 13223 | Invalid 'To' phone number | 10016 | Phone number must be in +E.164 format | 422 |
| 13224 | Invalid 'From' phone number | 10016 | Phone number must be in +E.164 format | 422 |
| 21220 | Invalid Call SID | 90015 | Invalid Call Control ID | 422 |
| 13227 | Forbidden — number not owned | 10015 | Invalid value — number/connection issue (see note on `10015`) | 400 |
| 20404 | Call not found | 10005 | Resource not found | 404 |

### Call Hangup Causes (Voice Events)

Telnyx provides `hangup_cause` in call events (replaces Twilio's `CallStatus` + `SipResponseCode`):

| Twilio CallStatus / SIP | Telnyx hangup_cause | Meaning |
|---|---|---|
| `busy` / 486 | `user_busy` | Callee busy |
| `no-answer` / 408 | `timeout` | No answer timeout |
| `canceled` | `originator_cancel` | Caller hung up before answer |
| `completed` | `normal_clearing` | Normal call end |
| `failed` / 503 | `call_rejected` | Call rejected by carrier/callee |
| — | `time_limit` | Call exceeded max duration |

**Migration note**: Telnyx also provides `sip_hangup_cause` with the raw SIP response code (e.g., `486`, `408`, `503`) for more granular debugging.

---

## Verify Errors

| Twilio Code | Twilio Meaning | Telnyx Code | Telnyx Meaning | HTTP |
|---|---|---|---|---|
| 60200 | Invalid parameter | 10002 | Invalid phone number | 400 |
| 60200 | Invalid parameter | 10015 | Invalid value — profile config issue (see note on `10015`) | 400 |
| 60202 | Max send attempts reached | 10011 | Too many requests | 429 |
| 60205 | Not permitted to destination | 40309 | Invalid destination region | 400 |
| 20404 | Service not found | 10005 | Verify profile not found | 404 |

### Verification Status Mapping

| Twilio Status | Telnyx Status | Meaning |
|---|---|---|
| `approved` | `accepted` | Code correct |
| `pending` | `pending` | Awaiting verification |
| `canceled` | — | Manually canceled |
| — | `rejected` | Code incorrect or expired |

**Migration note**: Always include `verify_profile_id` in every Telnyx verify request — it is required, not optional. Check `response_code` field in the verification check response.

---

## Error Handling Code Migration

### Before (Twilio — Python)
```python
from twilio.base.exceptions import TwilioRestException

try:
    message = client.messages.create(body="Hello", to="+1555...", from_="+1555...")
except TwilioRestException as e:
    if e.code == 21211:
        print("Invalid phone number")
    elif e.code == 20003:
        print("Auth failed")
    elif e.status == 429:
        time.sleep(e.retry_after or 1)
```

### After (Telnyx — Python)
```python
import os
from telnyx import Telnyx

client = Telnyx(api_key=os.environ.get("TELNYX_API_KEY"))

try:
    message = client.messages.send(text="Hello", to="+1555...", from_="+1555...", messaging_profile_id="...")
except Exception as e:
    # Telnyx errors have status_code and a JSON body with errors array
    if hasattr(e, 'status_code'):
        if e.status_code == 401:
            print("Auth failed — check TELNYX_API_KEY")
        elif e.status_code == 429:
            print("Rate limited — implement exponential backoff")
        elif e.status_code == 409:
            # Precondition failure — NOT retryable. Usually 40312
            # "Messaging profile is disabled". Retrying cannot fix resource state.
            code = None
            if hasattr(e, 'body') and e.body and 'errors' in e.body:
                code = e.body['errors'][0].get('code')
            if code == "40312":
                print("Messaging profile is disabled — enable it or use an enabled profile")
            else:
                print(f"Conflict ({code}) — fix the resource state; do not retry")
        else:
            error_code = None
            if hasattr(e, 'body') and e.body and 'errors' in e.body:
                error_code = e.body['errors'][0].get('code')
            if error_code == "40310":
                print("Invalid phone number")
            elif error_code == "40305":
                print("From number not on messaging profile")
            else:
                print(f"API error {error_code}: {e}")
    else:
        raise
```

### Before (Twilio — JavaScript)
```javascript
try {
  const message = await client.messages.create({ body: "Hello", to: "+1555...", from: "+1555..." });
} catch (err) {
  if (err.code === 21211) console.error("Invalid phone number");
  else if (err.code === 20003) console.error("Auth failed");
  else if (err.status === 429) await sleep(1000);
}
```

### After (Telnyx — JavaScript)
```javascript
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

try {
  const { data: message } = await client.messages.send({
    text: "Hello", to: "+1555...", from: "+1555...", messaging_profile_id: "..."
  });
} catch (err) {
  // telnyx@6 (verified against the installed SDK): the HTTP code is err.status
  // (err.statusCode is undefined) and the parsed body is err.error, so the
  // Telnyx error code lives at err.error?.errors?.[0]?.code.
  const code = err.error?.errors?.[0]?.code;
  if (err.status === 401 || code === "10009") {
    console.error("Auth failed — check TELNYX_API_KEY");
  } else if (err.status === 429) {
    await sleep(1000); // exponential backoff
  } else if (err.status === 409) {
    // Precondition failure — NOT retryable. Usually 40312 "Messaging profile is
    // disabled". Do not put this branch in a backoff loop: retrying a 409 spins
    // forever because the resource state never changes on its own.
    if (code === "40312") {
      console.error("Messaging profile is disabled — enable it or use an enabled profile");
    } else {
      console.error(`Conflict (${code}) — fix the resource state; do not retry`);
    }
  } else if (code === "40310") {
    console.error("Invalid phone number");
  } else if (code === "40305") {
    console.error("From number not on messaging profile");
  } else {
    console.error(`API error ${code}: ${err.message}`);
  }
}
```
