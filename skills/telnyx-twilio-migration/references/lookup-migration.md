# Number Lookup Migration: Twilio Lookup v2 to Telnyx Number Lookup

Migrate from Twilio Lookup v2 to the Telnyx Number Lookup API for carrier, line type, and caller name (CNAM) lookups.

## Table of Contents

- [Overview](#overview)
- [Key Differences](#key-differences)
- [Concept Mapping](#concept-mapping)
- [Step 1: Basic Number Lookup](#step-1-basic-number-lookup)
- [Step 2: Carrier Lookup](#step-2-carrier-lookup)
- [Step 3: Caller Name (CNAM) Lookup](#step-3-caller-name-cnam-lookup)
- [Response Field Mapping](#response-field-mapping)
- [API Endpoint Mapping](#api-endpoint-mapping)
- [Common Pitfalls](#common-pitfalls)

## Overview

Telnyx Number Lookup provides carrier identification, line type detection, caller name (CNAM), and portability information for phone numbers. It is a direct replacement for Twilio Lookup v2, which provides similar carrier and caller-name lookups.

The Telnyx Number Lookup API uses one endpoint. A plain `GET /v2/number_lookup/{phone_number}` with **no** query parameters returns these top-level keys:

`caller_name`, `carrier`, `country_code`, `fraud`, `national_format`, `nnid_override`, `phone_number`, `portability`, `record_type`, `valid_number`

The keys are always present, but **`carrier` and `caller_name` are `null` unless explicitly requested** via the `type` query parameter. `portability` **is** fully populated by default.

| Request | `carrier` | `caller_name` | `portability` |
|---|---|---|---|
| `GET /v2/number_lookup/{number}` | `null` | `null` | populated |
| `GET /v2/number_lookup/{number}?type=carrier` | populated | `null` | populated |
| `GET /v2/number_lookup/{number}?type=caller-name` | `null` | populated | populated |
| Carrier request followed by caller-name request | populated across the two responses | populated across the two responses | populated in each response |


## Key Differences

1. **Single endpoint model** — Telnyx uses one `GET` endpoint whose optional `type` parameter accepts one value (`carrier` or `caller-name`) per documented request. Use separate requests when both enrichments are needed. Twilio Lookup v2 uses a similar model with `Fields` parameter.
2. **Portability data included** — Telnyx returns detailed portability information (LRN, ported status, ported date, OCN, SPID) alongside carrier data. Twilio requires separate Porting API access.
3. **Authentication** — Twilio uses Basic Auth (SID:Token). Telnyx uses Bearer Token.
4. **Response structure** — Telnyx nests data under `carrier`, `caller_name`, and `portability` objects. `carrier` and `caller_name` are `null` unless requested via `?type=`; `portability` is always populated. Twilio Lookup v2 nests under `line_type_intelligence`, `caller_name`, etc.
5. **Pricing model** — Both charge per-lookup. Telnyx pricing varies by lookup type requested.

## Concept Mapping

| Twilio Lookup Concept | Telnyx Equivalent | Notes |
|---|---|---|
| Lookup v2 `Fields=line_type_intelligence` | `?type=carrier` query param | Carrier and line type info |
| Lookup v2 `Fields=caller_name` | `?type=caller-name` query param | CNAM data |
| `line_type_intelligence.type` | `portability.line_type` | Line type (mobile, landline, voip) |
| `line_type_intelligence.carrier_name` | `carrier.name` | Carrier name |
| `line_type_intelligence.mobile_country_code` | `carrier.mobile_country_code` | MCC |
| `line_type_intelligence.mobile_network_code` | `carrier.mobile_network_code` | MNC |
| `caller_name.caller_name` | `caller_name.caller_name` | CNAM value |
| `caller_name.caller_type` | N/A | Telnyx does not return caller type |
| Phone Number SID | N/A | Telnyx returns data directly, no SID |
| `valid` field | `valid_number` | Top-level, returned by default |

## Step 1: Basic Number Lookup

A basic lookup without type parameters returns phone number formatting, country information, validity, fraud, and the fully populated `portability` object. `carrier` and `caller_name` come back as `null` — request them with `?type=` (see Steps 2 and 3).

### curl

```bash
# Twilio Lookup v2
curl -X GET "https://lookups.twilio.com/v2/PhoneNumbers/+15551234567" \
  -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN"

# Telnyx
curl -X GET "https://api.telnyx.com/v2/number_lookup/+15551234567" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Python

```python
# Twilio
from twilio.rest import Client
client = Client(account_sid, auth_token)
result = client.lookups.v2.phone_numbers("+15551234567").fetch()
print(result.valid)

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

result = client.number_lookup.retrieve(phone_number="+15551234567")
if result.data is None:
    raise RuntimeError("Number Lookup response did not include data")
print(result.data.country_code)
print(result.data.national_format)
print(result.data.phone_number)
```

### JavaScript

```javascript
// Twilio
const twilio = require('twilio');
const client = twilio(accountSid, authToken);
const result = await client.lookups.v2.phoneNumbers('+15551234567').fetch();
console.log(result.valid);

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });

const result = await client.numberLookup.retrieve('+15551234567');
console.log(result.data.country_code);
console.log(result.data.national_format);
console.log(result.data.phone_number);
```

## Step 2: Carrier Lookup

Carrier lookup returns the carrier name, type, MCC, MNC, and line type information.

### curl

```bash
# Twilio Lookup v2
curl -X GET "https://lookups.twilio.com/v2/PhoneNumbers/+15551234567?Fields=line_type_intelligence" \
  -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN"

# Telnyx
curl -X GET "https://api.telnyx.com/v2/number_lookup/+15551234567?type=carrier" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Python

```python
# Twilio
result = client.lookups.v2.phone_numbers("+15551234567").fetch(
    fields=["line_type_intelligence"]
)
print(result.line_type_intelligence["carrier_name"])
print(result.line_type_intelligence["type"])  # "mobile", "landline", "voip", etc.

# Telnyx
result = client.number_lookup.retrieve(phone_number="+15551234567", type="carrier")
if result.data is None or result.data.carrier is None:
    raise RuntimeError("Carrier lookup response did not include carrier data")
print(result.data.carrier.name)           # e.g., "AT&T"
print(result.data.carrier.type)           # e.g., "voip", "mobile"
print(result.data.portability.line_type)  # e.g., "mobile", "fixed line", "voip"
```

### JavaScript

```javascript
// Twilio
const result = await client.lookups.v2.phoneNumbers('+15551234567')
  .fetch({ fields: ['line_type_intelligence'] });
console.log(result.lineTypeIntelligence.carrier_name);
console.log(result.lineTypeIntelligence.type);

// Telnyx
const result = await client.numberLookup.retrieve('+15551234567', {
  type: 'carrier'
});
console.log(result.data.carrier.name);
console.log(result.data.carrier.type);
console.log(result.data.portability.line_type);
```

## Step 3: Caller Name (CNAM) Lookup

CNAM lookup returns the registered name associated with a phone number.

### curl

```bash
# Twilio Lookup v2
curl -X GET "https://lookups.twilio.com/v2/PhoneNumbers/+15551234567?Fields=caller_name" \
  -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN"

# Telnyx caller-name lookup (make a separate `type=carrier` request if needed)
curl -X GET "https://api.telnyx.com/v2/number_lookup/+15551234567?type=caller-name" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Python

```python
# Twilio
result = client.lookups.v2.phone_numbers("+15551234567").fetch(
    fields=["caller_name"]
)
print(result.caller_name["caller_name"])
print(result.caller_name["caller_type"])  # "CONSUMER" or "BUSINESS"

# Telnyx
result = client.number_lookup.retrieve(
    phone_number="+15551234567",
    type="caller-name"
)
if result.data is None or result.data.caller_name is None:
    raise RuntimeError("Caller-name lookup response did not include caller-name data")
print(result.data.caller_name.caller_name)  # e.g., "ACME Corp"
```

### JavaScript

```javascript
// Twilio
const result = await client.lookups.v2.phoneNumbers('+15551234567')
  .fetch({ fields: ['caller_name'] });
console.log(result.callerName.caller_name);
console.log(result.callerName.caller_type);

// Telnyx
const result = await client.numberLookup.retrieve('+15551234567', {
  type: 'caller-name'
});
console.log(result.data.caller_name.caller_name);
```

## Response Field Mapping

The official response schema defines these sub-fields:

- `carrier` (only when `?type=carrier`): `error_code`, `mobile_country_code`, `mobile_network_code`, `name`, `normalized_carrier`, `type`
- `caller_name` (only when `?type=caller-name`): `caller_name`, `error_code`
- `portability` (always): `altspid`, `altspid_carrier_name`, `altspid_carrier_type`, `city`, `line_type`, `lrn`, `ocn`, `ported_date`, `ported_status`, `spid`, `spid_carrier_name`, `spid_carrier_type`, `state`

### Top-Level Fields

| Twilio Lookup v2 Field | Telnyx Field | Notes |
|---|---|---|
| `phone_number` | `phone_number` | E.164 format |
| `valid` | `valid_number` | Validity indicator, returned by default |
| `country_code` | `country_code` | ISO 3166-1 alpha-2 |
| `national_format` | `national_format` | Locally formatted number |
| `url` | N/A | No self-link in Telnyx response |
| `calling_country_code` | N/A | Included in `country_code` |
| N/A | `record_type` | Response object type discriminator |
| N/A | `fraud` | Fraud risk indicator (Telnyx-only) |
| N/A | `nnid_override` | NNID override (Telnyx-only), returned by default |

### Carrier / Line Type Fields

`carrier` is `null` unless the request includes `?type=carrier`. `portability.line_type` is available without it.

| Twilio Field (`line_type_intelligence`) | Telnyx Field | Notes |
|---|---|---|
| `carrier_name` | `carrier.name` | Carrier name string |
| `type` | `portability.line_type` | `mobile`, `fixed line`, `voip`, etc. |
| `mobile_country_code` | `carrier.mobile_country_code` | MCC |
| `mobile_network_code` | `carrier.mobile_network_code` | MNC |
| `error_code` | `carrier.error_code` | Error indicator |
| N/A | `carrier.type` | Carrier type (e.g., `voip`, `mobile`) |
| N/A | `carrier.normalized_carrier` | Normalized carrier name |

### Caller Name Fields

`caller_name` is `null` unless the request includes `?type=caller-name`. The object has exactly two sub-fields.

| Twilio Field (`caller_name`) | Telnyx Field | Notes |
|---|---|---|
| `caller_name` | `caller_name.caller_name` | CNAM value |
| `caller_type` | N/A | Not returned by Telnyx — there is no `caller_name.caller_type` |
| `error_code` | `caller_name.error_code` | Error indicator |

### Portability Fields (Telnyx-only)

Telnyx returns additional portability data not available in Twilio Lookup. `portability` is populated on every lookup — no `type` parameter required. These 13 sub-fields are the complete set:

| Telnyx Field | Description |
|---|---|
| `portability.lrn` | Local Routing Number |
| `portability.ported_status` | `Y` (ported) or `N` (not ported) |
| `portability.ported_date` | Date the number was ported |
| `portability.ocn` | Operating Company Number |
| `portability.line_type` | Line type (`mobile`, `fixed line`, `voip`, etc.) |
| `portability.spid` | Service Provider ID |
| `portability.spid_carrier_name` | SPID carrier name |
| `portability.spid_carrier_type` | SPID carrier type |
| `portability.altspid` | Alternative SPID |
| `portability.altspid_carrier_name` | Alternative SPID carrier name |
| `portability.altspid_carrier_type` | Alternative SPID carrier type |
| `portability.city` | City associated with the number |
| `portability.state` | State associated with the number |

### Fraud Fields (Telnyx-only)

| Telnyx Field | Description |
|---|---|
| `fraud` | Fraud risk indicator for the number |

## API Endpoint Mapping

| Operation | Twilio Endpoint | Telnyx Endpoint |
|---|---|---|
| Basic lookup | `GET /v2/PhoneNumbers/{number}` | `GET /v2/number_lookup/{number}` |
| Carrier lookup | `GET /v2/PhoneNumbers/{number}?Fields=line_type_intelligence` | `GET /v2/number_lookup/{number}?type=carrier` |
| CNAM lookup | `GET /v2/PhoneNumbers/{number}?Fields=caller_name` | `GET /v2/number_lookup/{number}?type=caller-name` |
| Carrier + CNAM | `GET /v2/PhoneNumbers/{number}?Fields=line_type_intelligence,caller_name` | Two requests: `?type=carrier`, then `?type=caller-name` |
| Bulk lookup | N/A (loop over numbers) | N/A (loop over numbers) |

**Authentication comparison:**

| Aspect | Twilio | Telnyx |
|---|---|---|
| Method | Basic Auth (`SID:Token`) | Bearer Token |
| Header | `Authorization: Basic <base64>` | `Authorization: Bearer <api_key>` |

## Common Pitfalls

1. **Query parameter syntax differs** — Twilio uses `Fields=line_type_intelligence`. Telnyx uses `type=carrier`. The parameter names and values are different.

2. **Line type is in `portability`, not `carrier`** — In Telnyx, the line type (`mobile`, `fixed line`, `voip`) is found at `portability.line_type`, not directly on the carrier object. The `carrier.type` field describes the carrier itself, not the line.

3. **`valid` maps to `valid_number`** — Twilio returns a `valid` boolean. The Telnyx equivalent is the top-level `valid_number` field, returned by default. Telnyx may also return an error response for malformed input, so keep error handling in place.

4. **`carrier` and `caller_name` are null unless requested** — This is the most common migration bug. A plain `GET /v2/number_lookup/{number}` returns the `carrier` and `caller_name` keys set to `null`; only `portability` is populated by default. Pass `?type=carrier` or `?type=caller-name`; make two requests if both are needed. Code that reads carrier data from a parameterless lookup will fail on a null dereference.

5. **CNAM availability is US-only** — Caller name (CNAM) data is primarily available for US numbers. International numbers may return null for `caller_name`.

6. **Carrier name normalization** — Telnyx provides both `carrier.name` (raw) and `carrier.normalized_carrier` (standardized). Use `normalized_carrier` for consistent matching across MVNOs and resellers.

7. **No caller type returned** — Twilio returns `caller_type` (CONSUMER/BUSINESS) alongside CNAM. Telnyx does not provide this field. If your application uses caller type for routing decisions, you will need an alternative data source.

8. **Rate limiting** — Both APIs have rate limits. Telnyx rate limits are documented in the API response headers. If migrating bulk lookup workloads, implement retry logic with exponential backoff.
