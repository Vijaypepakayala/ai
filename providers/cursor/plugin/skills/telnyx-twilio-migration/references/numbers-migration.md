# Phone Numbers Migration: Twilio to Telnyx

Migrate phone number management from Twilio to Telnyx Number Management API.

## Table of Contents

- [Overview](#overview)
- [Searching Available Numbers](#searching-available-numbers)
- [Purchasing Numbers](#purchasing-numbers)
- [Listing Owned Numbers](#listing-owned-numbers)
- [Configuring Numbers](#configuring-numbers)
- [Releasing Numbers](#releasing-numbers)
- [Concept Mapping](#concept-mapping)

## Overview

Key differences:
- Telnyx uses **Number Orders** for purchasing (async) vs Twilio's immediate `IncomingPhoneNumbers.create()`
- Voice numbers use a **Connection**. Messaging configuration is sender-dependent: an owned number/short code can resolve its assigned profile, while number-pool and alphanumeric-sender requests must provide `messaging_profile_id`
- Telnyx is a licensed carrier with direct number inventory in 140+ countries
- Voice/number fields such as `connection_id` use the base phone-number resource, while messaging assignment uses the dedicated `/phone_numbers/{id}/messaging` endpoint

## Searching Available Numbers

```python
# Twilio
numbers = client.available_phone_numbers('US') \
    .local.list(area_code='312', limit=5)

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_API_KEY")
numbers = client.available_phone_numbers.list(
    filter={"country_code": "US", "national_destination_code": "312", "limit": 5}
)
```

```javascript
// Twilio
const numbers = await client.availablePhoneNumbers('US')
  .local.list({ areaCode: '312', limit: 5 });

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_API_KEY' });
const numbers = await client.availablePhoneNumbers.list({
  filter: { country_code: 'US', national_destination_code: '312', limit: 5 }
});
```

```bash
# Twilio
curl "https://api.twilio.com/2010-04-01/Accounts/$SID/AvailablePhoneNumbers/US/Local.json?AreaCode=312&PageSize=5" \
  -u "$SID:$AUTH_TOKEN"

# Telnyx
curl -H "Authorization: Bearer $TELNYX_API_KEY" \
  -G --data-urlencode "filter[country_code]=US" \
     --data-urlencode "filter[national_destination_code]=312" \
     --data-urlencode "filter[limit]=5" \
  "https://api.telnyx.com/v2/available_phone_numbers"
```

### Search Parameter Mapping

| Twilio | Telnyx | Notes |
|---|---|---|
| Country code (path) | `filter[country_code]` | ISO 3166-1 alpha-2 |
| `AreaCode` | `filter[national_destination_code]` | Area code / NDC |
| `Contains` | `filter[phone_number][contains]` | Pattern matching |
| `SmsEnabled` | `filter[features]` includes `sms` | Feature filter |
| `VoiceEnabled` | `filter[features]` includes `voice` | Feature filter |
| `InLocality` | `filter[locality]` | City name |
| `InRegion` | `filter[administrative_area]` | State/province |
| `PageSize` | `filter[limit]` | Results per page |

## Purchasing Numbers

Twilio purchases immediately. Telnyx uses a **Number Order** (async, usually completes in seconds).

```python
import os
import re
from decimal import Decimal, InvalidOperation

target_number = "+13125551234"
if re.fullmatch(r"\+[1-9]\d{7,14}", target_number) is None:
    raise RuntimeError("Purchase target must be an E.164 phone number")

# Twilio — immediate. Approve this provider's purchase independently.
if os.environ.get("TWILIO_APPROVE_NUMBER_PURCHASE") != target_number:
    raise RuntimeError("Twilio number purchase not approved")
number = client.incoming_phone_numbers.create(phone_number=target_number)

# Telnyx — order-based. This has a separate, price-bound approval below.
inventory = client.available_phone_numbers.list(
    filter={
        "phone_number": {"contains": target_number.removeprefix("+")},
        "limit": 100,
    }
)
exact_matches = [
    candidate for candidate in inventory.data
    if candidate.phone_number == target_number
]
if len(exact_matches) != 1:
    raise RuntimeError("Expected exactly one current inventory match")

cost = exact_matches[0].cost_information
try:
    upfront_cost = Decimal(cost.upfront_cost)
    monthly_cost = Decimal(cost.monthly_cost)
    if (
        not upfront_cost.is_finite()
        or not monthly_cost.is_finite()
        or upfront_cost < 0
        or monthly_cost < 0
    ):
        raise ValueError
except (InvalidOperation, TypeError, ValueError):
    raise RuntimeError("Inventory response contained an invalid cost")
if re.fullmatch(r"[A-Z]{3}", cost.currency or "") is None:
    raise RuntimeError("Inventory response contained an invalid currency")
quote = (
    f"{target_number}|{cost.upfront_cost}|"
    f"{cost.monthly_cost}|{cost.currency}"
)
print(
    f"Order quote: {target_number}; upfront {cost.upfront_cost} "
    f"{cost.currency}; monthly {cost.monthly_cost} {cost.currency}"
)
# Approve the exact E.164 number and the current upfront, monthly, and currency tuple.
if os.environ.get("TELNYX_APPROVE_NUMBER_ORDER") != quote:
    raise RuntimeError("Number order not approved")
order = client.number_orders.create(
    phone_numbers=[{"phone_number": target_number}]
)
if order.data is None:
    raise RuntimeError("Number order response did not include data")
print(order.data.id, order.data.status)
```

```javascript
const targetNumber = '+13125551234';
if (!/^\+[1-9][0-9]{7,14}$/.test(targetNumber)) {
  throw new Error('Purchase target must be an E.164 phone number');
}

// Twilio — approve this provider's purchase independently.
if (process.env.TWILIO_APPROVE_NUMBER_PURCHASE !== targetNumber) {
  throw new Error('Twilio number purchase not approved');
}
const number = await client.incomingPhoneNumbers.create({
  phoneNumber: targetNumber
});

// Telnyx — this has a separate, price-bound approval below.
const inventory = await client.availablePhoneNumbers.list({
  filter: {
    phone_number: { contains: targetNumber.replace(/^\+/, '') },
    limit: 100
  }
});
const exactMatches = inventory.data.filter(
  (candidate) => candidate.phoneNumber === targetNumber
);
if (exactMatches.length !== 1) {
  throw new Error('Expected exactly one current inventory match');
}
const cost = exactMatches[0].costInformation;
if (
  typeof cost.upfrontCost !== 'string' ||
  typeof cost.monthlyCost !== 'string' ||
  !/^[0-9]+(?:\.[0-9]+)?$/.test(cost.upfrontCost) ||
  !/^[0-9]+(?:\.[0-9]+)?$/.test(cost.monthlyCost) ||
  !/^[A-Z]{3}$/.test(cost.currency || '') ||
  !Number.isFinite(Number(cost.upfrontCost)) ||
  !Number.isFinite(Number(cost.monthlyCost)) ||
  Number(cost.upfrontCost) < 0 ||
  Number(cost.monthlyCost) < 0
) {
  throw new Error('Inventory response contained an invalid cost');
}
const quote = [
  targetNumber,
  cost.upfrontCost,
  cost.monthlyCost,
  cost.currency
].join('|');
console.log(
  `Order quote: ${targetNumber}; upfront ${cost.upfrontCost} ${cost.currency}; ` +
  `monthly ${cost.monthlyCost} ${cost.currency}`
);
// Approve the exact E.164 number and the current upfront, monthly, and currency tuple.
if (process.env.TELNYX_APPROVE_NUMBER_ORDER !== quote) {
  throw new Error('Number order not approved');
}
const order = await client.numberOrders.create({
  phone_numbers: [{ phone_number: targetNumber }]
});
```

```bash
TARGET_NUMBER="+13125551234"
[[ "$TARGET_NUMBER" =~ ^\+[1-9][0-9]{7,14}$ ]] || {
  echo "Target number must be a valid E.164 value" >&2; exit 1;
}

# Twilio — approve this provider's purchase independently.
test "${TWILIO_APPROVE_NUMBER_PURCHASE:-}" = "$TARGET_NUMBER" || {
  echo "Twilio number purchase not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json" \
  -u "$SID:$AUTH_TOKEN" \
  --data-urlencode "PhoneNumber=$TARGET_NUMBER"

# Telnyx — this has a separate, price-bound approval below.
INVENTORY=$(curl -fsS -G \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "filter[phone_number][contains]=${TARGET_NUMBER#+}" \
  --data-urlencode "filter[limit]=100" \
  "https://api.telnyx.com/v2/available_phone_numbers")
COST=$(printf '%s' "$INVENTORY" | jq -ce --arg number "$TARGET_NUMBER" '
  [.data[]? | select(.phone_number == $number)] as $matches
  | if ($matches | length) == 1
    then $matches[0].cost_information
    else error("expected exactly one current inventory match")
    end
  | select(
      (.upfront_cost | type) == "string" and
      (.upfront_cost | test("^[0-9]+([.][0-9]+)?$")) and
      (.monthly_cost | type) == "string" and
      (.monthly_cost | test("^[0-9]+([.][0-9]+)?$")) and
      (.currency | type) == "string" and
      (.currency | test("^[A-Z]{3}$"))
    )
') || { echo "Number inventory quote was incomplete or invalid" >&2; exit 1; }
UPFRONT_COST=$(printf '%s' "$COST" | jq -r '.upfront_cost')
MONTHLY_COST=$(printf '%s' "$COST" | jq -r '.monthly_cost')
CURRENCY=$(printf '%s' "$COST" | jq -r '.currency')
APPROVAL_TOKEN="$TARGET_NUMBER|$UPFRONT_COST|$MONTHLY_COST|$CURRENCY"
printf 'Order quote: %s; upfront %s %s; monthly %s %s\n' \
  "$TARGET_NUMBER" "$UPFRONT_COST" "$CURRENCY" "$MONTHLY_COST" "$CURRENCY"
# Approve the exact E.164 number and the displayed cost tuple.
test "${TELNYX_APPROVE_NUMBER_ORDER:-}" = "$APPROVAL_TOKEN" || {
  echo "Number order not approved" >&2; exit 1;
}
ORDER_PAYLOAD=$(jq -cn \
  --arg phone_number "$TARGET_NUMBER" \
  '{phone_numbers: [{phone_number: $phone_number}]}')
curl -fsS -X POST "https://api.telnyx.com/v2/number_orders" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$ORDER_PAYLOAD"
```

After the order completes, assign the purchased number to the intended voice Connection and/or Messaging Profile as a separate, explicitly reviewed configuration change.

The Number Orders request contains the approved number but no quote ID or maximum-charge field. The gate above therefore protects the local execution path by re-querying immediately and requiring the displayed cost tuple; it does not lock the server-side price. If a possible price change between inventory lookup and order creation is unacceptable, complete the purchase in the Mission Control Portal instead.

## Listing Owned Numbers

```python
# Twilio
numbers = client.incoming_phone_numbers.list()

# Telnyx
numbers = client.phone_numbers.list()
```

```javascript
// Twilio
const numbers = await client.incomingPhoneNumbers.list();

// Telnyx
const numbers = await client.phoneNumbers.list();
```

```bash
# Twilio
curl "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json" \
  -u "$SID:$AUTH_TOKEN"

# Telnyx
curl -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/phone_numbers"
```

## Configuring Numbers

On Twilio, you set webhook URLs directly on the number. On Telnyx, you assign numbers to **Connections** (voice) and **Messaging Profiles** (messaging) which hold the webhook configuration.

Two things to note for Telnyx:
- `PATCH`/`DELETE /phone_numbers/{id}` operate on the **internal numeric number ID**, not the E.164 number. Look up the ID first with `GET /phone_numbers?filter[phone_number]=...`.
- `messaging_profile_id` is **not** accepted on the base `PATCH /phone_numbers/{id}` endpoint (which handles `connection_id` and other voice/number fields). Messaging assignment is a separate endpoint: `PATCH /phone_numbers/{id}/messaging`.

```python
import os

# Twilio — set webhooks on number
client.incoming_phone_numbers('PN...').update(
    voice_url='https://example.com/voice',
    sms_url='https://example.com/sms'
)

# Telnyx — resolve one exact number, inspect current routing, then require an
# approval token bound to this exact transition before either PATCH.
requested_number = "+13125551234"
matches = client.phone_numbers.list(filter={"phone_number": requested_number})
exact = [item for item in matches.data if item.phone_number == requested_number]
if len(exact) != 1:
    raise RuntimeError("Expected exactly one matching Telnyx phone number")
number_id = exact[0].id
current_number = client.phone_numbers.retrieve(number_id)
current_messaging = client.phone_numbers.messaging.retrieve(number_id)
current_connection_id = current_number.data.connection_id or "unassigned"
current_profile_id = current_messaging.data.messaging_profile_id or "unassigned"
new_connection_id = "YOUR_CONNECTION_ID"
new_profile_id = "YOUR_PROFILE_ID"
approval = (
    f"{number_id}|{requested_number}|"
    f"voice:{current_connection_id}->{new_connection_id}|"
    f"messaging:{current_profile_id}->{new_profile_id}"
)
print(f"Assignment approval token: {approval}")
if os.environ.get("TELNYX_APPROVE_NUMBER_ASSIGNMENT") != approval:
    raise RuntimeError("Number rerouting not approved")

# connection_id (and other base fields) go on the phone number itself
client.phone_numbers.update(
    number_id,
    connection_id=new_connection_id
)

# messaging_profile_id is assigned via the separate messaging sub-resource
client.phone_numbers.messaging.update(
    number_id,
    messaging_profile_id=new_profile_id
)
# Webhooks are configured on the Connection and Messaging Profile, not on the number
```

```bash
# Twilio
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers/PN123.json" \
  -u "$SID:$AUTH_TOKEN" \
  -d "VoiceUrl=https://example.com/voice" -d "SmsUrl=https://example.com/sms"

# Telnyx — look up one exact number (PATCH uses the ID, not the E.164 number).
REQUESTED_NUMBER="+13125551234"
NUMBER_ID=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  -G --data-urlencode "filter[phone_number]=$REQUESTED_NUMBER" \
  "https://api.telnyx.com/v2/phone_numbers" \
  | jq -er --arg number "$REQUESTED_NUMBER" \
    '[.data[] | select(.phone_number == $number)] | select(length == 1) | .[0].id') || exit 1

# Inspect both current assignments and bind approval to the exact transition.
CURRENT_NUMBER=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID") || exit 1
CURRENT_MESSAGING=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID/messaging") || exit 1
CURRENT_CONNECTION_ID=$(jq -er '.data.connection_id // "unassigned"' \
  <<<"$CURRENT_NUMBER") || exit 1
CURRENT_PROFILE_ID=$(jq -er '.data.messaging_profile_id // "unassigned"' \
  <<<"$CURRENT_MESSAGING") || exit 1
CURRENT_CONNECTION_JSON=$(jq -c '.data.connection_id // null' \
  <<<"$CURRENT_NUMBER") || exit 1
NEW_CONNECTION_ID="YOUR_CONNECTION_ID"
NEW_PROFILE_ID="YOUR_PROFILE_ID"
# Preflight both target resources before changing either live assignment.
curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/connections/$NEW_CONNECTION_ID" \
  | jq -e --arg id "$NEW_CONNECTION_ID" '.data.id == $id' >/dev/null || exit 1
curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/messaging_profiles/$NEW_PROFILE_ID" \
  | jq -e --arg id "$NEW_PROFILE_ID" '.data.id == $id' >/dev/null || exit 1
ASSIGNMENT_APPROVAL="$NUMBER_ID|$REQUESTED_NUMBER|voice:$CURRENT_CONNECTION_ID->$NEW_CONNECTION_ID|messaging:$CURRENT_PROFILE_ID->$NEW_PROFILE_ID"
printf 'Assignment approval token: %s\n' "$ASSIGNMENT_APPROVAL"
test "${TELNYX_APPROVE_NUMBER_ASSIGNMENT:-}" = "$ASSIGNMENT_APPROVAL" || {
  echo "Number rerouting not approved" >&2; exit 1;
}

# Assign the voice connection on the phone number itself
curl -fsS -X PATCH "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn --arg id "$NEW_CONNECTION_ID" '{connection_id: $id}')" || exit 1

# Assign the messaging profile via the separate messaging endpoint. If it
# fails, restore the reviewed voice baseline before returning failure so the
# live number is not knowingly left half-rerouted.
if ! curl -fsS -X PATCH "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID/messaging" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn --arg id "$NEW_PROFILE_ID" '{messaging_profile_id: $id}')"; then
  echo "Messaging assignment failed; restoring previous voice assignment" >&2
  curl -fsS -X PATCH "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID" \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    -H "Content-Type: application/json" \
    --data "$(jq -cn --argjson id "$CURRENT_CONNECTION_JSON" '{connection_id: $id}')" || {
      echo "CRITICAL: voice rollback failed; inspect the number immediately" >&2;
    }
  exit 1
fi

# Verify the active state; an HTTP success alone is not proof that both routing
# assignments took effect.
FINAL_NUMBER=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID") || exit 1
FINAL_MESSAGING=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID/messaging") || exit 1
jq -e --arg id "$NEW_CONNECTION_ID" '.data.connection_id == $id' \
  <<<"$FINAL_NUMBER" >/dev/null || exit 1
jq -e --arg id "$NEW_PROFILE_ID" '.data.messaging_profile_id == $id' \
  <<<"$FINAL_MESSAGING" >/dev/null || exit 1
```

### Configuration Mapping

| Twilio Number Property | Telnyx Equivalent | Notes |
|---|---|---|
| `voice_url` | Set on Connection | Webhook URL on the voice connection |
| `sms_url` | Set on Messaging Profile | Webhook URL on the messaging profile |
| `voice_fallback_url` | Set on Connection | Failover URL |
| `status_callback` | Set on Connection | Call status events |
| `voice_method` | Always POST | Telnyx always uses POST |
| `friendly_name` | `tags` | Labels for organization |
| `trunk_sid` | `connection_id` | SIP trunk / voice connection |

## Releasing Numbers

```python
import os
import re

# Twilio — approve this provider's irreversible release independently.
twilio_number_sid = os.environ.get("TWILIO_NUMBER_SID", "")
if re.fullmatch(r"PN[0-9a-fA-F]{32}", twilio_number_sid) is None:
    raise RuntimeError("TWILIO_NUMBER_SID must be a complete Twilio number SID")
if os.environ.get("TWILIO_CONFIRM_RELEASE_NUMBER") != twilio_number_sid:
    raise RuntimeError("Twilio phone-number release not approved")
client.incoming_phone_numbers(twilio_number_sid).delete()

# Telnyx — delete by internal number ID after a separate exact E.164 approval.
target_number = "+13125551234"
if re.fullmatch(r"\+[1-9]\d{7,14}", target_number) is None:
    raise RuntimeError("Release target must be an E.164 phone number")
response = client.phone_numbers.list(
    filter={"phone_number": target_number.removeprefix("+")}
)
exact_matches = [
    number for number in (response.data or [])
    if number.phone_number == target_number
]
if len(exact_matches) != 1:
    raise RuntimeError(
        f"Expected exactly one owned number matching {target_number}; found {len(exact_matches)}"
    )
number_id = exact_matches[0].id
if not isinstance(number_id, str) or not number_id.strip():
    raise RuntimeError("Matched phone number did not include a nonempty id")

# Set this to the exact E.164 number only after approving its irreversible release.
if os.environ.get("TELNYX_CONFIRM_RELEASE_NUMBER") != target_number:
    raise RuntimeError("Phone-number release not approved")
client.phone_numbers.delete(number_id)
```

```bash
# Twilio — approve this provider's irreversible release independently.
TWILIO_NUMBER_SID="${TWILIO_NUMBER_SID:-}"
[[ "$TWILIO_NUMBER_SID" =~ ^PN[0-9a-fA-F]{32}$ ]] || {
  echo "TWILIO_NUMBER_SID must be a complete Twilio number SID" >&2; exit 1;
}
test "${TWILIO_CONFIRM_RELEASE_NUMBER:-}" = "$TWILIO_NUMBER_SID" || {
  echo "Twilio phone-number release not approved" >&2; exit 1;
}
curl -fsS -X DELETE "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers/$TWILIO_NUMBER_SID.json" \
  -u "$SID:$AUTH_TOKEN"

# Telnyx — look up one exact E.164 match, then require a separate approval.
TARGET_NUMBER="+13125551234"
[[ "$TARGET_NUMBER" =~ ^\+[1-9][0-9]{7,14}$ ]] || {
  echo "Release target must be an E.164 phone number" >&2; exit 1;
}
FILTER_NUMBER="${TARGET_NUMBER#+}"
LOOKUP_RESPONSE=$(curl -fsS -H "Authorization: Bearer $TELNYX_API_KEY" \
  -G --data-urlencode "filter[phone_number]=$FILTER_NUMBER" \
  "https://api.telnyx.com/v2/phone_numbers") || exit 1
MATCH_COUNT=$(jq -er --arg target "$TARGET_NUMBER" \
  '[.data[]? | select(.phone_number == $target)] | length' \
  <<<"$LOOKUP_RESPONSE") || exit 1
test "$MATCH_COUNT" -eq 1 || {
  echo "Expected exactly one owned number matching $TARGET_NUMBER; found $MATCH_COUNT" >&2
  exit 1
}
NUMBER_ID=$(jq -er --arg target "$TARGET_NUMBER" \
  '[.data[]? | select(.phone_number == $target)][0].id | select(type == "string" and test("\\S"))' \
  <<<"$LOOKUP_RESPONSE") || { echo "Matched phone number did not include a nonempty id" >&2; exit 1; }

# Set this to the exact E.164 number only after approving its irreversible release.
test "${TELNYX_CONFIRM_RELEASE_NUMBER:-}" = "$TARGET_NUMBER" || {
  echo "Phone-number release not approved" >&2; exit 1;
}
curl -fsS -X DELETE "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Concept Mapping

| Twilio Concept | Telnyx Concept |
|---|---|
| IncomingPhoneNumbers | Phone Numbers API (`/v2/phone_numbers`) |
| AvailablePhoneNumbers | Available Phone Numbers (`/v2/available_phone_numbers`) |
| Number SID (`PN...`) | Phone number in E.164 (or number ID) |
| `IncomingPhoneNumbers.create()` | Number Orders (`/v2/number_orders`) — async |
| Voice URL (on number) | Connection webhook URL |
| SMS URL (on number) | Messaging Profile webhook URL |
| Address SID (for compliance) | Regulatory Requirements + Number Bundles |
| Number Add-ons | Not applicable — use Number Lookup API separately |
