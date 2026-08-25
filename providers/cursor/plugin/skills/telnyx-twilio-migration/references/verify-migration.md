# Verify Migration: Twilio Verify to Telnyx Verify

Migrate from Twilio Verify to the Telnyx Verify API for phone number verification and 2FA.

> **CRITICAL: `verify_profile_id` is REQUIRED on every Telnyx Verify API call.** Unlike Twilio where the Service SID is in the URL path, Telnyx requires `verify_profile_id` as a body parameter on both send and check requests. Omitting it will cause a 422 error. Create a profile first (see Setup below), then include it in every request.

## Table of Contents

- [Overview](#overview)
- [Verification Methods](#verification-methods)
- [Setup](#setup)
- [Sending Verification Codes](#sending-verification-codes)
- [Checking Verification Codes](#checking-verification-codes)
- [Flash Calling](#flash-calling)
- [Concept Mapping](#concept-mapping)
- [Webhook Differences](#webhook-differences)

## Overview

Telnyx Verify is not a drop-in replacement for Twilio Verify. The API surface is different, but the functionality is equivalent. Key differences:

- Telnyx uses a **Verify Profile** (analogous to Twilio's Verify Service)
- Different endpoint structure and parameter names
- Telnyx supports flash calling (missed-call verification) which Twilio does not offer on Verify
- Both platforms support WhatsApp verification; Telnyx selects it with the `/verifications/whatsapp` endpoint

## Verification Methods

| Method | Twilio Verify | Telnyx Verify |
|---|---|---|
| SMS OTP | Yes | Yes |
| Voice call OTP | Yes | Yes (`call` channel) |
| WhatsApp OTP | Yes (`whatsapp` channel) | Yes (`/verifications/whatsapp`) |
| Email OTP | Yes | No |
| Push notification | Yes (Authy) | No |
| TOTP | Yes (Authy) | No |
| Flash calling | No | Yes — verification via missed call (caller ID matching) |
| Custom SMS templates | Yes — `TemplateSid` / service `DefaultTemplateSid` | Yes — templates attached to a Verify Profile with `sms.messaging_template_id` |

## Setup

### Create a Verify Profile

Configure every channel this migration will trigger. This profile is ready for
SMS, voice call, and flash-call verification to US destinations; replace `US`
with the actual ISO 3166-1 alpha-2 destinations before creating it.

```bash
curl -X POST https://api.telnyx.com/v2/verify_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App Verification",
    "sms": {
      "app_name": "My App",
      "code_length": 6,
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300
    },
    "call": {
      "app_name": "My App",
      "code_length": 6,
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300
    },
    "flashcall": {
      "app_name": "My App",
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300
    }
  }'
```

Note the `id` in the response — this is your Verify Profile ID.

### Twilio Setup (for comparison)

```javascript
// Twilio: create Verify Service
const service = await client.verify.v2.services.create({
  friendlyName: 'My App Verification'
});
// service.sid = 'VA...'
```

## Sending Verification Codes

### SMS Verification

```python
# Twilio
verification = client.verify.v2 \
    .services('VA...') \
    .verifications \
    .create(to='+15559876543', channel='sms')

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_API_KEY")
verification = client.verifications.trigger_sms(
    phone_number="+15559876543",
    verify_profile_id="YOUR_PROFILE_ID"
)
```

```javascript
// Twilio
const verification = await client.verify.v2
  .services('VA...')
  .verifications
  .create({ to: '+15559876543', channel: 'sms' });

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_API_KEY' });
const verification = await client.verifications.triggerSMS({
  phone_number: '+15559876543',
  verify_profile_id: 'YOUR_PROFILE_ID'
});
```

```bash
# Twilio
curl -X POST "https://verify.twilio.com/v2/Services/$SERVICE_SID/Verifications" \
  -u "$SID:$AUTH_TOKEN" \
  -d "To=+15559876543" -d "Channel=sms"

# Telnyx
curl -X POST https://api.telnyx.com/v2/verifications/sms \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15559876543",
    "verify_profile_id": "YOUR_PROFILE_ID"
  }'
```

```go
// Go — Twilio
import "github.com/twilio/twilio-go"
import verify "github.com/twilio/twilio-go/rest/verify/v2"

client := twilio.NewRestClient()
params := &verify.CreateVerificationParams{}
params.SetTo("+15559876543")
params.SetChannel("sms")
resp, _ := client.VerifyV2.CreateVerification("VA...", params)

// Go — Telnyx (REST API)
// POST https://api.telnyx.com/v2/verifications/sms
// {"phone_number":"+15559876543","verify_profile_id":"..."}
```

```ruby
# Twilio
verification = client.verify.v2
  .services('VA...')
  .verifications
  .create(to: '+15559876543', channel: 'sms')

# Telnyx
client = Telnyx::Client.new(api_key: 'YOUR_API_KEY')
verification = client.verifications.trigger_sms(
  phone_number: '+15559876543',
  verify_profile_id: 'YOUR_PROFILE_ID'
)
```

```java
// Twilio
import com.twilio.rest.verify.v2.service.Verification;

Verification verification = Verification.creator("VA...", "+15559876543", "sms").create();

// Telnyx — use REST API
// POST https://api.telnyx.com/v2/verifications/sms with JSON body
// {"phone_number":"+15559876543","verify_profile_id":"..."}
```

### Voice Call Verification

```python
# Twilio
verification = client.verify.v2 \
    .services('VA...') \
    .verifications \
    .create(to='+15559876543', channel='call')

# Telnyx
verification = client.verifications.trigger_call(
    phone_number="+15559876543",
    verify_profile_id="YOUR_PROFILE_ID"
)
```

### WhatsApp Verification

Twilio's `channel='whatsapp'` maps to Telnyx's WhatsApp-specific endpoint. Configure the profile's `whatsapp` settings (including the WABA, sender phone number, template, and allowed destinations) before triggering it.

For a profile created in the setup step, explicitly approve updating that
named profile, then attach its WhatsApp channel settings:

```bash
curl -X PATCH "https://api.telnyx.com/v2/verify_profiles/$TELNYX_VERIFY_PROFILE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "whatsapp": {
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300,
      "waba_id": "YOUR_WABA_ID",
      "sender_phone_number": "+13035551234",
      "template_id": "YOUR_AUTHENTICATION_TEMPLATE_NAME"
    }
  }'
```

Replace `US`, the WABA ID, sender, and template with the resources approved for
this migration. Do not patch an unrelated or pre-existing profile implicitly.

```bash
# Twilio
curl -X POST "https://verify.twilio.com/v2/Services/$SERVICE_SID/Verifications" \
  -u "$SID:$AUTH_TOKEN" \
  -d "To=+15559876543" -d "Channel=whatsapp"

# Telnyx
curl -X POST https://api.telnyx.com/v2/verifications/whatsapp \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15559876543",
    "verify_profile_id": "YOUR_PROFILE_ID"
  }'
```

### Parameter Mapping

| Twilio | Telnyx | Notes |
|---|---|---|
| `to` | `phone_number` | E.164 format |
| `channel` | endpoint (`/verifications/sms`, `/verifications/call`, `/verifications/flashcall`, `/verifications/whatsapp`) | Channel is chosen by the endpoint, not a body param; the `type` field is response-only |
| Service SID (`VA...`) | `verify_profile_id` | Profile ID from setup |
| `TemplateSid` / service `DefaultTemplateSid` | Profile `sms.messaging_template_id` | Telnyx template selection is profile-scoped, not a trigger parameter |
| `locale` | Not specified | Language determined by phone number region |
| `customCode` | `custom_code` | Use your own code (optional) |

## Checking Verification Codes

```python
# Twilio
check = client.verify.v2 \
    .services('VA...') \
    .verification_checks \
    .create(to='+15559876543', code='123456')
# check.status == 'approved' or 'pending'

# Telnyx
result = client.verifications.by_phone_number.actions.verify(
    phone_number="+15559876543",
    code="123456",
    verify_profile_id="YOUR_PROFILE_ID"
)
# result.response_code == 'accepted' or 'rejected'
```

```javascript
// Twilio
const check = await client.verify.v2
  .services('VA...')
  .verificationChecks
  .create({ to: '+15559876543', code: '123456' });
// check.status === 'approved'

// Telnyx
const result = await client.verifications.byPhoneNumber.actions.verify(
  '+15559876543',
  { code: '123456', verify_profile_id: 'YOUR_PROFILE_ID' }
);
// result.data.response_code === 'accepted'
```

```bash
# Twilio
curl -X POST "https://verify.twilio.com/v2/Services/$SERVICE_SID/VerificationChecks" \
  -u "$SID:$AUTH_TOKEN" \
  -d "To=+15559876543" -d "Code=123456"

# Telnyx
curl -X POST "https://api.telnyx.com/v2/verifications/by_phone_number/+15559876543/actions/verify" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "123456", "verify_profile_id": "YOUR_PROFILE_ID"}'
```

### Status Mapping

The verify **action** (`.../actions/verify`) returns a `response_code` that is only ever `accepted` or `rejected`. This is distinct from a verification's `status` field, whose enum is `pending`, `accepted`, `invalid`, `expired`, `error`.

| Twilio Status | Telnyx verify-action `response_code` | Meaning |
|---|---|---|
| `approved` | `accepted` | Code is correct |
| `pending` | `rejected` | Submitted code is incorrect or expired |
| `canceled` | N/A | No equivalent action response |

Note: a freshly created verification has `status: "pending"` (still awaiting a code). Do not confuse the create-time `status` (`pending`) with the verify-action `response_code` (`rejected`).

## Flash Calling

Telnyx-only feature. Verification via a missed call — the user's phone displays a caller ID, and the last N digits of that number are the verification code. No SMS charges, faster in some markets.

```python
verification = client.verifications.trigger_flashcall(
    phone_number="+15559876543",
    verify_profile_id="YOUR_PROFILE_ID"
)
```

The user sees an incoming call that auto-disconnects. Your app reads the caller ID and extracts the code automatically (or prompts the user to enter it).

**Flash Call Configuration on Verify Profile:**

The current profile-create schema accepts `flashcall`, but the profile-update schema does not. Configure flash calling when creating the profile rather than sending a `flashcall` field to `PATCH /verify_profiles/{id}`:

```bash
curl -X POST https://api.telnyx.com/v2/verify_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App Verification",
    "flashcall": {
      "app_name": "My App",
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300
    }
  }'
```

Replace `US` with the actual ISO 3166-1 alpha-2 destinations before creating
the profile.

**How it works:**
1. Your app calls `POST /v2/verifications/flashcall` with `phone_number` and `verify_profile_id`
2. Telnyx places a call to the user's phone that auto-disconnects after 1 ring
3. The caller ID of that call contains the verification digits
4. Your mobile app detects the incoming call's caller ID and extracts the code automatically
5. Call `POST /v2/verifications/by_phone_number/{phone_number}/actions/verify` with the extracted `code` and `verify_profile_id` to verify

**Benefits over SMS OTP:** No SMS charges, faster delivery, works even with SMS delivery issues, harder to intercept.

## Custom SMS Templates

Both Twilio Verify and Telnyx Verify support custom verification templates, but they select them at different scopes:

- A Twilio verification can pass `TemplateSid`, and a Twilio Verify Service can set `DefaultTemplateSid`.
- Telnyx attaches a template to a Verify Profile through `sms.messaging_template_id`.

Map a Twilio service default template to the equivalent Telnyx profile setting. If the Twilio application selects different `TemplateSid` values per verification, create/select Telnyx Verify Profiles with the corresponding templates; the Telnyx trigger request does not accept a per-request template ID.

Message templates are a **separate resource** managed via `/verify_profiles/templates` — not a parameter you pass when triggering a verification. The trigger call itself (`POST /verifications/sms`) accepts only `custom_code` and `timeout_secs` as optional parameters; there is no `template_id` parameter at trigger time. Create/manage templates first, then trigger the SMS verification normally:

```bash
# Create the template and capture its ID (separate resource)
TEMPLATE_ID=$(curl -sS -X POST https://api.telnyx.com/v2/verify_profiles/templates \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Your {{app_name}} verification code is: {{code}}."}' \
  | jq -er '.data.id')

# Read and preserve the profile's existing SMS settings, then select the new
# template. Replacing the nested `sms` object with only one key can erase other
# channel settings, so merge before PATCHing.
CURRENT_SMS=$(curl -fsS \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/verify_profiles/$TELNYX_VERIFY_PROFILE_ID" \
  | jq -ec '.data.sms // {}')

PATCH_BODY=$(jq -cn \
  --argjson sms "$CURRENT_SMS" \
  --arg template "$TEMPLATE_ID" \
  '{sms: ($sms + {messaging_template_id: $template})}')

curl -X PATCH "https://api.telnyx.com/v2/verify_profiles/$TELNYX_VERIFY_PROFILE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PATCH_BODY"
```

```python
# Trigger SMS verification (optional params: custom_code, timeout_secs)
verification = client.verifications.trigger_sms(
    phone_number="+15559876543",
    verify_profile_id="YOUR_PROFILE_ID"
)
```

## Concept Mapping

| Twilio Concept | Telnyx Concept |
|---|---|
| Verify Service (`VA...`) | Verify Profile |
| Verification SID | Verification ID |
| Channel (`sms`, `call`, `whatsapp`, `email`) | Endpoint path: `POST /v2/verifications/{sms\|call\|flashcall\|whatsapp}` — the channel is chosen by the URL, not a request field (`type` is response-only); Telnyx Verify has no email channel |
| `approved` / `pending` | `accepted` / `rejected` |
| Rate limits (per Service) | Rate limits (per Profile) |
| Fraud Guard | Built-in fraud detection |

## Webhook Differences

Twilio Verify does not use webhooks for the direct VerificationCheck result; the check request returns its result synchronously.

Telnyx Verify likewise returns the direct code-check result synchronously as the verify action's `response_code`. If a webhook URL is configured on the Verify Profile, the currently documented delivery lifecycle notifications use these event names:

- `verify.sent` — the verification request was sent
- `verify.delivered` — the verification reached the destination
- `verify.failed` — delivery failed

Those three events report delivery state; they are not the only possible Verify notification contract. Telnyx also documents real-time completion notifications, but the public receiving-webhooks page does not currently enumerate a stable completion event name and payload alongside the delivery events. Confirm the completion event contract exposed by the target Verify Profile/API version before implementing an event-driven acceptance handler; do not infer acceptance from `verify.delivered`. For a direct code check, determine acceptance from the synchronous verify action's `response_code` (`accepted` or `rejected`).

## Testing

When migrating verify tests, the key change is the response field names.

### Mock Patterns

**Python (pytest/unittest):**
```python
# Twilio mock:
# @patch('twilio.rest.Client')
# def test_verify(mock_client):
#     mock_client.return_value.verify.v2.services('VA...').verification_checks.create.return_value.status = 'approved'

# Telnyx mock (v4 SDK — client.verifications.by_phone_number.actions.verify,
# mirroring POST /verifications/by_phone_number/{phone_number}/actions/verify):
@patch('your_module.client.verifications.by_phone_number.actions.verify')  # patch where client is used
def test_verify_code(mock_submit):
    mock_submit.return_value = type('obj', (object,), {
        'data': type('obj', (object,), {
            'phone_number': '+15559876543',
            'verify_profile_id': 'uuid-here',
            'response_code': 'accepted',  # NOT 'approved'
        })()
    })()
    result = verify_code('+15559876543', '123456')
    assert result.data.response_code == 'accepted'
```

**JavaScript (Jest):**
```javascript
jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    verifications: {
      // mirrors client.verifications.byPhoneNumber.actions.verify(...)
      byPhoneNumber: {
        actions: {
          verify: jest.fn().mockResolvedValue({
            data: {
              phone_number: '+15559876543',
              verify_profile_id: 'uuid-here',
              response_code: 'accepted',
            }
          })
        }
      }
    }
  }));
});
```

### Assertion Changes

| Twilio Assertion | Telnyx Assertion |
|---|---|
| `assert result.status == 'approved'` | `assert result.data.response_code == 'accepted'` |
| `assert result.status == 'pending'` | `assert result.data.status == 'pending'` (on create) |
| `assert result.sid.startswith('VE')` | `assert result.data.verify_profile_id is not None` |
| `assert result.channel == 'sms'` | `assert result.data.type == 'sms'` |
