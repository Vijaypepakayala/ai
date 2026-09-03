# IoT Migration: Twilio Super SIM to Telnyx IoT SIM

Migrate from Twilio Super SIM to Telnyx IoT SIM for cellular IoT device connectivity.

## Table of Contents

- [Overview](#overview)
- [Key Differences](#key-differences)
- [Concept Mapping](#concept-mapping)
- [Step 1: Order SIM Cards](#step-1-order-sim-cards)
- [Step 2: Register and Activate SIMs](#step-2-register-and-activate-sims)
- [Step 3: Configure SIM Card Groups](#step-3-configure-sim-card-groups)
- [Step 4: Manage Network Preferences](#step-4-manage-network-preferences)
- [Step 5: Monitor Data Usage](#step-5-monitor-data-usage)
- [eSIM Support](#esim-support)
- [Private Wireless Gateway](#private-wireless-gateway)
- [APN Configuration](#apn-configuration)
- [SIM Lifecycle States](#sim-lifecycle-states)
- [API Endpoint Mapping](#api-endpoint-mapping)
- [Common Pitfalls](#common-pitfalls)

## Overview

Twilio Super SIM provides global cellular connectivity for IoT devices. Telnyx IoT SIM offers equivalent functionality with coverage in 180+ countries across 650+ networks, supporting 2G through 4G LTE and CAT-M networks.

Telnyx differentiates with **Private Wireless Gateways** — dedicated infrastructure that routes your IoT device traffic through a siloed, private network on Telnyx's MPLS backbone. This has no Twilio equivalent.

## Key Differences

1. **Private Wireless Gateway** — Telnyx offers dedicated, siloed infrastructure for IoT traffic. No equivalent in Twilio Super SIM.
2. **SIM Card Group model** — Twilio uses Fleets; Telnyx uses SIM Card Groups. Both manage sets of SIMs with shared configuration.
3. **Network preference control** — Telnyx gives you direct control over which mobile networks your SIMs prefer.
4. **Data limit enforcement** — Telnyx SIM Card Groups support data usage caps that automatically disable SIMs when exceeded (state: `data_limit_exceeded`).
5. **eSIM support** — Both platforms support eSIM. Telnyx provides an activation code API for eSIM provisioning.
6. **API authentication** — Twilio uses Basic Auth (SID:Token). Telnyx uses Bearer Token.

## Concept Mapping

| Twilio Super SIM Concept | Telnyx Equivalent | Notes |
|---|---|---|
| Fleet | SIM Card Group | Shared configuration for a set of SIMs |
| SIM Resource | SIM Card | Individual SIM management |
| SIM SID | SIM Card `id` (UUID) | Different ID format |
| ICCID | ICCID | Same — physical SIM identifier |
| Fleet Network Access Profile | Network Preferences | Per-group network configuration |
| Fleet Data Metering | SIM Card Group Data Limit | Set usage caps per group |
| SMS Commands | N/A | Telnyx IoT focuses on data connectivity |
| IP Commands | Private Wireless Gateway | More capable — full private networking |
| Super SIM eSIM | Telnyx eSIM | Activation code API available |
| `ready` / `active` / `inactive` | `registering` / `enabled` / `disabled` | Different state names |

## Step 1: Order SIM Cards

### Order Physical SIMs

Order physical SIM cards in the Telnyx Mission Control Portal. Review the final
quantity, shipping address, total, and currency in the checkout UI immediately
before confirming. This guide intentionally does not provide a copyable
`POST /v2/sim_card_orders` command: the public create contract exposes no
idempotency key, customer reference, or server-side quote identifier, so an
ambiguous timeout cannot be retried automatically without risking a duplicate
billable order. If an API order attempt has an ambiguous result, do not submit
another order; reconcile it with the Portal or Telnyx support first and require
a fresh approval for any subsequent purchase.

### Purchase eSIMs

Purchase eSIMs in the Mission Control Portal only after it displays the current account-specific total and currency and the user approves that exact purchase. The public `POST /v2/actions/purchase/esims` contract accepts the amount and optional SIM Card Group, but it exposes neither a price-preview operation nor a quote or maximum-charge field. For that reason this guide deliberately does not provide a copyable automated purchase call: if the possible charge cannot be verified and bounded at execution time, do not place the order.

## Step 2: Register and Activate SIMs

After receiving physical SIMs, register them with their registration codes, then enable them. The registration code is a short code printed on the SIM card (and its packaging) — it is distinct from the ICCID.

### Register SIMs

```bash
curl -X POST https://api.telnyx.com/v2/actions/register/sim_cards \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "registration_codes": ["0000000001", "0000000002"],
    "sim_card_group_id": "YOUR_SIM_GROUP_ID"
  }'
```

```python
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

client.actions.register.create(
    registration_codes=["0000000001", "0000000002"],
    sim_card_group_id="YOUR_SIM_GROUP_ID"
)
```

### Enable a SIM Card

Once registered, enable the SIM to connect it to the network:

```bash
curl -X POST "https://api.telnyx.com/v2/sim_cards/$SIM_CARD_ID/actions/enable" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Important:** A SIM must be associated with a SIM Card Group before it can be enabled. The SIM Card Group defines data limits, network preferences, and other shared configuration.

### Disable a SIM Card

```bash
curl -X POST "https://api.telnyx.com/v2/sim_cards/$SIM_CARD_ID/actions/disable" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Step 3: Configure SIM Card Groups

SIM Card Groups are the Telnyx equivalent of Twilio Fleets. They define shared configuration for sets of SIMs.

### Create a SIM Card Group

```bash
curl -X POST https://api.telnyx.com/v2/sim_card_groups \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "fleet-north-america",
    "data_limit": {
      "amount": "5120",
      "unit": "MB"
    }
  }'
```

```python
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

group = client.sim_card_groups.create(
    name="fleet-north-america",
    data_limit={"amount": "5120", "unit": "MB"}
)
if group.data is None:
    raise RuntimeError("SIM card group response did not include data")
print(group.data.id)
```

### Update a SIM Card Group

```bash
curl -X PATCH "https://api.telnyx.com/v2/sim_card_groups/$GROUP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data_limit": {
      "amount": "10240",
      "unit": "MB"
    }
  }'
```

**SIM Card Group settings:**

| Setting | Description |
|---|---|
| `name` | Group name for identification |
| `data_limit` | Data usage cap (`amount` is a string; use documented `MB` units). SIMs exceeding this transition to `data_limit_exceeded` state |
| Private Wireless Gateway | Associate through the asynchronous `set_private_wireless_gateway` action, not the create/update group body |
| Network preferences | Preferred mobile networks. Not settable via the API — configure in the Mission Control Portal; changes surface read-only as OTA updates (see [Step 4](#step-4-manage-network-preferences)) |

## Step 4: Manage Network Preferences

Telnyx gives you control over which mobile networks your SIMs prefer. Network preference changes are applied to SIMs as an Over-the-Air (OTA) update. In the IoT API these surface as OTA update records with `type: sim_card_network_preferences`, which you can track via `GET /ota_updates` (and `GET /ota_updates/{id}` for a single update).

```bash
# List OTA updates (network preference changes appear as type "sim_card_network_preferences")
curl -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/ota_updates"
```

> **CONFIRMED: there is no `set_network_preferences` write endpoint.** A previous version of this doc showed
> `PUT|POST /v2/sim_card_groups/{id}/actions/set_network_preferences` with a `mobile_operator_networks_preferences`
> payload. That endpoint is fabricated — it does not exist. Verified against the live API
> (`api.telnyx.com`, authenticated):
>
> | Request | Result |
> |---|---|
> | `POST /v2/sim_card_groups/{id}/actions/set_network_preferences` | HTTP 404 with an **unstructured, router-level** body: `{"errors":{"detail":"Resource not found"}}` — no Telnyx error code, i.e. the route itself is not registered |
> | `POST /v2/sim_card_groups/{same id}/actions/set_wireless_blocklist` (control: real action route) | HTTP 422 with a **structured** Telnyx error (code `10004`, "Missing required parameter") — the route exists, only validation failed |
> | `GET /v2/sim_card_groups/{same id}` (control: real resource route) | HTTP 404 with a **structured** Telnyx error (code `10005`, "Resource not found") |
>
> Real routes return structured Telnyx errors even when they reject the request; `set_network_preferences` returns the
> router's generic 404 instead. That difference is the proof the route does not exist.
>
> **Do not substitute another write endpoint** — none is documented. Network preferences are only observable
> read-only through `GET /v2/ota_updates` (and `GET /v2/ota_updates/{id}`) with `type: sim_card_network_preferences`.
> Set network preferences via the Mission Control Portal, or contact Telnyx support, and use the OTA update records
> to track that the change propagated to SIMs.


**Comparison with Twilio:**

| Aspect | Twilio Super SIM | Telnyx IoT SIM |
|---|---|---|
| Network control | Network Access Profile on Fleet | Network Preferences on SIM Card Group |
| Granularity | Per-Fleet | Per-SIM Card Group |
| Priority setting | Ordered list | Explicit priority values |
| Network technologies | 2G-5G | 2G-4G LTE, 25 CAT-M networks |

## Step 5: Monitor Data Usage

### Get SIM Card Details (includes usage)

```bash
curl -X GET "https://api.telnyx.com/v2/sim_cards/$SIM_CARD_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Get Device Details

```bash
curl -X GET "https://api.telnyx.com/v2/sim_cards/$SIM_CARD_ID/device_details" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### List SIM Card Actions (activity log)

```bash
curl -X GET -G --data-urlencode "filter[sim_card_id]=$SIM_CARD_ID" \
  "https://api.telnyx.com/v2/sim_card_actions" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

```python
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

sim = client.sim_cards.retrieve("SIM_CARD_ID")
if sim.data is None:
    raise RuntimeError("SIM card response did not include data")
print(f"ICCID: {sim.data.iccid}")
print(f"Status: {sim.data.status}")
```

## eSIM Support

Telnyx supports eSIM for IoT deployments that require remote SIM provisioning without physical SIM cards.

### Purchase eSIMs

See [Step 1: Order SIM Cards](#step-1-order-sim-cards) for the purchase endpoint.

### Get eSIM Activation Code

After purchasing, retrieve the activation code to provision the eSIM on a device:

```bash
curl -X GET "https://api.telnyx.com/v2/sim_cards/$SIM_CARD_ID/activation_code" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

The activation code is used by the device's eUICC to download the eSIM profile.

**eSIM comparison:**

| Aspect | Twilio Super SIM | Telnyx IoT SIM |
|---|---|---|
| eSIM support | Yes | Yes |
| Activation method | QR code or activation code | Activation code via API |
| Bulk provisioning | Via API | Via API (`/actions/purchase/esims`) |
| Profile management | Twilio Console | Mission Control Portal + API |

## Private Wireless Gateway

**This is a Telnyx-only feature with no Twilio equivalent.**

A Private Wireless Gateway (PWG) provides dedicated infrastructure that routes your IoT device traffic through a completely siloed private network. The PWG connects to a virtual routing and forwarding (VRF) defined network on top of Telnyx's MPLS backbone.

Benefits:
- **Complete traffic isolation** — Your device data never shares infrastructure with other customers
- **Private IP addressing** — Assign private IPs to your SIM cards
- **Edge connectivity** — Deploy devices directly to the edge of your corporate network
- **Enhanced security** — No public internet exposure for device-to-server communication

```bash
# Create a Private Wireless Gateway
curl -X POST https://api.telnyx.com/v2/private_wireless_gateways \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-iot-gateway",
    "network_id": "YOUR_NETWORK_ID"
  }'
```

Associate the gateway with a SIM Card Group through the required asynchronous action and capture the action ID:

```bash
ACTION_ID=$(curl -fsS -X POST \
  "https://api.telnyx.com/v2/sim_card_groups/$GROUP_ID/actions/set_private_wireless_gateway" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"private_wireless_gateway_id":"'"$PRIVATE_WIRELESS_GATEWAY_ID"'"}' \
  | jq -er '.data.id')

# Poll until status is completed; stop and diagnose if it becomes failed.
curl -fsS \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/sim_card_group_actions/$ACTION_ID"
```

Do not treat the `202` response as completion. Track `GET /v2/sim_card_group_actions/{id}` until the action reports `completed` or `failed`.

## APN Configuration

Configure the Access Point Name (APN) on your IoT devices to connect through Telnyx:

| APN Setting | Value |
|---|---|
| **Standard APN** | `data00.telnyx` |
| **Private gateway (static IP)** | `data.net` |
| **Private gateway (dynamic IP)** | `data00.telnyx` |

For devices using Private Wireless Gateways, the APN determines IP assignment behavior:
- `data.net` — Static IP assignment
- `data00.telnyx` — Dynamic IP assignment

**Twilio APN comparison:**

| Aspect | Twilio Super SIM | Telnyx IoT SIM |
|---|---|---|
| Standard APN | `super` | `data00.telnyx` |
| Private networking APN | N/A | `data.net` or `data00.telnyx` |
| Configuration | Device-side | Device-side |

## SIM Lifecycle States

| Telnyx State | Description | Twilio Equivalent |
|---|---|---|
| `registering` | SIM registration in progress | `new` |
| `enabling` | SIM activation in progress | N/A (transitional) |
| `enabled` | SIM is active and connected | `active` |
| `disabling` | SIM deactivation in progress | N/A (transitional) |
| `disabled` | SIM is paused (no data, reduced cost) | `inactive` |
| `data_limit_exceeded` | SIM exceeded group data limit | N/A (Telnyx-specific) |
| `setting_standby` | Transitioning to standby | N/A (transitional) |
| `standby` | Low-power standby mode | N/A (Telnyx-specific) |

## API Endpoint Mapping

| Operation | Twilio Endpoint | Telnyx Endpoint |
|---|---|---|
| List SIMs | `GET /v1/Sims` | `GET /v2/sim_cards` |
| Get SIM | `GET /v1/Sims/{SID}` | `GET /v2/sim_cards/{id}` |
| Update SIM | `POST /v1/Sims/{SID}` | `PATCH /v2/sim_cards/{id}` |
| Activate SIM | `POST /v1/Sims/{SID} (status=active)` | `POST /v2/sim_cards/{id}/actions/enable` |
| Deactivate SIM | `POST /v1/Sims/{SID} (status=inactive)` | `POST /v2/sim_cards/{id}/actions/disable` |
| List Fleets/Groups | `GET /v1/Fleets` | `GET /v2/sim_card_groups` |
| Create Fleet/Group | `POST /v1/Fleets` | `POST /v2/sim_card_groups` |
| Update Fleet/Group | `POST /v1/Fleets/{SID}` | `PATCH /v2/sim_card_groups/{id}` |
| Register SIMs | N/A | `POST /v2/actions/register/sim_cards` |
| Purchase eSIMs | N/A | `POST /v2/actions/purchase/esims` |
| Get eSIM activation code | N/A | `GET /v2/sim_cards/{id}/activation_code` |
| Get device details | N/A | `GET /v2/sim_cards/{id}/device_details` |
| List SIM actions | N/A | `GET /v2/sim_card_actions` |
| Read network preference updates (OTA) | `POST /Fleets/{SID}/NetworkAccessProfiles` | `GET /v2/ota_updates` (type `sim_card_network_preferences`) — **read-only; no API write endpoint exists** (confirmed: `.../actions/set_network_preferences` returns a router-level 404, see [Step 4](#step-4-manage-network-preferences)). Set preferences via Mission Control Portal. |
| Create private gateway | N/A | `POST /v2/private_wireless_gateways` |
| Order SIMs | Console only | `POST /v2/sim_card_orders` |
| Bulk disable voice on SIMs | N/A | `POST /v2/sim_cards/actions/bulk_disable_voice` |
| Bulk enable voice on SIMs | N/A | `POST /v2/sim_cards/actions/bulk_enable_voice` |
| Bulk set SIM public IPs | N/A | `POST /v2/sim_cards/actions/bulk_set_public_ips` |

## Common Pitfalls

1. **SIM must belong to a group before enabling** — Unlike Twilio where you assign a SIM to a Fleet after activation, Telnyx requires a SIM Card Group association before you can enable the SIM.

2. **Data limit enforcement is automatic** — When a SIM exceeds its group's data limit, it transitions to `data_limit_exceeded` and stops passing data. Increase the limit or reset it to restore connectivity.

3. **APN must be configured on the device** — The standard APN `data00.telnyx` must be set on each IoT device. Devices migrated from Twilio still have the `super` APN configured. Use `data.net` only for static-IP traffic through a Private Wireless Gateway; update the APN before or during migration.

4. **Registration is a separate step** — Physical SIMs must be registered with their registration code (a short code printed on the SIM, distinct from the ICCID) before they can be enabled. This is an explicit API call, not automatic on first use.

5. **Private Wireless Gateway requires planning** — If you need private networking (Telnyx-only feature), set up the PWG and associate it with your SIM Card Group before enabling SIMs. Changing the gateway later requires SIM reconfiguration.

6. **Network preference changes take time — and are not API-writable** — There is no API endpoint to set network preferences (confirmed against the live API; see [Step 4](#step-4-manage-network-preferences)). Make the change in the Mission Control Portal, then track it via `GET /v2/ota_updates` (type `sim_card_network_preferences`). Even once applied, the change does not immediately switch active SIMs to the new network — devices may need to be power-cycled or will switch on next network reselection.

7. **eSIM activation codes are one-time use** — Each activation code can only be used once. If provisioning fails, you may need to purchase a replacement eSIM.
