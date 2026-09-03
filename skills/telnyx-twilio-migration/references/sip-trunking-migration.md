# SIP Trunking Migration: Twilio Elastic SIP Trunking to Telnyx SIP Connections

Migrate from Twilio Elastic SIP Trunking to Telnyx SIP Connections for PBX, contact center, and SBC integrations.

## Table of Contents

- [Overview](#overview)
- [Key Differences](#key-differences)
- [Concept Mapping](#concept-mapping)
- [Step 1: Choose a Connection Type](#step-1-choose-a-connection-type)
- [Step 2: Create a SIP Connection](#step-2-create-a-sip-connection)
- [Step 3: Configure an Outbound Voice Profile](#step-3-configure-an-outbound-voice-profile)
- [Step 4: Configure Inbound Settings](#step-4-configure-inbound-settings)
- [Step 5: Assign Phone Numbers](#step-5-assign-phone-numbers)
- [Step 6: Configure Encryption (SRTP and TLS)](#step-6-configure-encryption-srtp-and-tls)
- [Step 7: Test Connectivity](#step-7-test-connectivity)
- [IP Whitelisting Configuration](#ip-whitelisting-configuration)
- [Registration-Based vs Static IP](#registration-based-vs-static-ip)
- [Emergency Calling (E911)](#emergency-calling-e911)
- [PBX Migration Checklist](#pbx-migration-checklist)
- [API Endpoint Mapping](#api-endpoint-mapping)
- [Common Pitfalls](#common-pitfalls)

## Overview

Twilio Elastic SIP Trunking routes SIP traffic through a single trunk model. Telnyx replaces this with **SIP Connections** — a more flexible model offering three distinct authentication methods: IP-based, Credential-based, and FQDN-based.

Each Telnyx SIP Connection pairs with an **Outbound Voice Profile** for outbound call routing, billing, and destination controls. This separation gives you finer-grained control over inbound and outbound traffic than Twilio's single trunk object.

## Key Differences

1. **Authentication flexibility** — Twilio supports IP ACLs and Credential Lists on a single trunk. Telnyx offers three separate connection types: IP Authentication, Credential Authentication, and FQDN Authentication.
2. **Outbound control is separate** — Twilio bundles origination/termination on the trunk. Telnyx splits outbound routing into an Outbound Voice Profile (spend limits, destination whitelists, caller ID policy).
3. **AnchorSite media optimization** — Telnyx routes media through the nearest regional PoP via AnchorSite settings. Twilio has no equivalent.
4. **Native T.38 fax passthrough** — Telnyx supports on-net T.38 negotiation directly on SIP Connections.
5. **Webhook signature** — Twilio uses HMAC-SHA1; Telnyx uses Ed25519 for all webhook validation.

## Concept Mapping

| Twilio Concept | Telnyx Equivalent | Notes |
|---|---|---|
| SIP Trunk | SIP Connection | Three types: IP, Credential, FQDN |
| Origination URI | Inbound Settings | Configured on the Connection object |
| Termination URI | Outbound Voice Profile | Separate resource for outbound routing |
| IP Access Control List | IP Authentication Connection | Whitelisted IPs defined at connection level |
| Credential List | Credential Authentication Connection | Username/password per connection |
| Trunk Region | AnchorSite Override | Latency-based (default) or fixed region |
| Secure Trunking (TLS/SRTP) | Encrypted Media + TLS Transport | Per-connection configuration |
| Origination SIP URI | SIP Subdomain | `username@subdomain.sip.telnyx.com` |
| Phone Number → Trunk assignment | Phone Number → Connection assignment | Same model, different naming |

## Step 1: Choose a Connection Type

Telnyx offers three authentication methods. Choose based on your PBX/SBC capabilities:

**IP Authentication** — Best for static PBX/SBC deployments with known IP addresses.
- No registration required
- Telnyx authenticates based on source IP
- Supports Tech Prefix, Token, and P-Charge-Info as additional security

**Credential Authentication** — Best for dynamic IP environments or softphones.
- SIP REGISTER required
- Username/password authentication
- Supports SIP subdomains for multi-tenant routing
- Register to `sip.telnyx.com` or your subdomain

**FQDN Authentication** — Best for DNS-based routing.
- Authenticate based on the FQDN of the SIP request
- No registration required

## Step 2: Create a SIP Connection

### IP Authentication Connection

IP connections are created in two steps: first create the `ip_connection`, then register each whitelisted IP as a separate `ip` resource (`POST /v2/ips`) tied to the connection via `connection_id`. The `POST /ip_connections` endpoint does **not** accept an inline IP list.

```bash
# Step 1: Create the IP connection
curl -X POST https://api.telnyx.com/v2/ip_connections \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_name": "headquarters-pbx",
    "active": true,
    "transport_protocol": "UDP",
    "anchorsite_override": "Latency",
    "webhook_event_url": "https://example.com/sip-events",
    "webhook_api_version": "2"
  }'
# Response includes the new connection "id" — use it as connection_id below.

# Step 2: Add each whitelisted IP as a separate resource
curl -X POST https://api.telnyx.com/v2/ips \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ip_address": "203.0.113.10",
    "port": 5060,
    "connection_id": "YOUR_CONNECTION_ID"
  }'

curl -X POST https://api.telnyx.com/v2/ips \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ip_address": "203.0.113.11",
    "port": 5060,
    "connection_id": "YOUR_CONNECTION_ID"
  }'
```

### Credential Authentication Connection

```bash
curl -X POST https://api.telnyx.com/v2/credential_connections \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_name": "remote-office",
    "active": true,
    "user_name": "my-pbx-user",
    "password": "secure-password-here",
    "sip_uri_calling_preference": "disabled",
    "anchorsite_override": "Latency",
    "webhook_event_url": "https://example.com/sip-events",
    "webhook_api_version": "2"
  }'
```

> **Do not add `sip_subdomain` / `sip_subdomain_receive_settings` to this body.** Measured against the live API, `/v2/credential_connections` accepts them (201 on create, 200 on a follow-up PATCH, nested under `inbound` or at the top level) and then **silently discards** them — a subsequent `GET` never returns them, and they appear nowhere in the endpoint's request or response schema (see `sdk-reference/{language}/sip.md`, generated from the Telnyx OpenAPI spec). Configure subdomains in Mission Control Portal → **SIP** → **Connections** instead. See the Subdomains section of `{baseDir}/references/voice-migration.md`.

```python
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

connection = client.credential_connections.create(
    connection_name="remote-office",
    active=True,
    user_name="my-pbx-user",
    password="secure-password-here",
    sip_uri_calling_preference="disabled",
    anchorsite_override="Latency",
    webhook_event_url="https://example.com/sip-events"
)
print(connection.data.id)
```

```javascript
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });

const connection = await client.credentialConnections.create({
  connection_name: 'remote-office',
  active: true,
  user_name: 'my-pbx-user',
  password: 'secure-password-here',
  sip_uri_calling_preference: 'disabled',
  anchorsite_override: 'Latency',
  webhook_event_url: 'https://example.com/sip-events'
});
console.log(connection.data.id);
```

## Step 3: Configure an Outbound Voice Profile

Unlike Twilio where outbound settings live on the trunk, Telnyx uses a separate **Outbound Voice Profile** resource. This controls billing, allowed destinations, spend limits, and caller ID policy.

```bash
curl -X POST https://api.telnyx.com/v2/outbound_voice_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-outbound",
    "traffic_type": "conversational",
    "service_plan": "global",
    "concurrent_call_limit": 50,
    "daily_spend_limit": "500.00",
    "daily_spend_limit_enabled": true,
    "whitelisted_destinations": ["US", "CA", "GB"],
    "enabled": true
  }'
```

Then associate the profile with your connection in the Mission Control Portal under **SIP** > **Connections** > **Outbound**, or set it on the connection's `outbound` object (e.g. `"outbound": {"outbound_voice_profile_id": "YOUR_PROFILE_ID"}`) when creating or updating the connection. It is not a top-level connection field.

## Step 4: Configure Inbound Settings

Inbound settings on a Telnyx Connection control how incoming SIP traffic is handled:

- **Channel limit** — Maximum concurrent inbound calls
- **SIP subdomain** — For credential connections, defines the registration URI
- **Codecs** — G.711u, G.711a, G.729, Opus (configure in portal)
- **DTMF type** — RFC 2833 (recommended), Inband, or SIP Info
- **T.38 fax passthrough** — Enable on-net T.38 negotiation

These replace Twilio's Origination URI configuration.

## Step 5: Assign Phone Numbers

Use the quoted purchase workflow in `{baseDir}/references/numbers-migration.md`. It re-queries and displays the current upfront and monthly costs, requires the exact number and cost tuple at the local approval gate, serializes the same number, and fails closed if the inventory or quote changed. The Number Orders API has no quote-ID or maximum-charge field, so the cost tuple is not sent to or enforced by the server. After the order completes, assign the purchased number to the exact SIP Connection as a separate reviewed configuration change.

Or port existing numbers from Twilio. See `{baseDir}/references/number-porting.md` for the full porting guide.

## Step 6: Configure Encryption (SRTP and TLS)

Telnyx supports TLS 1.2+ for SIP signaling and SRTP for media encryption.

### TLS Signaling

| Setting | Value |
|---|---|
| TLS signaling address | `sip.telnyx.com:5061` |
| Alternative TLS port | `sip.telnyx.com:7443` |
| Supported versions | TLS 1.2, TLS 1.3 |
| DH key exchange | Minimum 2048-bit keys |

For **Credential connections**: Register over TLS to receive inbound calls over TLS.

For **IP/FQDN connections**: Set the transport type to TLS in inbound settings.

### SRTP Media Encryption

Enable encrypted media on your connection. Telnyx supports these cipher suites:

- `AEAD_AES_256_GCM_8` / `AEAD_AES_128_GCM_8`
- `AES_256_CM_HMAC_SHA1_80` / `AES_256_CM_HMAC_SHA1_32`
- `AES_192_CM_HMAC_SHA1_80` / `AES_192_CM_HMAC_SHA1_32`
- `AES_CM_128_HMAC_SHA1_80` / `AES_CM_128_HMAC_SHA1_32`

**Twilio vs Telnyx encryption comparison:**

| Aspect | Twilio | Telnyx |
|---|---|---|
| TLS versions | TLS 1.0+ | TLS 1.2+ (1.0/1.1 deprecated) |
| SRTP | Enabled at trunk level | Enabled per connection |
| Signaling port | 5061 | 5061 (primary), 7443 (alternative) |
| Configuration | Toggle on trunk | `encrypted_media` field on connection |

## Step 7: Test Connectivity

1. **Verify SIP registration** (credential connections): Check the Mission Control Portal under **SIP** > **Connections** for registration status.
2. **Make a test inbound call**: Dial one of your assigned numbers and verify your PBX receives the INVITE.
3. **Make a test outbound call**: Originate a call from your PBX through the Telnyx connection.
4. **Check media quality**: In the portal, navigate to **Debugging** > **Call Events** to review RTP stats.
5. **Verify SRTP negotiation**: If encryption is enabled, confirm both signaling and media are encrypted in call logs.

## IP Whitelisting Configuration

For IP Authentication connections, you must whitelist your PBX/SBC IP addresses on the Telnyx connection. Additionally, whitelist Telnyx signaling and media IPs on your firewall:

**Telnyx Signaling IPs:**
- `sip.telnyx.com` resolves to multiple regional IPs
- For IP connections, Telnyx initiates calls from `192.76.120.10` by default (configurable via AnchorSite)

**Telnyx Media (RTP) IP Ranges:**
- Published in the [Telnyx IP ranges documentation](https://support.telnyx.com/en/articles/4404565-telnyx-sip-signaling-and-media-ip-ranges)
- Ports: 20000-60000 UDP

**Comparison:**

| Setting | Twilio | Telnyx |
|---|---|---|
| Signaling endpoint | `*.pstn.twilio.com` | `sip.telnyx.com` |
| Signaling ports | 5060 (UDP), 5061 (TLS) | 5060 (UDP), 5061 (TLS), 7443 (TLS) |
| Media ports | 10000-20000 | 20000-60000 |
| IP ACL location | Trunk > IP ACL | Connection > IP Authentication |

## Registration-Based vs Static IP

| Approach | When to Use | Telnyx Connection Type |
|---|---|---|
| **Static IP (no registration)** | Fixed PBX/SBC with known public IPs | IP Authentication |
| **SIP REGISTER** | Dynamic IPs, softphones, remote workers | Credential Authentication |
| **DNS-based** | SBCs with FQDN-based routing | FQDN Authentication |

For **registration-based** connections, your PBX registers to:
```
sip.telnyx.com (standard)
sip.telnyx.com:5061 (TLS)
YOUR_SUBDOMAIN.sip.telnyx.com (with subdomain)
```

Registration interval is managed by your PBX. Telnyx accepts standard SIP REGISTER with authentication challenge.

## Emergency Calling (E911)

If your SIP trunking deployment serves physical locations, you must configure E911:

1. **Register E911 addresses** in the Mission Control Portal under **Numbers** > **Emergency Settings**
2. **Assign E911 addresses to phone numbers** used at each location
3. **Dial `933` from the configured trunk** to hear the emergency-calling test announcement and verify the caller ID/address routing without dispatching emergency services

**Twilio vs Telnyx E911 comparison:**

| Aspect | Twilio | Telnyx |
|---|---|---|
| E911 address registration | Per-number via API | Per-number via API or portal |
| Dynamic E911 (HELD/PIDF-LO) | Supported | Supported |
| E911 API endpoint | `POST /Addresses` | `POST /phone_numbers/{id}/actions/enable_emergency` with `emergency_enabled` and `emergency_address_id` |
| Surcharge | Per-number monthly | Per-number monthly |

**Important:** E911 obligations apply to all VoIP providers. When migrating SIP trunks that serve fixed locations (offices, call centers), ensure E911 addresses are configured on Telnyx **before** porting numbers.

## PBX Migration Checklist

Use this checklist when migrating a PBX from Twilio Elastic SIP Trunking to Telnyx:

- [ ] **Audit current trunk configuration** — Document Twilio trunk settings: IP ACLs, credential lists, origination/termination URIs, encryption settings
- [ ] **Choose Telnyx connection type** — IP, Credential, or FQDN based on your PBX
- [ ] **Create the SIP Connection** on Telnyx with matching authentication
- [ ] **Create an Outbound Voice Profile** with appropriate spend limits and destination restrictions
- [ ] **Configure encryption** — Match or upgrade your current TLS/SRTP settings
- [ ] **Update PBX SIP trunk settings:**
  - Outbound proxy: `sip.telnyx.com` (or `sip.telnyx.com:5061` for TLS)
  - Authentication: As configured on the Telnyx connection
  - Codecs: Verify codec priority matches
- [ ] **Whitelist Telnyx IPs** on your firewall (signaling + media ranges)
- [ ] **Configure E911** for all numbers serving physical locations
- [ ] **Purchase or port phone numbers** and assign to the connection
- [ ] **Test inbound and outbound calls** — Verify audio quality, DTMF, fax passthrough
- [ ] **Test failover** — Verify webhook failover URLs and connection redundancy
- [ ] **Monitor** — Use Mission Control Portal debugging tools for first 48 hours

## API Endpoint Mapping

| Operation | Twilio Endpoint | Telnyx Endpoint |
|---|---|---|
| List trunks/connections | `GET /Trunks` | `GET /v2/connections` |
| Create IP connection | `POST /Trunks` + `POST /IpAccessControlLists` | `POST /v2/ip_connections` |
| Create credential connection | `POST /Trunks` + `POST /CredentialLists` | `POST /v2/credential_connections` |
| Create FQDN connection | N/A | `POST /v2/fqdn_connections` |
| Update connection | `POST /Trunks/{SID}` | `PATCH /v2/credential_connections/{id}` |
| Delete connection | `DELETE /Trunks/{SID}` | `DELETE /v2/credential_connections/{id}` |
| List connections | `GET /Trunks` | `GET /v2/connections` (all types) |
| Create outbound profile | N/A (trunk-level) | `POST /v2/outbound_voice_profiles` |
| Assign number to trunk | `POST /Trunks/{SID}/PhoneNumbers` | Set `connection_id` on number order/update |
| Set IP ACL | `POST /IpAccessControlLists` | Separate `POST /v2/ips` per IP (with `connection_id`) |
| Set credentials | `POST /CredentialLists` | Included in credential connection creation |

## Common Pitfalls

1. **Forgetting the Outbound Voice Profile** — Unlike Twilio, outbound calling will not work without an Outbound Voice Profile assigned to your connection. This is the most common setup omission.

2. **Firewall blocking Telnyx media IPs** — Telnyx uses a different media IP range (ports 20000-60000) than Twilio. Update your firewall rules before testing.

3. **AnchorSite mismatch causing latency** — If your PBX is in a specific region, set `anchorsite_override` to the nearest Telnyx PoP instead of relying on Latency auto-detection during initial testing.

4. **TLS version incompatibility** — Telnyx requires TLS 1.2+. If your PBX only supports TLS 1.0/1.1, you must upgrade before enabling encryption.

5. **SRTP cipher mismatch** — If SRTP is enabled, your PBX must offer at least one cipher suite that Telnyx supports. Mismatched cipher suites will cause call rejection.

6. **Missing E911 before porting** — If you port numbers that had E911 on Twilio, configure E911 addresses on Telnyx **before** the port completes. There is no automatic migration of E911 data.

7. **Codec negotiation differences** — Telnyx may offer a different codec priority than Twilio. If you experience audio quality issues, explicitly configure codec priority on both your PBX and the Telnyx connection.

8. **Subdomain misconfiguration** — For credential connections, `sip_subdomain_receive_settings` defaults may not match your routing needs: `only_my_connections` for security, `from_anyone` for open routing. Set this **in Mission Control Portal → SIP → Connections**. Sending it (or `sip_subdomain`) to `/v2/credential_connections` returns a success status and changes nothing — see Step 2. Verify a subdomain by registering against it, never by resolving it: `*.sip.telnyx.com` is a DNS wildcard, so an unprovisioned subdomain still returns an A record.
