# WebRTC Migration: Twilio Voice SDK to Telnyx WebRTC

Migrate from Twilio's client-side Voice SDK to Telnyx WebRTC SDKs.

## Table of Contents

- [Architecture Differences](#architecture-differences)
- [TwiML Endpoint Analysis (DELETE vs CONVERT)](#twiml-endpoint-analysis-delete-vs-convert)
- [Concept Mapping](#concept-mapping)
- [Migration Steps](#migration-steps)
- [Authentication Flow Comparison](#authentication-flow-comparison)
- [Client SDK Setup](#client-sdk-setup)
- [Call Management](#call-management)
- [Token and Credential Management](#token-and-credential-management)
- [Platform-Specific Guides](#platform-specific-guides)
- [Contact Center / PBX Patterns](#contact-center--pbx-patterns)

## Architecture Differences

The most significant difference: **Telnyx WebRTC can dial PSTN directly from the browser without a server webhook.**

**Twilio architecture (mandatory backend):**
```
Browser/App → Your Backend Server → Twilio API (get Access Token)
           ← Access Token ←
Browser/App → Twilio (connect with Access Token)
           → Twilio calls your TwiML App webhook → Server returns <Dial> → Call connects
```

Every outbound call requires a round-trip to your server to get TwiML instructions, even for a simple dial.

**Telnyx architecture (optional backend):**
```
Browser/App → Telnyx (connect with SIP credentials or JWT)
Browser/App → client.newCall({destinationNumber}) → Call connects directly to PSTN
```

A backend server is only needed for:
- Dynamic credential management
- Complex call flows (IVR, recording, conferencing)
- Business logic that can't live in the client

## TwiML Endpoint Analysis (DELETE vs CONVERT)

> **PRECEDENCE (matches SKILL.md Phase 2, Step 2.2).** This tree and the Phase 2 voice-approach matrix answer different questions and are applied in order:
>
> - **This tree decides whether the endpoint survives.** It runs **first** and **wins on existence**. A WebRTC-only endpoint whose whole body is `<Dial><Number>` or `<Dial><Client>` is DELETED, even though the Phase 2 matrix lists "simple Dial" under TeXML — the matrix is about *how* to serve an endpoint you are keeping, not *whether* to keep it. The browser SDK dials directly via `client.newCall()`, so a deleted endpoint has nothing left for TeXML to express.
> - **The Phase 2 matrix then decides the approach (TeXML vs Call Control) for everything this tree marks CONVERT.**
>
> This tree only applies to endpoints reached by a **WebRTC client**. An endpoint driven by an inbound PSTN webhook with no WebRTC client involved is out of scope here — send it straight to the Phase 2 matrix.

Before migrating each TwiML endpoint, determine if it's still needed:

**The direction of the call leg decides the answer.** `client.newCall()` only exists in a browser/app that is already running your JS. It cannot be used to handle a leg that originated somewhere else (a PSTN caller dialling your Telnyx number, or a Call Control leg your server created). Those legs must be answered by XML or by a server-side API command. Check the direction *before* deleting anything.

```
TwiML ENDPOINT DECISION TREE
─────────────────────────────
Who originates the call leg this endpoint serves?

BROWSER/APP-ORIGINATED (your JS is already running; endpoint was reached
because Twilio called your TwiML App after device.connect())
├── Does it ONLY do simple dial?
│   (Returns <Dial><Number>{param}</Number></Dial>)
│   ├── YES → DELETE endpoint, use client.newCall() instead
│   └── NO → Does it dial a <Client> identity?
│       (Returns <Dial><Client>agent_name</Client></Dial>)
│       ├── YES → DELETE endpoint, dial the target agent's SIP URI from
│       │         the client (see Identity-Based Routing below)
│       └── NO → Does it use <Gather>, <Record>, <Say>, <Play>,
│                <Conference>, or conditional logic?
│           ├── YES → CONVERT to TeXML (keep server endpoint, XML is compatible)
│           └── NO → Likely DELETE (analyze further)
│
└── PSTN-ORIGINATED or SERVER-ORIGINATED (inbound number webhook, or a leg
    created by the REST API — no browser JS is running on this leg)
    └── ALWAYS CONVERT — never DELETE. There is no client.newCall() to
        replace it with. <Dial><Client>agent</Client></Dial> becomes
        <Dial><Sip>sip:{sip_username}@sip.telnyx.com</Sip></Dial>.
```

| TwiML Pattern | Leg direction | Action | Telnyx Replacement |
|---|---|---|---|
| `<Dial><Number>{To}</Number></Dial>` | browser-originated | **DELETE** | `client.newCall({destinationNumber: to})` |
| `<Dial callerId="+1...">{To}</Dial>` | browser-originated | **DELETE** | `client.newCall({destinationNumber, callerNumber})` |
| `<Dial><Client>identity</Client></Dial>` | browser-originated | **DELETE** | `client.newCall({destinationNumber: 'sip:' + sipUsername + '@sip.telnyx.com'})` where `sipUsername` is the target credential's `sip_username` (**not** its `name` — see [Identity-Based Routing](#identity-based-routing-twilio-client--telnyx-sip-credential)) |
| `<Dial><Client>identity</Client></Dial>` | **PSTN-originated** (inbound number → browser agent) | **CONVERT** | `<Dial><Sip>sip:{sip_username}@sip.telnyx.com</Sip></Dial>` — TeXML, served from your webhook |
| `<Gather><Say>Press 1...</Say></Gather>` | any | **CONVERT** | Same XML, point to TeXML Application |
| `<Record action="/handle">` | any | **CONVERT** | Same XML, point to TeXML Application |
| `<Dial><Conference>room</Conference></Dial>` | any | **CONVERT** | Same XML, point to TeXML Application |
| Conditional routing (if/else) | any | **CONVERT** | Same server logic, return TeXML |

**Benefits of deleting endpoints:** Lower latency (no server round-trip), less code to maintain, reduced server costs.

**Cost of deleting the wrong endpoint:** a PSTN caller reaches a dead number. Deleting the inbound-number webhook because "it just dials a `<Client>`" is the single most common way a WebRTC migration silently loses all inbound calls — the outbound path still works, so it passes a smoke test.

## Concept Mapping

| Twilio Concept | Telnyx Concept | Notes |
|---|---|---|
| TwiML App | SIP Connection | Routes calls to your application logic |
| Access Token | SIP Credentials or JWT | Direct auth, no mandatory backend |
| Twilio.Device | TelnyxRTC.TelnyxRTC | Client SDK entry point |
| device.connect() | client.newCall() | Initiate outbound call |
| device.on('incoming') | client.on('telnyx.notification') | Receive inbound call |
| Call object | Call object | Active call with controls |
| call.accept() | call.answer() | Answer incoming call |
| call.mute(true/false) | call.muteAudio() / call.unmuteAudio() | No `isMuted()` — track state manually |
| call.disconnect() | call.hangup() | End call |
| call.sendDigits() | call.dtmf() | Send DTMF tones |
| device.register() | client.connect() | Register for inbound calls |
| device.unregister() | client.disconnect() | Unregister |
| device.on('registered') | client.on('telnyx.ready') | Client connected |
| device.on('error') | client.on('telnyx.error') | Error handler |
| device.on('tokenWillExpire') | *None — use timer* | See [Token Management](#token-and-credential-management) |
| Not built-in | call.hold() / call.unhold() | Telnyx has native client-side hold |
| Server-side transfer | Call Control `transfer` command | No client-side `call.transfer()` method — transfer is a server-side Call Control action |

### Telnyx Call States

Telnyx calls pass through these states: `new` → `trying` → `requesting` → `recovering` → `ringing` → `answering` → `early` → `active` → `held` → `hangup` → `destroy` → `purge`

### Call Event Lifecycle Mapping

Twilio emits separate named events per call. Telnyx uses a single `telnyx.notification` event with `callUpdate` type — differentiate by checking `notification.call.state`:

| Twilio Event | Telnyx Equivalent | How to Detect |
|---|---|---|
| `device.on('incoming', call)` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'ringing' && n.call.direction === 'inbound'` |
| `call.on('accept')` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'active'` |
| `call.on('ringing')` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'ringing'` |
| `call.on('disconnect')` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'hangup'` |
| `call.on('cancel')` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'hangup'` (same event) |
| `call.on('error')` | `client.on('telnyx.error', e)` | Global error handler |
| `call.on('reconnecting')` | `client.on('telnyx.notification', n)` | `n.type === 'callUpdate' && n.call.state === 'recovering'` |
| `call.parameters.From` | `notification.call` object | Access caller info from the call object in the notification |

```javascript
// Twilio pattern:
call.on('accept', () => console.log('Connected'));
call.on('disconnect', () => console.log('Ended'));

// Telnyx pattern:
client.on('telnyx.notification', (notification) => {
  if (notification.type === 'callUpdate') {
    const call = notification.call;
    switch (call.state) {
      case 'active':  console.log('Connected'); break;
      case 'hangup':  console.log('Ended'); break;
      case 'ringing': console.log('Ringing'); break;
    }
  }
});
```

### Call Rejection

Twilio has `call.reject()`. Telnyx does not have a separate reject method — call `call.hangup()` on a ringing inbound call to reject it:

```javascript
// Twilio: call.reject();
// Telnyx:
if (call.state === 'ringing') {
  call.hangup(); // Rejects the incoming call
}
```

### Audio Device Management

Telnyx provides built-in audio device management on both the client and call objects. Twilio requires custom implementation or third-party libraries.

| Twilio | Telnyx | Level |
|---|---|---|
| `device.audio.availableInputDevices` | `client.getAudioInDevices()` | Client |
| `device.audio.speakerDevices.get()` | `client.getAudioOutDevices()` | Client |
| `device.audio.setInputDevice(id)` | `call.setAudioInDevice(deviceId)` | Per-call |
| `device.audio.speakerDevices.set(id)` | `call.setAudioOutDevice(deviceId)` | Per-call |
| *(not available)* | `client.getVideoDevices()` | Client |
| *(not available)* | `call.setVideoDevice(deviceId)` | Per-call |
| *(custom)* | `client.enableMicrophone()` / `client.disableMicrophone()` | Client |
| *(custom)* | `client.checkPermissions(audio, video)` | Client |

```javascript
// Telnyx: enumerate and select audio devices
const inputs = await client.getAudioInDevices();
const outputs = await client.getAudioOutDevices();

// Set devices on an active call
await call.setAudioInDevice(inputs[0].deviceId);
await call.setAudioOutDevice(outputs[0].deviceId);

// Check browser permissions before connecting
const hasPermission = await client.checkPermissions();
```

See `{baseDir}/sdk-reference/webrtc-client/javascript.md` for the complete client and call API reference.

## Migration Steps

### 1. Create a SIP Connection (replaces TwiML App)

In Mission Control Portal → **SIP** → **SIP Connections**:
- Create a new connection
- Set the connection type to **Credentials**
- **Enable URI dialing** if your app dials SIP URIs (not just PSTN)
- Note the connection ID

Or via API:
```bash
curl -X POST https://api.telnyx.com/v2/credential_connections \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_name": "my-webrtc-app",
    "user_name": "mywebrtcapp",
    "password": "a-long-random-password-here",
    "active": true,
    "sip_uri_calling_preference": "unrestricted",
    "outbound": {
      "outbound_voice_profile_id": "YOUR_OVP_ID"
    }
  }'
```

`user_name`, `password` and `connection_name` are **required** on `POST /v2/credential_connections`. Set `sip_uri_calling_preference` to `"unrestricted"` (or `"internal"`) now if you intend to dial SIP URIs — it defaults to `"disabled"`.

Key SIP connection parameters:
| Parameter | Purpose |
|---|---|
| `user_name`, `password` | **Required.** Credentials for the connection itself |
| `connection_name` | **Required.** Friendly name |
| `sip_uri_calling_preference` | `"disabled"` (default), `"unrestricted"`, or `"internal"` — controls URI dialing |
| `outbound.outbound_voice_profile_id` | Controls caller ID policy for outbound calls |
| `active` | Enable/disable the connection |

#### There is no `webrtc_enabled` flag, and no subdomain, on this endpoint

Older guidance (including earlier revisions of this file) told you to send `webrtc_enabled: true` and `inbound.sip_subdomain` / `inbound.sip_subdomain_receive_settings` when creating the connection. **Do not.** Measured against the live API:

- `POST /v2/credential_connections` with those three fields returns **201 Created** — but a subsequent `GET` returns them as `null`/absent. A follow-up `PATCH`, both nested under `inbound` and at the top level, returns **200 OK** and they remain unset.
- `GET /v2/credential_connections` and `GET /v2/credential_connections/{id}` do not include `webrtc_enabled`, `sip_subdomain`, or `sip_subdomain_receive_settings` in the response body at all — the keys are absent, not null.
- None of the three fields appear in the request or response schema for `POST`, `PATCH`, or `GET /credential_connections` (see `sdk-reference/{language}/sip.md`, which is generated from the Telnyx OpenAPI spec).

They are accepted and **silently discarded**. The failure mode is nasty: the API says 201, so your provisioning script reports success, and you proceed believing you enabled WebRTC and reserved a subdomain. You did not.

**Consequences for the rest of this guide:**

1. **You do not need to "enable WebRTC."** A credential connection serves WebRTC clients as soon as it has a telephony credential on it. There is no flag to set — the reason there is no `webrtc_enabled` parameter is that there is nothing to enable.
2. **Address WebRTC clients at `sip.telnyx.com`, not at a per-app subdomain.** Every SIP URI in this document uses the bare `sip.telnyx.com` host for that reason.

> **Beware: `*.sip.telnyx.com` is a DNS wildcard.** Any label resolves — `dig +short my-app.sip.telnyx.com` and `dig +short zzz-does-not-exist-9f3.sip.telnyx.com` both return the same A record (`192.76.120.10` at time of writing). So a URI built against a subdomain you never provisioned will resolve, connect, and then fail at the SIP layer with no DNS error to point at the cause. Do not treat "the hostname resolves" as evidence that a subdomain exists.
>
> Telnyx SIP subdomains *are* a real product feature, configurable in Mission Control Portal → **SIP** → **Connections**. What is documented here is only that they are **not settable through the `/v2/credential_connections` JSON API**. If you need one, provision it in the Portal and confirm registration before relying on it; this guide does not use them.

### 2. Create SIP Credentials (replaces Access Token generation)

```bash
curl -X POST https://api.telnyx.com/v2/telephony_credentials \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "YOUR_CONNECTION_ID",
    "name": "web-user-1"
  }'
```

Response includes `sip_username` and `sip_password`. These can be used directly by the client SDK — no backend token exchange required.

**Capture `sip_username` from this response and store it.** It is server-assigned (an opaque `gencred…` string), it is *not* the `name` you sent, and it is the only value that will route a SIP call to this client. See [Identity-Based Routing](#identity-based-routing-twilio-client--telnyx-sip-credential).

For JWT-based auth (optional, more secure):
```bash
curl -X POST "https://api.telnyx.com/v2/telephony_credentials/YOUR_CREDENTIAL_ID/token" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### 3. Swap the Client SDK

```bash
# Twilio (remove)
npm remove @twilio/voice-sdk

# Telnyx (add)
npm install @telnyx/webrtc
```

**No bundler? Load it from a CDN.** `@telnyx/webrtc` ships a UMD bundle as its package `main` (`lib/bundle.js`), so the standard npm CDNs serve it directly — there is no Telnyx-hosted CDN URL:

```html
<!-- unpkg (pin the version) -->
<script src="https://unpkg.com/@telnyx/webrtc@2.27.8/lib/bundle.js"></script>

<!-- or jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/@telnyx/webrtc@2.27.8/lib/bundle.js"></script>
```

Pin an explicit version in production. Omitting it (`https://unpkg.com/@telnyx/webrtc/lib/bundle.js`) resolves to `latest` and will silently move under you.

**CDN vs npm — critical pitfall:**

| Method | Import |
|---|---|
| npm/bundler | `import { TelnyxRTC } from '@telnyx/webrtc'` — use `TelnyxRTC` directly |
| CDN script | `<script src="https://unpkg.com/@telnyx/webrtc@2.27.8/lib/bundle.js">` — use `TelnyxWebRTC.TelnyxRTC` (double namespace!) |

The bundle's UMD wrapper attaches a single global named `TelnyxWebRTC`, and the SDK classes hang off it (`TelnyxWebRTC.TelnyxRTC`, `TelnyxWebRTC.PreCallDiagnosis`). There is no bare `TelnyxRTC` global:

```javascript
// CDN: INCORRECT (throws "TelnyxRTC is not defined")
const client = new TelnyxRTC({ login_token: token });

// CDN: CORRECT
const client = new TelnyxWebRTC.TelnyxRTC({ login_token: token });

// Destructure once if you prefer the bundler-style name:
const { TelnyxRTC } = TelnyxWebRTC;
const client2 = new TelnyxRTC({ login_token: token });
```

### 4. Update Client Code

See the side-by-side comparison in [Client SDK Setup](#client-sdk-setup) below.

### 5. Update Push Notification Configuration (Mobile)

If your mobile app uses VoIP push notifications:

| Platform | Twilio | Telnyx |
|---|---|---|
| iOS | Register with `device.register(accessToken)` | Create an iOS Mobile Push Credential through the API or Portal, then attach it to the Credential Connection |
| Android | Use FCM with Twilio's `handleMessage()` | Create an Android Mobile Push Credential from the full Firebase service-account JSON, attach it to the Credential Connection, then use FCM with Telnyx's `handlePushNotification()` |

## Authentication Flow Comparison

### Twilio (requires backend)

```javascript
// Backend: generate Access Token
const AccessToken = require('twilio').jwt.AccessToken;
const VoiceGrant = new AccessToken.VoiceGrant({
  outgoingApplicationSid: 'AP...',
  incomingAllow: true
});
const token = new AccessToken('AC...', 'SK...', 'secret');
token.addGrant(voiceGrant);
token.identity = 'user-123';
return token.toJwt();
```

```javascript
// Client: connect with token from backend
const { Device } = require('@twilio/voice-sdk');
const response = await fetch('/api/token');
const { token } = await response.json();
const device = new Device(token);
await device.register();
```

### Telnyx (direct connection)

```javascript
// Client: connect directly with SIP credentials
const { TelnyxRTC } = require('@telnyx/webrtc');
const client = new TelnyxRTC({
  login: 'sip_username',
  password: 'sip_password'
});
client.connect();
```

Or with JWT:
```javascript
const client = new TelnyxRTC({
  login_token: 'jwt_token_from_api'
});
client.connect();
```

## Client SDK Setup

### JavaScript (Browser)

```javascript
// Twilio
import { Device } from '@twilio/voice-sdk';
const token = await fetchTokenFromBackend();
const device = new Device(token);
await device.register();

device.on('incoming', (call) => {
  call.accept();
});

const call = await device.connect({
  params: { To: '+15559876543' }
});

call.on('disconnect', () => console.log('Call ended'));
call.disconnect();
```

```javascript
// Telnyx
import { TelnyxRTC } from '@telnyx/webrtc';
const client = new TelnyxRTC({
  login: 'sip_username',
  password: 'sip_password'
});

// IMPORTANT: Set audio element for remote audio playback
client.remoteElement = document.getElementById('remoteAudio');

client.connect();

client.on('telnyx.notification', (notification) => {
  if (notification.type === 'callUpdate' &&
      notification.call.state === 'ringing' &&
      notification.call.direction === 'inbound') {
    notification.call.answer();
  }
});

const call = client.newCall({
  destinationNumber: '+15559876543',
  callerNumber: '+15551234567'
});

call.on('hangup', () => console.log('Call ended'));
call.hangup();
```

## Call Management

| Action | Twilio | Telnyx |
|---|---|---|
| Make call | `device.connect({params: {To: num}})` | `client.newCall({destinationNumber: num})` |
| Answer call | `call.accept()` | `call.answer()` |
| Hang up | `call.disconnect()` | `call.hangup()` |
| Mute | `call.mute(true)` | `call.muteAudio()` |
| Unmute | `call.mute(false)` | `call.unmuteAudio()` |
| Check mute | `call.isMuted()` | *Track manually* — no built-in method |
| Hold | Not built-in | `call.hold()` |
| Unhold | Not built-in | `call.unhold()` |
| Send DTMF | `call.sendDigits('1')` | `call.dtmf('1')` |
| Transfer | Not built-in | *No client method* — use the server-side Call Control `transfer` command |

Telnyx provides built-in client-side hold and unhold. Call transfer is not a client SDK method on the `Call` object — it is performed server-side via the Call Control API `transfer` command.

## Token and Credential Management

### Credential Lifecycle: Stable Per User; JWT Per Session

**Twilio pattern** (per-call): Twilio documentation suggests creating a new Access Token for each call or short session. Tokens expire quickly (typically 1 hour).

**Telnyx pattern**: provision one telephony credential per durable user/agent, store its ID and server-assigned `sip_username`, and mint short-lived JWTs from that same credential for each login or refresh. Do not create a new telephony credential for every call or token refresh: that changes the routable SIP identity and leaves old credentials active.

```javascript
import { TelnyxRTC, SwEvent, TELNYX_WARNING_CODES } from '@telnyx/webrtc';

class TelnyxSession {
  constructor() {
    this.client = null;
    this.refreshPromise = null;
  }

  async initialize() {
    // The backend looks up this signed-in user's existing credential and mints
    // a JWT from it. It does not create another telephony credential.
    const { token } = await fetch('/api/telnyx/token', { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
        return r.json();
      });

    this.client = new TelnyxRTC({ login_token: token });
    this.client.remoteElement = document.getElementById('remoteAudio');
    this.client.on(SwEvent.Warning, ({ warning }) => {
      if (warning.code === TELNYX_WARNING_CODES.TOKEN_EXPIRING_SOON) {
        void this.refreshToken();
      }
    });
    this.client.connect();
  }

  refreshToken() {
    // The SDK emits TOKEN_EXPIRING_SOON roughly 120 seconds before expiry.
    // Re-authenticate the existing socket so active calls are not torn down.
    if (!this.refreshPromise) {
      this.refreshPromise = fetch('/api/telnyx/token', { method: 'POST' })
        .then(r => {
          if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
          return r.json();
        })
        .then(({ token }) => this.client.login({
          creds: { login_token: token }
        }))
        .finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }
}
```

**Server-side provisioning and JWT generation:**

Create the telephony credential once when provisioning the user, then persist both its `id` and `sip_username`. The login/refresh endpoint only generates a JWT from the persisted credential ID.

```javascript
// Provisioning path — run once per user/agent, not on login or refresh.
async function provisionVoiceIdentity(userId) {
  const Telnyx = require('telnyx');
  const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
  const credential = await client.telephonyCredentials.create({
    connection_id: process.env.TELNYX_CONNECTION_ID,
    name: `user-${userId}`
  });
  await db.voiceIdentities.insert({
    userId,
    credentialId: credential.data.id,
    sipUsername: credential.data.sip_username
  });
}

// Login/refresh path — authenticate the app user before issuing a token.
app.post('/api/telnyx/token', async (req, res) => {
  const Telnyx = require('telnyx');
  const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
  const identity = await db.voiceIdentities.findByUserId(req.user.id);
  if (!identity) return res.sendStatus(404);

  const token = await client.telephonyCredentials.createToken(
    identity.credentialId
  );
  res.json({ token });
});
```

```python
# Flask endpoint (Python)
import os
from telnyx import Telnyx
from flask import Flask, jsonify, request

app = Flask(__name__)
client = Telnyx(api_key=os.environ.get('TELNYX_API_KEY'))

@app.route('/api/telnyx/token', methods=['POST'])
def create_token():
    # Authenticate the application user first, then look up the credential ID
    # created during provisioning. Do not create a credential in this handler.
    identity = db.voice_identities.find_by_user_id(request.user_id)
    if identity is None:
        return '', 404
    credential_id = identity.credential_id
    token = client.telephony_credentials.create_token(
        credential_id
    )
    return jsonify({'token': token})
```

> **Note**: If `create_token()` is not available in your SDK version, use the REST API directly:
> ```python
> import requests
> resp = requests.post(
>     f"https://api.telnyx.com/v2/telephony_credentials/{credential_id}/token",
>     headers={"Authorization": f"Bearer {os.environ['TELNYX_API_KEY']}"}
> )
> token = resp.text  # JWT string returned directly
> ```

### Environment Variables Mapping

| Twilio | Telnyx | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `TELNYX_API_KEY` | Bearer token, not Basic Auth |
| `TWILIO_API_SECRET` | *(not needed)* | Single key for auth |
| `TWILIO_TWIML_APP_SID` | `TELNYX_CONNECTION_ID` | SIP Connection ID |
| `TWILIO_CALLER_ID` | `TELNYX_PHONE_NUMBER` | Must be in Outbound Voice Profile |
| *(none)* | `TELNYX_CREDENTIAL_ID` | For SIP credential auth |

> **Complete credential CRUD examples** are in `sdk-reference/{language}/webrtc.md`.

## Platform-Specific Guides

For native mobile platform migration (iOS, Android, React Native, Flutter), including push notification setup, CallKit/ConnectionService integration, and per-platform code examples, see `{baseDir}/references/mobile-sdk-migration.md`. The server-side credential management is covered in `sdk-reference/{language}/webrtc.md`.

## Contact Center / PBX Patterns

These patterns apply when migrating Twilio-based contact centers, PBX systems, or multi-party call applications. They address architectural differences that are unique to Telnyx.

### Conferences Are Not Always Necessary

**Twilio pattern**: Conferences are required for any scenario with more than 2 call legs or where you need supervisor features (listen, whisper, barge). Even simple call transfers often use conferences.

**Telnyx pattern**: Conferences are only needed for true multi-party audio (3+ participants).

> **`supervisorRole` is not a TeXML attribute.** For a conference, set
> `supervisor_role: barge | whisper | monitor` when joining the participant. For
> a bridged Call Control call, create the supervisor leg with
> `supervise_call_control_id` and `supervisor_role`; `switchSupervisorRole`
> changes an already-established supervisor leg and cannot create one.

```javascript
// Twilio: requires conference for supervisor
// Supervisor joins a conference room where the agent and customer are already connected

// Telnyx: establish a supervisor leg for the bridged call first. Refresh the
// per-minute price from the current Telnyx pricing source immediately before
// this action; these environment values are approvals, not hard-coded prices.
const maxDurationSeconds = 60;
const currentPricePerMinute = Number(process.env.TELNYX_CURRENT_VOICE_PRICE_USD_PER_MINUTE);
const approvedMaxUsd = Number(process.env.TELNYX_APPROVED_SUPERVISOR_MAX_USD);
const estimatedMaxUsd = currentPricePerMinute * (maxDurationSeconds / 60);
if (!Number.isFinite(currentPricePerMinute) || currentPricePerMinute <= 0 ||
    !Number.isFinite(approvedMaxUsd) || approvedMaxUsd < estimatedMaxUsd) {
  throw new Error('Missing current price or sufficient maximum-spend approval');
}
const supervisorApproval = [
  process.env.TELNYX_CONNECTION_ID,
  telnyxNumber,
  supervisorNumber,
  agentCallControlId,
  'monitor',
  `${maxDurationSeconds}s`,
  `price:${currentPricePerMinute}`,
  `max:${approvedMaxUsd}`
].join('|');
if (process.env.TELNYX_APPROVE_SUPERVISOR_DIAL !== supervisorApproval) {
  throw new Error(`Supervisor dial not approved; expected ${supervisorApproval}`);
}
const supervisor = await client.calls.dial({
  connection_id: process.env.TELNYX_CONNECTION_ID,
  to: supervisorNumber,
  from: telnyxNumber,
  supervise_call_control_id: agentCallControlId,
  supervisor_role: 'monitor',
  // Provider-enforced ceiling: remains effective if this process exits or its
  // event loop stalls. The local timer below is only an earlier fallback.
  time_limit_secs: maxDurationSeconds
});
const supervisorCallId = supervisor.data.call_control_id;
const supervisorTimeout = setTimeout(() => {
  client.calls.actions.hangup(supervisorCallId).catch(console.error);
}, maxDurationSeconds * 1000);

// Later, switch the role of that established supervisor leg.
await client.calls.actions.switchSupervisorRole(supervisorCallId, {
  role: 'barge'  // 'whisper' | 'barge' | 'monitor'
});
// Clear only after another path has definitively ended the supervisor leg.
// clearTimeout(supervisorTimeout);
```

**When you DO need conferences on Telnyx:**
- 3+ participants need to hear each other
- Dynamic participant management (add/remove callers)
- Conference recording with mixed audio

**When you DON'T need conferences (use bridge/dial instead):**
- Simple call transfers
- Two-party bridged calls with an explicitly established Call Control supervisor leg
- Warm transfers (bridge, then drop the transferring agent)

> **Complete conference API examples** (CRUD, participant management with `supervisor_role`/`whisper_call_control_ids`/`mute`/`hold`, recording) are in `sdk-reference/{language}/voice-conferencing.md`. Supervisor role switching and `client_state` on all commands are in `sdk-reference/{language}/voice-advanced.md`.

### Passing Data from WebRTC Client to Voice API Backend

**Problem**: The WebRTC SDK's `client_state` parameter on `newCall()` does NOT propagate to the Call Control API webhook. This is a common surprise for Twilio migrants who expect data set on the client to appear in server webhooks.

**Solution**: Use custom SIP headers to pass data from the WebRTC client to your backend:

```javascript
// Client-side: pass custom data via SIP headers
const call = client.newCall({
  destinationNumber: '+15559876543',
  callerNumber: '+15551234567',
  customHeaders: [
    { name: 'X-Account-Id', value: '12345' },
    { name: 'X-User-Tier', value: 'premium' },
    { name: 'X-Department', value: 'sales' }
  ]
});
```

```javascript
// Server-side: read custom headers from the webhook
app.post('/webhook', (req, res) => {
  const event = req.body.data;
  const sipHeaders = event.payload.sip_headers || [];

  // Headers arrive as array of {name, value} objects
  const accountId = sipHeaders.find(h => h.name === 'X-Account-Id')?.value;
  const userTier = sipHeaders.find(h => h.name === 'X-User-Tier')?.value;

  // Route based on custom data
  if (userTier === 'premium') {
    // Priority routing
  }
});
```

Custom headers prefixed with `X-` are passed through to Call Control webhooks. This enables:
- Account/user identification without a database lookup
- Priority routing based on client-side context
- Department-based call routing
- Custom metadata for analytics

> Android and Flutter SDKs support template variable mapping in custom headers (`{{variable_name}}`). See Telnyx developer docs for platform-specific examples.

### URI Dialing

To enable dialing SIP URIs (not just PSTN numbers) from WebRTC clients, enable URI dialing on the SIP connection:

```bash
curl -X PATCH "https://api.telnyx.com/v2/credential_connections/YOUR_CONN_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sip_uri_calling_preference": "unrestricted"}'
```

Then dial SIP URIs from the client. To reach another Telnyx WebRTC client, the local part is that credential's `sip_username` and the host is `sip.telnyx.com`:
```javascript
const call = client.newCall({
  destinationNumber: 'sip:gencredSVEXqVZWBK6kf8TBHeMy2yBhgrKlUeBV0I90pYXXTt@sip.telnyx.com'
});
```
External SIP endpoints you operate are dialled at their own host as usual (e.g. `sip:agent@pbx.example.com`).

Settings for `sip_uri_calling_preference`:
- `disabled` — only PSTN dialing allowed (default)
- `unrestricted` — dial any SIP URI
- `internal` — only dial URIs within your Telnyx connections

### Identity-Based Routing (Twilio `<Client>` → Telnyx SIP credential)

Twilio's `<Client>identity</Client>` routes to a WebRTC user by an identity string **you chose**. Telnyx has no such concept. This is the single largest architectural gap in the WebRTC migration, and getting it wrong produces a call that fails silently at connect time.

#### The credential `name` is a label. It is NOT the SIP identity.

`POST /v2/telephony_credentials` accepts an optional `name`, but the routable identity is the **server-assigned `sip_username`** in the response — an opaque `gencred…` string you cannot choose or predict.

```bash
curl -X POST https://api.telnyx.com/v2/telephony_credentials \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "YOUR_CONNECTION_ID", "name": "support_agent"}'
```

```jsonc
// 201 Created — actual measured response (abridged)
{
  "data": {
    "id": "0ccc7b76-…",
    "name": "support_agent",                                          // your label
    "sip_username": "gencredSVEXqVZWBK6kf8TBHeMy2yBhgrKlUeBV0I90pYXXTt", // the identity
    "sip_password": "…",
    "connection_id": "YOUR_CONNECTION_ID"
  }
}
```

Across every credential on a real account, `name` and `sip_username` never match — `sip_username` is always a random `gencred…` token. **You must read `sip_username` out of the create response and persist it.** You cannot derive it, template it, or reconstruct it later from the name.

```
DO NOT:  sip:support_agent@your-subdomain.sip.telnyx.com     ← unroutable, fails silently
DO:      sip:gencredSVEXqVZWBK6kf8TBHeMy2yBhgrKlUeBV0I90pYXXTt@sip.telnyx.com
```

Two independent things are wrong in the "DO NOT" line: the local part is the label instead of `sip_username`, and the host is a subdomain that [cannot be provisioned through the API](#there-is-no-webrtc_enabled-flag-and-no-subdomain-on-this-endpoint). Both resolve at DNS (the wildcard) and both fail at the SIP layer, so the browser shows a call that rings and dies with no useful error.

#### The replacement pattern: keep an identity → sip_username directory

Twilio let you *name* the destination at dial time. On Telnyx you must *look it up*. Store the mapping when you mint the credential:

```javascript
// Server: provision an agent ONCE, persist the mapping
async function provisionAgent(identity) {          // identity = 'agent_jane'
  const cred = await telnyx.telephonyCredentials.create({
    connection_id: process.env.TELNYX_CONNECTION_ID,
    name: identity,                                 // label only — for humans in the Portal
  });

  await db.agents.upsert({
    identity,                                       // what your app calls the agent
    credential_id:  cred.data.id,
    sip_username:   cred.data.sip_username,         // REQUIRED — the routable identity
    sip_uri: `sip:${cred.data.sip_username}@sip.telnyx.com`,
  });
  return cred.data;
}

// Anywhere you used to write <Client>agent_jane</Client>, resolve first:
async function sipUriFor(identity) {
  const agent = await db.agents.findOne({ identity });
  if (!agent) throw new Error(`No Telnyx credential provisioned for "${identity}"`);
  return agent.sip_uri;
}

// Expose the directory through an authenticated backend route. Apply your
// application's authorization policy before revealing or dialing an identity.
app.get('/api/voice-identities/:identity', async (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (!req.user.allowedVoiceIdentities.includes(req.params.identity)) {
    return res.sendStatus(403);
  }
  res.json({ sip_uri: await sipUriFor(req.params.identity) });
});
```

```python
# Server: same pattern in Python
def provision_agent(identity: str):
    cred = client.telephony_credentials.create(
        connection_id=os.environ['TELNYX_CONNECTION_ID'],
        name=identity,                              # label only
    )
    db.agents.upsert(
        identity=identity,
        credential_id=cred.data.id,
        sip_username=cred.data.sip_username,        # the routable identity
        sip_uri=f"sip:{cred.data.sip_username}@sip.telnyx.com",
    )
    return cred.data


def sip_uri_for(identity: str) -> str:
    agent = db.agents.find_one(identity=identity)
    if not agent:
        raise LookupError(f'No Telnyx credential provisioned for "{identity}"')
    return agent.sip_uri
```

Lost the `sip_username` for an existing credential? Re-read it — `GET /v2/telephony_credentials/{id}` and `GET /v2/telephony_credentials` both return it. Match on `name` to recover the mapping, then persist it so you never have to scan again.

#### Now pick a replacement by leg direction

**Twilio (one pattern for everything):**
```python
@app.route('/voice', methods=['POST'])
def voice():
    resp = VoiceResponse()
    dial = resp.dial(caller_id='+15551234567')
    dial.client('agent_jane')      # works for browser-originated AND PSTN-originated legs
    return str(resp)
```

**Telnyx (A) browser-originated — delete the endpoint, dial from the client:**
```javascript
// bobClient is already connected in the browser
const identityResponse = await fetch('/api/voice-identities/agent_jane');
if (!identityResponse.ok) {
  throw new Error(`Identity lookup failed: ${identityResponse.status}`);
}
const { sip_uri: destinationNumber } = await identityResponse.json();
const call = bobClient.newCall({
  destinationNumber,   // sip:gencred…@sip.telnyx.com
  callerNumber: '+15551234567',
});
```

**Telnyx (B) PSTN-originated — keep the endpoint, return TeXML with `<Dial><Sip>`:**

There is no `client.newCall()` on an inbound PSTN leg, so this endpoint **cannot** be deleted. Serve TeXML instead:

```python
import os
import base64
import time
from nacl.signing import VerifyKey
from xml.sax.saxutils import escape

def verify_telnyx_form_webhook(raw_body: bytes, headers) -> None:
    timestamp = headers.get('telnyx-timestamp', '')
    signature = headers.get('telnyx-signature-ed25519', '')
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        raise ValueError('stale or invalid webhook timestamp')
    VerifyKey(base64.b64decode(os.environ['TELNYX_PUBLIC_KEY'])).verify(
        timestamp.encode('ascii') + b'|' + raw_body,
        base64.b64decode(signature),
    )

@app.route('/voice', methods=['POST'])
def voice():
    raw_body = request.get_data(cache=True, as_text=False)
    try:
        verify_telnyx_form_webhook(raw_body, request.headers)
    except Exception:
        return 'Forbidden', 403
    uri = sip_uri_for('agent_jane')            # sip:gencred…@sip.telnyx.com
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="+15551234567">
    <Sip>{escape(uri)}</Sip>
  </Dial>
</Response>""", 200, {'Content-Type': 'text/xml'}
```

```javascript
const crypto = require('crypto');
function verifyTelnyxFormWebhook(rawBody, headers) {
  const timestamp = headers['telnyx-timestamp'] || '';
  const signature = headers['telnyx-signature-ed25519'] || '';
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error('stale or invalid webhook timestamp');
  }
  const rawKey = Buffer.from(process.env.TELNYX_PUBLIC_KEY, 'base64');
  if (rawKey.length !== 32) throw new Error('invalid Telnyx public key');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]);
  const signed = Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]);
  if (!crypto.verify(null, signed, { key: spki, format: 'der', type: 'spki' }, Buffer.from(signature, 'base64'))) {
    throw new Error('invalid Telnyx webhook signature');
  }
}
function escapeXmlText(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}
app.use(express.urlencoded({
  extended: false,
  verify: (req, _res, buffer) => { req.rawBody = buffer; },
}));

app.post('/voice', async (req, res) => {
  try {
    verifyTelnyxFormWebhook(req.rawBody, req.headers);
  } catch (_error) {
    return res.status(403).send('Forbidden');
  }
  const uri = await sipUriFor('agent_jane');
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="+15551234567">
    <Sip>${escapeXmlText(uri)}</Sip>
  </Dial>
</Response>`);
});
```

`<Sip>` is a supported TeXML noun inside `<Dial>` (see `{baseDir}/references/texml-verbs.md`). To ring several agents and let the first answer win, emit multiple `<Sip>` elements inside one `<Dial>` — that is the TeXML equivalent of Twilio's multiple `<Client>` children.

**Key mapping:**

| Twilio | Telnyx |
|---|---|
| `token.identity = 'agent_jane'` | Credential `sip_username` (server-assigned) — `name: 'agent_jane'` is a **label only** |
| Identity is chosen by you | Identity is assigned by Telnyx; read it from the create response |
| `<Dial><Client>agent_jane</Client></Dial>`, browser leg | `client.newCall({destinationNumber: 'sip:' + sipUsername + '@sip.telnyx.com'})` |
| `<Dial><Client>agent_jane</Client></Dial>`, PSTN leg | `<Dial><Sip>sip:{sip_username}@sip.telnyx.com</Sip></Dial>` |
| Multiple `<Client>` children (ring group) | Multiple `<Sip>` children inside one `<Dial>` |
| Identity set at token creation, per session | `sip_username` fixed at credential creation, stable for the credential's life |

**Setup requirements:**
1. Enable URI dialing on your connection: `sip_uri_calling_preference: "unrestricted"` (or `"internal"` for same-connection only). It defaults to `"disabled"`, which blocks all of the above.
2. Create one credential per user/agent. Set `name` to your identity string so the Portal is readable — but route on `sip_username`.
3. Persist `identity → sip_username` at provisioning time. This mapping table is new work with no Twilio counterpart; budget for it.
4. Address clients at `sip.telnyx.com`. Do not put a subdomain in the URI unless you provisioned one in the Portal and verified registration.

### Call Parking and Outbound Call Handling

There is no Call Control `park` action. For server-controlled WebRTC outbound flows, enable `outbound.call_parking_enabled` on the Credential Connection. A browser-originated call is then parked into Call Control and delivered to the connection's webhook, where your backend can issue supported commands. To join two existing Call Control legs, use the bridge action:

```javascript
await client.calls.actions.bridge(waitingCallControlId, {
  call_control_id_to_bridge_with: agentCallControlId
});
```

If call parking is disabled, the WebRTC SDK's outbound call follows the connection's normal outbound routing instead; do not write application logic that assumes a nonexistent `park` endpoint.

**Outbound call handling** — for progressive/predictive dialer patterns:
```javascript
// Initiate outbound call
const { data: call } = await telnyx.calls.create({
  connection_id: process.env.TELNYX_CONNECTION_ID,
  to: '+15559876543',
  from: '+15551234567',
  webhook_url: 'https://your-server.com/outbound-events'
});

// When answered, bridge to the waiting agent's WebRTC call
// Use bridge_on_answer for automatic bridging (see voice-migration.md)
```

> **Complete voice API reference** including dial (`bridge_on_answer`, `link_to`, `park_after_unbridge`, `supervisor_role`, `sip_headers`, `custom_headers`), bridge, conference actions, and all webhook payload schemas are in the sdk-reference files: `sdk-reference/{language}/voice.md`, `voice-advanced.md`, and `voice-conferencing.md`.

## SDK Reference

For complete API reference with all parameters and response schemas, see the bundled sdk-reference files:

| Resource | SDK Reference File |
|---|---|
| Server-side credentials | `sdk-reference/{language}/webrtc.md` |
| Voice API (Call Control) | `sdk-reference/{language}/voice.md` |
| SIP Connections | `sdk-reference/{language}/sip.md` |

Platform-specific client SDKs (iOS, Android, Flutter, React Native) are covered in `{baseDir}/references/mobile-sdk-migration.md`.

### Push Notification Credential Migration

When migrating push notifications from Twilio to Telnyx, push credentials can be managed **either via the API or the Mission Control Portal**.

**Via API** — create a push credential with `POST /v2/mobile_push_credentials`. The request body is a **`oneOf` split by platform** (per the Telnyx OpenAPI spec):

| Platform | `type` | Required fields |
|---|---|---|
| iOS (APNs) | `"ios"` | `type`, `certificate`, `private_key`, `alias` |
| Android (FCM) | `"android"` | `type`, `project_account_json_file`, `alias` |

Android does **not** take `certificate`/`private_key` — it takes the FCM service-account JSON as the `project_account_json_file` object. List with `GET /v2/mobile_push_credentials`, fetch/delete with `GET`/`DELETE /v2/mobile_push_credentials/{push_credential_id}`.

**Via Portal** — creation and attachment are separate steps:

1. Create the platform credential under **API Keys** → **Credentials** → **Add** → **iOS Credential** or **Android Credential**. Paste the complete PEM certificate/key for iOS or the full Firebase service-account JSON for Android.
2. Attach it under **SIP Connections** → open the connection → **WebRTC** → select the credential in the iOS and/or Android section → **Save**.

> **Creating the credential is not enough — you must ATTACH it to the WebRTC
> connection.** A standalone push credential delivers nothing: until it is linked,
> background inbound calls receive no APNs/FCM notification. Attach the returned
> credential id via `PATCH /v2/credential_connections/{id}`. Send only the
> field for the platform you are configuring.
>
> Use this helper for either platform. It retrieves the current assignment,
> displays the exact replacement, and requires approval bound to the connection,
> field, old credential, and new credential before changing live push routing:
>
> ```bash
> attach_push_credential() {
>   field="$1" new_id="$2"
>   case "$field" in ios_push_credential_id|android_push_credential_id) ;; *) return 2 ;; esac
>   test -n "$CONNECTION_ID" -a -n "$new_id" || return 2
>   current_id=$(curl -fsS \
>     -H "Authorization: Bearer $TELNYX_API_KEY" \
>     "https://api.telnyx.com/v2/credential_connections/$CONNECTION_ID" |
>     jq -er --arg field "$field" '.data[$field] // ""') || return 1
>   test "$current_id" = "$new_id" && return 0
>   approval="$CONNECTION_ID|$field|$current_id|$new_id"
>   printf 'Replace %s on connection %s: %s -> %s\n' \
>     "$field" "$CONNECTION_ID" "${current_id:-<unset>}" "$new_id"
>   test "${TELNYX_APPROVE_PUSH_CREDENTIAL_REPLACEMENT:-}" = "$approval" || {
>     echo "Push credential replacement not approved" >&2; return 1;
>   }
>   jq -n --arg field "$field" --arg id "$new_id" '{($field): $id}' |
>     curl -fsS -X PATCH \
>       "https://api.telnyx.com/v2/credential_connections/$CONNECTION_ID" \
>       -H "Authorization: Bearer $TELNYX_API_KEY" \
>       -H "Content-Type: application/json" --data-binary @-
> }
>
> attach_push_credential ios_push_credential_id "$IOS_PUSH_CREDENTIAL_ID"
> attach_push_credential android_push_credential_id "$ANDROID_PUSH_CREDENTIAL_ID"
> ```
>
> If you ship both platforms, set both fields by running both requests or by
> including both non-null credential IDs in one PATCH.
>
> Verify with `GET /v2/credential_connections/{id}` — the credential field for
> each platform you actually deploy must be non-null (`ios_push_credential_id`
> for an iOS app, `android_push_credential_id` for Android; both only if you
> ship both).

The Portal flow has the same requirement: creating a credential under **API Keys** → **Credentials** does not attach it until it is selected and saved on the connection's **WebRTC** tab.

```bash
# iOS (APNs)
curl -X POST https://api.telnyx.com/v2/mobile_push_credentials \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ios",
    "alias": "my-app-voip",
    "certificate": "-----BEGIN CERTIFICATE----- ...",
    "private_key": "-----BEGIN PRIVATE KEY----- ..."
  }'

# Android (FCM) — wrap the complete service-account JSON object
jq '{type:"android", alias:"my-app-fcm", project_account_json_file:.}' path/to/service-account.json |
  curl -X POST https://api.telnyx.com/v2/mobile_push_credentials \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

**iOS (APNs):**
- Twilio: Configured per-credential via API, certificate uploaded programmatically
- Telnyx: Create the credential with `POST /v2/mobile_push_credentials`, or under Portal → **API Keys** → **Credentials** → **Add** → **iOS Credential**; then attach it under **SIP Connections** → connection → **WebRTC** → iOS
- Requires: a **VoIP Services Certificate exported as `.p12`** and converted to the complete certificate/private-key PEM values. A `.p8` auth token key is unsupported by this flow. The Bundle ID is used to create and validate the Apple certificate; it is not a Telnyx request field. See `mobile-sdk-migration.md` for the exact OpenSSL commands.

**Android (FCM):**
- Twilio: Configured per-credential via API with FCM server key
- Telnyx: Create the credential with `POST /v2/mobile_push_credentials` using `type: "android"` and the full service-account JSON as `project_account_json_file`, or under Portal → **API Keys** → **Credentials** → **Add** → **Android Credential**; then attach it under **SIP Connections** → connection → **WebRTC** → Android
- Requires: the complete Firebase service-account JSON (`project_account_json_file`), not a legacy FCM server key

**Key difference**: Twilio requires a new push credential for each instance. Telnyx configures push at the connection level, applying to all credentials on that connection.
