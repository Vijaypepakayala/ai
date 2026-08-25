# Telnyx Account Setup Guide

Prerequisites and automated API setup for migrating from Twilio to Telnyx.

## What You Must Do Manually (Portal)

These steps **cannot** be automated via API — the user must complete them at [portal.telnyx.com](https://portal.telnyx.com):

1. **Create a Telnyx account** — Sign up at https://telnyx.com/sign-up
2. **Complete any required account-level/KYC verification** — Requirements vary by account, product, and destination; an API key can be created before every product is enabled
3. **Add payment method** — Credit card or ACH required for purchases
4. **Accept Terms of Service** — Must be accepted in the portal
5. **Generate API Key v2** — https://portal.telnyx.com/#/app/api-keys
6. **Note your Public Key** — https://portal.telnyx.com/#/app/account/public-key (for webhook signature validation)

## What Can Be Automated (API)

Once the user has an API key, API-manageable resources can be created based on scan results after the applicable approval gate. `--dry-run` is read-only. A confirmed run may create a dedicated run-owned resource, but it must not change existing routing, assignments, destination allowlists, or push credentials without a separate explicit opt-in that identifies the target resource.

### Messaging Profile (sender-dependent)

```bash
curl -X POST https://api.telnyx.com/v2/messaging_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Migration - Messaging Profile",
    "whitelisted_destinations": ["US"],
    "webhook_url": "https://example.com/webhooks/messaging",
    "webhook_failover_url": "https://example.com/webhooks/messaging-backup"
  }'
```

Replace `US` with every ISO 3166-1 alpha-2 destination the migration will send to. Use `["*"]` only after an explicit decision to allow every destination. Both `name` and `whitelisted_destinations` are required when creating a Messaging Profile. The `messaging_profile_id` send parameter is required for number-pool and alphanumeric-sender requests; a Telnyx phone number or short code can resolve its assigned profile without that body field.

Save the returned `id` as `TELNYX_MESSAGING_PROFILE_ID`.

### Voice Connection (required for voice/TeXML)

**TeXML Application:**
```bash
curl -X POST https://api.telnyx.com/v2/texml_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "Migration - TeXML App",
    "voice_url": "https://example.com/voice",
    "voice_method": "POST",
    "status_callback": "https://example.com/status",
    "status_callback_method": "POST"
  }'
```

**Call Control Application:**
```bash
curl -X POST https://api.telnyx.com/v2/call_control_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "Migration - Call Control App",
    "webhook_event_url": "https://example.com/webhooks/voice",
    "webhook_event_failover_url": "https://example.com/webhooks/voice-backup",
    "webhook_api_version": "2"
  }'
```

### Outbound Voice Profile (required for outbound calls)

```bash
curl -X POST https://api.telnyx.com/v2/outbound_voice_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Migration - Outbound Profile",
    "traffic_type": "conversational",
    "enabled": true,
    "whitelisted_destinations": ["US"]
  }'
```

Replace `US` with every ISO 3166-1 alpha-2 destination the migration will call. If an existing OVP needs an allowlist change, obtain explicit approval first and include its current `name` in `PATCH /v2/outbound_voice_profiles/{id}`; the update schema requires `name`.

Save the returned OVP `id`. Before using it for outbound voice or fax, verify that the profile is `enabled: true` and that `whitelisted_destinations` contains the destination ISO-2 code (or the deliberately approved wildcard `*`).

### Phone Number Purchase (requires user approval — costs money)

```bash
# Search for available numbers
curl -X GET -G --data-urlencode "filter[country_code]=US" \
     --data-urlencode "filter[features][]=sms" \
     --data-urlencode "filter[features][]=voice" \
  "https://api.telnyx.com/v2/available_phone_numbers" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# Purchase (REQUIRES USER APPROVAL before executing)
curl -X POST https://api.telnyx.com/v2/number_orders \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": [{"phone_number": "+15551234567"}],
    "connection_id": "YOUR_CONNECTION_ID",
    "messaging_profile_id": "YOUR_MESSAGING_PROFILE_ID"
  }'
```

### Number Assignment to Connection/Profile

```bash
# Resolve the API resource ID; update endpoints do not use the E.164 number as {id}.
REQUESTED_NUMBER="+15551234567"
if ! PHONE_NUMBER_ID="$(
  curl -fsS -G "https://api.telnyx.com/v2/phone_numbers" \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    --data-urlencode "filter[phone_number]=$REQUESTED_NUMBER" \
    --data-urlencode "page[size]=1" |
    jq -er --arg number "$REQUESTED_NUMBER" \
      '[.data[] | select(.phone_number == $number)] | .[0].id'
)"; then
  echo "Exact phone number not found" >&2
  exit 1
fi

# Assign number to voice connection
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/$PHONE_NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "YOUR_CONNECTION_ID"}'

# Assign number to messaging profile
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/$PHONE_NUMBER_ID/messaging" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messaging_profile_id": "YOUR_MESSAGING_PROFILE_ID"}'
```

### Verify Profile (required for verify/2FA)

```bash
curl -X POST https://api.telnyx.com/v2/verify_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Migration - Verify Profile",
    "sms": {
      "whitelisted_destinations": ["US"],
      "default_verification_timeout_secs": 300,
      "code_length": 6
    }
  }'
```

Replace `US` with every ISO 3166-1 alpha-2 destination that will receive SMS verifications. The current Verify Profile API nests channel settings under `sms`; `messaging_enabled` and a top-level `default_timeout_secs` are not fields in the create schema.

### Fax Application (required for fax)

Outbound fax requires all three relationships to agree: an active Fax Application, an enabled OVP attached at `outbound.outbound_voice_profile_id`, and the exact sender phone number assigned to that Fax Application through the phone number's `connection_id`. Creating the application alone is not sufficient.

```bash
# Create the Fax Application with the active, destination-authorized OVP from above.
curl -X POST https://api.telnyx.com/v2/fax_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "Migration - Fax App",
    "webhook_event_url": "https://example.com/webhooks/fax",
    "active": true,
    "outbound": {
      "outbound_voice_profile_id": "YOUR_OUTBOUND_VOICE_PROFILE_ID"
    }
  }'

# Resolve the exact owned sender number to its resource ID.
FAX_FROM_NUMBER="+15551234567"
FAX_PHONE_NUMBER_ID="$(
  curl -fsS -G "https://api.telnyx.com/v2/phone_numbers" \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    --data-urlencode "filter[phone_number]=$FAX_FROM_NUMBER" \
    --data-urlencode "page[size]=1" |
    jq -er --arg number "$FAX_FROM_NUMBER" \
      '[.data[] | select(.phone_number == $number and .status == "active")] | .[0].id'
)"

# This changes live routing. Run only after approval naming this exact number and Fax Application.
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/$FAX_PHONE_NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "YOUR_FAX_APPLICATION_ID"}'
```

The owned-number response does not include the available-inventory `features` array. Fax readiness is established by the exact active-number assignment and the Fax Application/OVP checks below.

Before a dry run or send, retrieve the number, Fax Application, and OVP and verify the exact chain: number `connection_id` equals the intended Fax Application ID; the application is active; `outbound.outbound_voice_profile_id` equals the intended OVP ID; and that OVP is enabled and allows the destination's ISO-2 code. `scripts/test-migration/test-fax.sh` enforces this chain and refuses a mismatched `TELNYX_CONNECTION_ID`.

### 10DLC Registration (required for US A2P messaging)

10DLC registration can be completed through the Mission Control Portal or API. Treat brand and campaign submission as production compliance actions, not smoke-test setup:

1. **Prepare the compliance record** — collect the legal business identity, use case, opt-in/message flow, sample messages, help/stop behavior, privacy policy, terms, and any required reseller or age-gating details. Do not invent these fields.
2. **Quote and approve brand registration** — check current authoritative pricing and obtain explicit approval for the current non-refundable brand-registration charge. Then submit the brand with `POST /v2/10dlc/brand`. Brand creation is billable even if verification later fails; validate the legal name/EIN and other identity fields before submission.
3. **Wait for a usable brand status** — retrieve the brand and resolve any verification or vetting failures before building a campaign. External vetting may be a separate billable action and requires its own current quote and approval.
4. **Qualify before submission** — call the read-only `GET /v2/10dlc/campaignBuilder/brand/{brandId}/usecase/{usecase}` endpoint. Do not submit if the brand is not qualified. Use the returned fee fields together with current pricing to present the campaign charge and obtain explicit approval.
5. **Submit exactly once** — after approval, submit the complete campaign with `POST /v2/10dlc/campaignBuilder`. Campaign creation incurs an upfront, non-refundable charge covering the first three months, based on use case. Most campaign fields become immutable after creation, so re-check consent text, sample messages, links, and use case before submitting; a failed or duplicate submission can still create cost or compliance work.
6. **Wait for carrier/Telnyx acceptance, then assign numbers** — do not send A2P traffic or attach numbers while the campaign is pending or failed. After approval, ensure each long-code number is already on the intended Messaging Profile, assign it through the current Phone Number Campaigns API, and verify the assignment status before sending.

The `--confirm` gates used by integration-test scripts do not authorize either 10DLC brand creation or campaign submission. Record the exact user-approved action, current amount/currency, brand/use case, and maximum charge before each billable registration call.

> See `{baseDir}/sdk-reference/{lang}/10dlc.md` for complete API examples.

### Webhook Configuration

After creating resources, configure webhook URLs to point to your application server. If migrating incrementally, you can use the same URLs as your Twilio webhooks (the handler code will be updated in Phase 4).

## Approval Gates

The agent MUST get user approval before:

- **Purchasing phone numbers** — costs money
- **Creating 10DLC campaigns** — costs money and involves compliance
- **Creating 10DLC brands or requesting external vetting** — costs may be non-refundable even if verification fails
- **Porting numbers from Twilio** — irreversible once completed
- **Setting up production webhook URLs** — affects live traffic
- **Expanding an existing Messaging Profile, OVP, or Verify Profile destination allowlist** — changes live send/call permissions
- **Reassigning a phone number to another Messaging Profile or voice connection** — changes live routing
- **Attaching or replacing an OVP or mobile push credential on an existing connection** — changes live call or push behavior

## What's Needed Per Product

| Detected Product | Resources to Create |
|---|---|
| messaging | Messaging Profile for number-pool/alphanumeric sends or number routing; sender phone number(s)/short code as applicable |
| voice / texml | TeXML App OR Call Control App, Outbound Voice Profile, phone number(s) |
| verify | Verify Profile |
| fax | Active Fax Application, active destination-authorized Outbound Voice Profile, fax-capable phone number(s) assigned to that application |
| sip / sip-integrations | SIP Connection (IP/Credential/FQDN), Outbound Voice Profile |
| webrtc | Credential Connection and Telephony Credential(s); for native mobile push, platform Mobile Push Credential(s) attached to the connection |
| iot | SIM Card Group(s) |
| 10dlc | Brand registration, campaign(s) |

## New Account (No Numbers or Resources)

For a brand new Telnyx account with no phone numbers:

1. Provide the destination's ISO 3166-1 alpha-2 code as `TELNYX_TO_COUNTRY`. If it is unavailable, the user can separately opt into a billed Telnyx Number Lookup with `TELNYX_ALLOW_COUNTRY_LOOKUP=yes`; scripts do not guess from ambiguous calling-code prefixes or perform a paid lookup implicitly.
2. Test scripts may show a current inventory quote but never purchase a persistent phone number. Complete purchase as a separate approval workflow after re-querying the authoritative upfront and recurring cost.
3. A confirmed run may create dedicated run-owned profiles or connections. Assigning an already-owned number still follows the existing-resource consent policy.

`TELNYX_API_KEY` and `TELNYX_TO_NUMBER` are common inputs, not a guarantee that every account can run end-to-end immediately. Account level, payment, inventory, destination approval, 10DLC/toll-free registration, and country-specific regulatory requirements may require additional setup.

## Existing Telnyx Users

If the user already has a Telnyx account, the preflight check (`scripts/preflight-check.sh`) and test scripts can discover:

- Existing Messaging Profiles
- Existing voice connections
- Existing phone numbers and their current assignments
- Account balance

Discovery does not authorize mutation. Reuse an existing resource only after identifying it and confirming it already matches the migration. If a change would affect live routing, a destination allowlist, a profile or OVP assignment, or push credentials, fail with remediation or require an explicit opt-in that identifies the exact resource.
