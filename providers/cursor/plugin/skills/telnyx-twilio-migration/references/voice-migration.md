# Voice Migration: TwiML to TeXML

Step-by-step guide for migrating Twilio TwiML-based voice applications to Telnyx TeXML.

## Table of Contents

- [Overview](#overview)
- [Step 1: Create a Telnyx Account](#step-1-create-a-telnyx-account)
- [Step 2: Create a TeXML Application](#step-2-create-a-texml-application)
- [Step 3: Configure Webhook URLs](#step-3-configure-webhook-urls)
- [Step 4: Purchase or Port Phone Numbers](#step-4-purchase-or-port-phone-numbers)
- [Step 5: Update API Endpoints](#step-5-update-api-endpoints)
- [Step 6: Update Authentication](#step-6-update-authentication)
- [Step 7: Update Webhook Signature Validation](#step-7-update-webhook-signature-validation)
- [TeXML Bins](#texml-bins)
- [Testing Your Migration](#testing-your-migration)
- [Webhook Differences](#webhook-differences)
- [REST API Mapping](#rest-api-mapping)
- [Call Control API (Alternative to TeXML)](#call-control-api-alternative-to-texml)
- [Advanced Voice Patterns](#advanced-voice-patterns)

## Overview

TeXML is Telnyx's TwiML-compatible markup language. Most TwiML documents work with Telnyx with these changes:

1. API base URL: `api.twilio.com` → `api.telnyx.com/v2/texml/Accounts/{account_sid}`
2. Authentication: Basic Auth → Bearer Token
3. Webhook signatures: HMAC-SHA1 → Ed25519
4. Webhook payloads: same top-level structure for TeXML callbacks

Your XML voice documents (`<Response>`, `<Say>`, `<Gather>`, etc.) generally require **no changes**.

**TwiML builder classes → raw XML strings**: Twilio provides helper classes (`VoiceResponse` in Python, `twiml.VoiceResponse` in Node) that generate XML programmatically. Telnyx has no equivalent builder — return raw XML strings from your webhook endpoint instead:

```python
# Twilio (builder class)
from twilio.twiml.voice_response import VoiceResponse
resp = VoiceResponse()
resp.say('Hello')
gather = resp.gather(num_digits=1, action='/handle-key')
gather.say('Press 1 for sales')
return str(resp)

# Telnyx (raw XML string — same XML, just no builder)
return '''<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello</Say>
  <Gather numDigits="1" action="/handle-key">
    <Say>Press 1 for sales</Say>
  </Gather>
</Response>'''
```

```javascript
// Twilio (builder)
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const resp = new VoiceResponse();
resp.say('Hello');
const gather = resp.gather({ numDigits: 1, action: '/handle-key' });
gather.say('Press 1 for sales');
res.type('text/xml').send(resp.toString());

// Telnyx (raw XML — same output)
res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello</Say>
  <Gather numDigits="1" action="/handle-key">
    <Say>Press 1 for sales</Say>
  </Gather>
</Response>`);
```

The XML content is identical — only the generation method changes. For a complete verb reference, see `{baseDir}/references/texml-verbs.md`.

**Keep the generated lines lint-friendly**: a raw TeXML string written inline as a single argument to `res.send(...)` easily runs past 80–120 characters, and many projects enforce `max-len` (eslint), `line-too-long` (pylint/flake8 E501) or similar. That turns a correct migration into a failing `npm test` / `npm run lint`. Build the XML in a named constant or in parts first, then send it:

```javascript
// AVOID — one long line per <Say>, trips eslint max-len
res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna-Neural">Thank you for calling. Please press 1 for sales, 2 for support.</Say></Response>`);

// PREFER — named constant, one short line per element
// (PROMPT here is a literal; if it ever comes from dynamic data, wrap it in
// escapeXmlText() — see the escaping helpers below.)
const PROMPT = 'Thank you for calling. Please press 1 for sales, 2 for support.';

const texml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Response>',
  `  <Gather numDigits="1" action="/handle-key">`,
  `    <Say voice="Polly.Joanna-Neural">${PROMPT}</Say>`,
  '  </Gather>',
  '</Response>',
].join('\n');

res.type('text/xml').send(texml);
```

```python
# PREFER — module-level template, interpolate short values.
# Escape dynamic text BEFORE interpolating (see the escaping rules below):
# unescaped input like "Sales & Support" produces malformed XML, and
# "<Hangup/>" would be injected as a live TeXML verb.
from xml.sax.saxutils import escape

TEXML_MENU = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="/handle-key">
    <Say voice="Polly.Joanna-Neural">{prompt}</Say>
  </Gather>
</Response>"""

return TEXML_MENU.format(prompt=escape(prompt))
```

The emitted XML is unchanged — only the source layout differs. If the project has a linter, run it after the migration and before declaring Phase 5 done.

**XML escaping — do NOT escape apostrophes**: when interpolating dynamic values into a TeXML string, escape `&` → `&amp;`, `<` → `&lt;` and `>` → `&gt;` in text nodes, plus `"` → `&quot;` inside attribute values. Do **not** escape `'` to `&apos;`. Twilio's `VoiceResponse` builder leaves apostrophes literal, so escaping them changes the bytes of your response relative to the pre-migration output and will break existing snapshot/string-equality tests (and any downstream diffing) for no benefit — `'` is legal, unescaped, in XML text nodes and inside double-quoted attribute values.

```javascript
// Correct: apostrophe stays literal
const escapeXmlText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Attribute values additionally need the double quote escaped
const escapeXmlAttr = (s) => escapeXmlText(s).replace(/"/g, '&quot;');
```

```python
# Python: xml.sax.saxutils.escape() escapes only & < > — which is what you want.
# Do NOT pass {"'": "&apos;"} as the extra-entities argument.
from xml.sax.saxutils import escape, quoteattr  # quoteattr for attribute values
```

## Step 1: Create a Telnyx Account

1. Sign up at https://telnyx.com/sign-up
2. Complete identity verification
3. Generate an API Key v2 at https://portal.telnyx.com/#/app/api-keys
4. Note your public key at https://portal.telnyx.com/#/app/account/public-key (needed for webhook validation)

## Step 2: Create a TeXML Application

In the Mission Control Portal:

1. Navigate to **Voice** → **TeXML Applications**
2. Click **Add New App**
3. Set a friendly name (e.g., `my-ivr-app`)
4. Configure voice webhook URLs (see Step 3)

Or via API:

```bash
curl -X POST https://api.telnyx.com/v2/texml_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "my-ivr-app",
    "voice_url": "https://example.com/voice",
    "voice_method": "POST",
    "status_callback": "https://example.com/status",
    "status_callback_method": "POST"
  }'
```

## Step 3: Configure Webhook URLs

Point your TeXML application to the same webhook server that currently serves your TwiML responses. Your server returns XML in the `<Response>` format — this does not change.

| Setting | Description |
|---|---|
| Voice URL | Your server endpoint that returns TeXML/TwiML XML for incoming calls |
| Voice Fallback URL | Backup URL if the primary fails |
| Voice Method | `POST` (recommended) or `GET` |
| Status Callback | URL for call status events (initiated, ringing, answered, completed) |

## Step 4: Purchase or Port Phone Numbers

**Purchase new numbers:**

Use the quoted purchase workflow in `{baseDir}/references/numbers-migration.md`. It re-queries the exact number, displays its current upfront and monthly costs with currency, requires that exact tuple at the local approval gate, serializes the same number, and fails closed if the inventory or quote changed. The Number Orders API has no quote-ID or maximum-charge field, so the cost tuple is not sent to or enforced by the server. After the order completes, assign the purchased number to the TeXML Application as a separate reviewed configuration change.

**Port existing numbers from Twilio:** See `{baseDir}/references/number-porting.md` for the full FastPort guide.

Assign each number to your TeXML Application in the portal or via API.

## Step 5: Update API Endpoints

Replace Twilio REST API endpoints with Telnyx TeXML endpoints:

| Operation | Twilio | Telnyx |
|---|---|---|
| **Base URL** | `https://api.twilio.com/2010-04-01/Accounts/{SID}` | `https://api.telnyx.com/v2/texml/Accounts/{account_sid}` |
| List calls | `GET /Calls.json` | `GET /Calls` |
| Make a call | `POST /Calls.json` | `POST /Calls` |
| Get call | `GET /Calls/{SID}.json` | `GET /Calls/{SID}` |
| Update call | `POST /Calls/{SID}.json` | `POST /Calls/{SID}` |
| List recordings | `GET /Recordings.json` | `GET /Recordings` |
| List conferences | `GET /Conferences.json` | `GET /Conferences` |

Example — initiate an outbound call:

```bash
TO_NUMBER="+15559876543"
FROM_NUMBER="+15551234567"
INSTRUCTIONS_URL="https://example.com/outbound-call"
TIME_LIMIT_SECONDS=30
[[ "$TO_NUMBER" =~ ^\+[1-9][0-9]{7,14}$ && "$FROM_NUMBER" =~ ^\+[1-9][0-9]{7,14}$ ]] || {
  echo "To and From must be E.164 numbers" >&2; exit 1;
}
[[ "$INSTRUCTIONS_URL" =~ ^https:// ]] || {
  echo "TeXML instructions URL must use HTTPS" >&2; exit 1;
}
[[ "$TIME_LIMIT_SECONDS" =~ ^[0-9]+$ ]] &&
  test "$TIME_LIMIT_SECONDS" -ge 30 -a "$TIME_LIMIT_SECONDS" -le 14400 || {
    echo "TimeLimit must be between 30 and 14400 seconds" >&2; exit 1;
  }

# Twilio — approve this provider's call independently before it is placed.
TWILIO_SID="${TWILIO_SID:-}"
test -n "${TWILIO_AUTH_TOKEN:-}" || {
  echo "Set TWILIO_AUTH_TOKEN" >&2; exit 1;
}
[[ "$TWILIO_SID" =~ ^AC[0-9a-fA-F]{32}$ ]] || {
  echo "TWILIO_SID must be a complete Twilio account SID" >&2; exit 1;
}
TWILIO_CALL_TOKEN="$TWILIO_SID|$TO_NUMBER|$FROM_NUMBER|$INSTRUCTIONS_URL|$TIME_LIMIT_SECONDS"
printf 'Twilio call: %s -> %s; instructions %s; limit %ss\n' \
  "$FROM_NUMBER" "$TO_NUMBER" "$INSTRUCTIONS_URL" "$TIME_LIMIT_SECONDS"
test "${TWILIO_APPROVE_OUTBOUND_CALL:-}" = "$TWILIO_CALL_TOKEN" || {
  echo "Twilio outbound call not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/Calls.json" \
  -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN" \
  --data-urlencode "To=$TO_NUMBER" \
  --data-urlencode "From=$FROM_NUMBER" \
  --data-urlencode "Url=$INSTRUCTIONS_URL" \
  --data-urlencode "TimeLimit=$TIME_LIMIT_SECONDS"

# Telnyx — require a separate, price-bound approval before this provider's call.
TELNYX_ACCOUNT_SID="${TELNYX_ACCOUNT_SID:-}"  # Telnyx account user_id, not a Twilio SID
TEXML_APPLICATION_ID="${TELNYX_TEXML_APPLICATION_ID:-}"
APPROVED_MAX_CHARGE="${TELNYX_APPROVED_TEXML_CALL_MAX:-}"
APPROVED_CURRENCY="${TELNYX_APPROVED_TEXML_CALL_CURRENCY:-}"
test -n "$TELNYX_ACCOUNT_SID" || {
  echo "Set TELNYX_ACCOUNT_SID to the Telnyx account user_id" >&2; exit 1;
}
test -n "$TEXML_APPLICATION_ID" || {
  echo "Set TELNYX_TEXML_APPLICATION_ID" >&2; exit 1;
}
jq -en --arg maximum "$APPROVED_MAX_CHARGE" '
  ($maximum | tonumber) as $value | ($value > 0 and ($value | isinfinite | not))
' >/dev/null || {
  echo "Approved maximum charge must be a positive finite decimal" >&2; exit 1;
}
[[ "$APPROVED_CURRENCY" =~ ^[A-Z]{3}$ ]] || {
  echo "Approved currency must be a three-letter ISO 4217 code" >&2; exit 1;
}
APPROVAL_TOKEN="$TELNYX_ACCOUNT_SID|$TO_NUMBER|$FROM_NUMBER|$TEXML_APPLICATION_ID|$INSTRUCTIONS_URL|$TIME_LIMIT_SECONDS|$APPROVED_MAX_CHARGE|$APPROVED_CURRENCY"
printf 'TeXML call: %s -> %s via %s; limit %ss; approved maximum %s %s\n' \
  "$FROM_NUMBER" "$TO_NUMBER" "$TEXML_APPLICATION_ID" "$TIME_LIMIT_SECONDS" \
  "$APPROVED_MAX_CHARGE" "$APPROVED_CURRENCY"
# Check the current account-specific route price, then approve this exact tuple.
test "${TELNYX_APPROVE_TEXML_CALL:-}" = "$APPROVAL_TOKEN" || {
  echo "TeXML call not approved" >&2; exit 1;
}
CALL_PAYLOAD=$(jq -cn \
  --arg to "$TO_NUMBER" \
  --arg from "$FROM_NUMBER" \
  --arg application_sid "$TEXML_APPLICATION_ID" \
  --arg url "$INSTRUCTIONS_URL" \
  --argjson time_limit "$TIME_LIMIT_SECONDS" \
  '{
    To: $to,
    From: $from,
    ApplicationSid: $application_sid,
    Url: $url,
    TimeLimit: $time_limit
  }')
curl -fsS -X POST "https://api.telnyx.com/v2/texml/Accounts/$TELNYX_ACCOUNT_SID/Calls" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$CALL_PAYLOAD"
```

`TimeLimit` bounds call duration but is not a monetary cap. Derive `TELNYX_APPROVED_TEXML_CALL_MAX` from the current account-specific price for the exact destination and the 30-second limit; do not place the call if its worst-case charge cannot be bounded.

## Step 6: Update Authentication

Replace Twilio's Basic Auth with Telnyx Bearer Token in all API calls:

```python
# Twilio
from twilio.rest import Client
client = Client("ACCOUNT_SID", "AUTH_TOKEN")

# Telnyx — using native SDK
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")
```

```javascript
// Twilio
const twilio = require('twilio');
const client = twilio('ACCOUNT_SID', 'AUTH_TOKEN');

// Telnyx — using native SDK
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });
```

```bash
# Twilio
curl -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN" ...

# Telnyx
curl -H "Authorization: Bearer $TELNYX_API_KEY" ...
```

```go
// Go
// Twilio
import "github.com/twilio/twilio-go"
client := twilio.NewRestClientWithParams(twilio.ClientParams{
    Username: "ACCOUNT_SID", Password: "AUTH_TOKEN",
})

// Telnyx
import (
    "github.com/team-telnyx/telnyx-go"
    "github.com/team-telnyx/telnyx-go/option"
)
client := telnyx.NewClient(option.WithAPIKey("YOUR_TELNYX_API_KEY"))
```

```ruby
# Twilio
require 'twilio-ruby'
client = Twilio::REST::Client.new(account_sid, auth_token)

# Telnyx
require 'telnyx'
client = Telnyx::Client.new(api_key: 'YOUR_TELNYX_API_KEY')
```

```java
// Twilio
import com.twilio.Twilio;
Twilio.init("ACCOUNT_SID", "AUTH_TOKEN");

// Telnyx — use REST API with Bearer token
// Java: use OkHttp/HttpClient with Authorization: Bearer header
```

## Step 7: Update Webhook Signature Validation

This is the most important code change. Twilio uses HMAC-SHA1 with your auth token. Telnyx uses Ed25519 with a public key.

**Python:**
```python
# Twilio (remove this)
from twilio.request_validator import RequestValidator
validator = RequestValidator(auth_token)
is_valid = validator.validate(url, params, request.headers.get('X-Twilio-Signature'))

# Telnyx (add this)
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY", public_key="YOUR_PUBLIC_KEY")

# Verify webhook signature using Ed25519
try:
    event = client.webhooks.unwrap(
        request.data.decode("utf-8"),
        headers=request.headers,  # must contain telnyx-signature-ed25519 and telnyx-timestamp
    )
    # Signature valid
except Exception:
    # Signature invalid — reject the request
    return "Forbidden", 403
```

**Node.js:**
```javascript
// Twilio (remove this)
const twilio = require('twilio');
const isValid = twilio.validateRequest(authToken, signature, url, params);

// Telnyx (add this)
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_API_KEY' });
const PUBLIC_KEY = "YOUR_PUBLIC_KEY";

try {
  const event = await client.webhooks.unwrap(
    req.rawBody,  // Must be original bytes — see SKILL.md Express raw body setup
    { headers: req.headers, key: PUBLIC_KEY }
  );
  // Signature valid
} catch (e) {
  // Signature invalid
  res.status(403).send('Forbidden');
}
```

**Go:**
```go
// Telnyx webhook signature validation in Go
// Use the telnyx-go SDK or verify Ed25519 manually:
import (
    "bytes"
    "crypto/ed25519"
    "encoding/base64"
    "io"
    "net/http"
    "strconv"
    "time"
)

// Returns the verified body. The caller must use THIS slice - reading r.Body
// again yields nothing, because io.ReadAll consumes it.
func verifyWebhook(r *http.Request, publicKeyBase64 string) ([]byte, bool) {
    bodyBytes, err := io.ReadAll(r.Body)
    if err != nil {
        return nil, false
    }
    // Restore the body so a handler that decodes r.Body still works. Without
    // this the handler reads zero bytes and fails on every request.
    r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

    signature := r.Header.Get("telnyx-signature-ed25519")
    timestamp := r.Header.Get("telnyx-timestamp")

    // REJECT STALE DELIVERIES. Without a freshness check any captured signed
    // payload - from a log dump, a proxy trace, a shared staging endpoint -
    // verifies forever, so an attacker can replay it indefinitely. Telnyx
    // documents a 5-minute tolerance.
    ts, err := strconv.ParseInt(timestamp, 10, 64)
    if err != nil || time.Since(time.Unix(ts, 0)) > 5*time.Minute {
        return nil, false
    }

    pubKeyBytes, err := base64.StdEncoding.DecodeString(publicKeyBase64)
    // ed25519.Verify PANICS on a wrong-length key, so a misconfigured
    // TELNYX_PUBLIC_KEY would crash the handler instead of rejecting.
    if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
        return nil, false
    }
    sigBytes, err := base64.StdEncoding.DecodeString(signature)
    if err != nil {
        return nil, false
    }
    message := []byte(timestamp + "|" + string(bodyBytes))
    return bodyBytes, ed25519.Verify(ed25519.PublicKey(pubKeyBytes), message, sigBytes)
}
```

**Ruby:**
```ruby
# Telnyx webhook signature validation in Ruby
require 'telnyx'
client = Telnyx::Client.new(api_key: 'YOUR_API_KEY')

post '/webhook' do
  payload = request.body.read
  signature = request.env['HTTP_TELNYX_SIGNATURE_ED25519']
  timestamp = request.env['HTTP_TELNYX_TIMESTAMP']
  begin
    # Verification lives on the CLIENT. There is no Telnyx::Webhook module -
    # naming one raises NameError, which `rescue` swallows, so every webhook
    # would be rejected with 403.
    client.webhooks.unwrap(payload, headers: telnyx_headers, key: ENV['TELNYX_PUBLIC_KEY'])
    # Signature valid
  rescue Telnyx::Errors::WebhookVerificationError
    halt 403, 'Forbidden'
  end
end
```

**Java:**
```java
// Telnyx webhook signature validation in Java
// No official Java SDK — verify Ed25519 manually using Bouncy Castle or java.security
// 1. Decode the base64 public key and signature
// 2. Concatenate: timestamp + "|" + requestBody
// 3. Verify using Ed25519 (java.security.Signature with "Ed25519" algorithm, Java 15+)
```

## TeXML Bins

Twilio has TwiML Bins — static TwiML documents hosted by Twilio. Telnyx has an equivalent: **TeXML Bins**.

Create a TeXML Bin in the Mission Control Portal under **Voice** → **TeXML Applications** → **TeXML Bins**. Paste your static XML and get a hosted URL you can use as a Voice URL or waitUrl.

## Testing Your Migration

1. **Validate your XML first:**
   ```bash
   bash {baseDir}/scripts/validate-texml.sh /path/to/your/twiml.xml
   ```

2. **Test with a single number:** Assign one number to your TeXML Application and make a test call.

3. **Check webhook delivery:** In the Mission Control Portal, navigate to **Debugging** → **API Logs** to see webhook deliveries and responses.

4. **Verify recordings:** Treat the two TeXML recording paths separately. `<Record>` defaults to dual-channel on Telnyx, so set `channels="single"` when the source flow expects mono. The [Telnyx `<Dial>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial) documents `recordingChannels="single"` and `recordMaxLength="0"` as the defaults; preserve the source `record` value (including its `-dual` variants) and set these attributes only when the target behavior explicitly requires it.

5. **Test answering machine detection (AMD):** If you use AMD, verify `machineDetection` attribute behavior. Telnyx supports `Regular` and `Premium` detection modes.

## Webhook Differences

TeXML callbacks use the same parameter names as TwiML for most fields. Key differences:

| Parameter | Notes |
|---|---|
| `AccountSid` | Your Telnyx account `user_id` (not the Connection ID) |
| `ConnectionId` | The Telnyx connection that handled the call |
| `CallSid` | Telnyx call control ID |
| `RecordingUrl` | Valid for 10 minutes after call ends (Twilio URLs persist longer) |

Status callback events match Twilio's: `initiated`, `ringing`, `answered`, `completed`.

## Common Pitfalls

1. **Recording channels default to dual-channel** — Telnyx records in dual-channel (stereo) by default, Twilio uses single-channel. If your audio processing expects mono, explicitly set `channels="single"` on `<Record>` or `record_channels: "single"` in Call Control.

2. **Caller ID policy is strict** — Telnyx validates outbound caller IDs against your Outbound Voice Profile. If you're using dynamic caller IDs, make sure they're all authorized in your profile. Calls with unauthorized caller IDs will fail immediately.

3. **Status callback event names match but payloads differ** — Event names (initiated, ringing, answered, completed) are the same, but the webhook payload structure for Call Control API differs from TeXML callbacks. TeXML callbacks are form-encoded like Twilio; Call Control uses JSON.

4. **RecordingUrl is temporary** — Telnyx recording URLs are AWS S3 signed URLs that expire after 10 minutes (`X-Amz-Expires=600`). Any code that stores the URL for later playback will silently fail. Download the recording immediately in your webhook handler and persist it to your own storage.

```python
# Twilio (URL never expires — store it directly)
@app.route('/recording-callback', methods=['POST'])
def handle_recording():
    recording_url = request.form['RecordingUrl']
    call_sid = request.form['CallSid']
    # Safe to store URL and download days later
    db.save_recording(call_sid=call_sid, url=recording_url)
    return '', 204

# Telnyx TeXML callback (form-encoded; URL expires in 10 minutes)
@app.route('/recording-callback', methods=['POST'])
def handle_recording():
    recording_url = request.form['RecordingUrl']
    recording_sid = request.form['RecordingSid']
    call_sid = request.form['CallSid']

    # Download NOW — URL expires in 10 minutes
    response = requests.get(recording_url)
    response.raise_for_status()  # Fail loudly if download fails (e.g., URL expired)
    filename = f"recordings/{recording_sid}.mp3"
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    # Save to local filesystem (or upload to S3/GCS)
    with open(filename, 'wb') as f:
        f.write(response.content)
    db.save_recording(call_id=call_sid, recording_id=recording_sid, path=filename)
    return '', 200
```

```javascript
// Twilio (URL never expires — store it directly)
app.post('/recording-callback', (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const callSid = req.body.CallSid;
  // Safe to store URL and download days later
  db.saveRecording({ callSid, url: recordingUrl });
  res.sendStatus(204);
});

// Telnyx TeXML callback (requires app.use(express.urlencoded({ extended: false })))
const fs = require('fs');
const { pipeline } = require('stream/promises');

app.post('/recording-callback', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const recordingSid = req.body.RecordingSid;
  const callSid = req.body.CallSid;

  // Download NOW — URL expires in 10 minutes
  const response = await fetch(recordingUrl);
  if (!response.ok) throw new Error(`Recording download failed: ${response.status} (URL may have expired)`);
  const filename = `recordings/${recordingSid}.mp3`;
  fs.mkdirSync('recordings', { recursive: true });
  // Save to local filesystem (or upload to S3/GCS)
  await pipeline(response.body, fs.createWriteStream(filename));
  await db.saveRecording({ callId: callSid, recordingId: recordingSid, path: filename });
  res.sendStatus(200);
});
```

5. **AMD (Answering Machine Detection)** — Telnyx supports `Regular` and `Premium` detection modes. Twilio's `machineDetection` param maps to Telnyx's `answering_machine_detection`. The `Premium` mode provides async detection with separate webhook events (`call.machine.detection.ended`).

6. **Speech recognition engines** — In TeXML `<Gather>`, Telnyx supports multiple STT engines via the `transcriptionEngine` attribute (e.g., `transcriptionEngine="Google"`). If you were using Twilio's default speech recognition, you now have a choice of Google, Telnyx, Deepgram, or Azure.

## REST API Mapping

For REST API operations (managing calls, conferences, recordings programmatically), the existing TeXML skills in this repo provide complete SDK examples:

> **Complete TeXML API examples** with all parameters are in the sdk-reference files: `sdk-reference/{language}/texml.md`.

## Call Control API (Alternative to TeXML)

### Decision Tree: TeXML vs Call Control

Choose your migration path based on your current architecture:

- **You have existing TwiML XML** → **Use TeXML** (lowest effort, XML is compatible)
- **You generate TwiML programmatically** → **Consider either**: TeXML if the XML generation is simple; Call Control if you want finer control
- **You need real-time call manipulation** (bridge, park, supervisor) → **Use Call Control**
- **You're building from scratch** during migration → **Use Call Control** (more powerful, Telnyx-native)
- **You want to migrate incrementally** → **Start with TeXML** (drop-in), then migrate complex flows to Call Control over time

Telnyx offers a second voice API that has no Twilio equivalent: the **Call Control API**. It provides imperative, event-driven call management via REST instead of declarative XML.

| Aspect | TeXML | Call Control API |
|--------|-------|------------------|
| Model | Declarative XML | Imperative REST calls |
| State management | Stateless (XML per request) | Stateful (commands per call) |
| Flexibility | Limited to XML verbs | Full programmatic control |
| Learning curve | Low (TwiML-compatible) | Medium |
| Best for | Migrating existing TwiML apps | New apps needing complex logic |

**When to consider Call Control instead of TeXML:**
- Complex conditional routing that's awkward in XML
- Real-time call manipulation (bridging, parking, supervisor roles)
- Event-driven architectures (each call event triggers a webhook)
- Applications that need client state management (see below)

**Basic example — IVR with Call Control:**
```javascript
app.post('/call-webhook', async (req, res) => {
  const event = req.body.data;
  const callControlId = event.payload.call_control_id;

  switch (event.event_type) {
    case 'call.initiated':
      await client.calls.actions.answer(callControlId);
      break;
    case 'call.answered':
      await client.calls.actions.gatherUsingSpeak(callControlId, {
        minimum_digits: 1, maximum_digits: 1, timeout_millis: 10000,
        payload: 'Press 1 for sales, 2 for support'
      });
      break;
    case 'call.gather.ended':
      const digit = event.payload.digits;
      const dest = digit === '1' ? '+15551111111' : '+15552222222';
      await client.calls.actions.transfer(callControlId, { to: dest });
      break;
  }
  res.sendStatus(200);
});
```

> **Complete Call Control API examples** including bridge, gather, speak, transfer, streaming, and recording are in the sdk-reference files: `sdk-reference/{language}/voice.md` and `sdk-reference/{language}/voice-advanced.md`.

## Advanced Voice Patterns

These patterns are specific to Telnyx and have no direct Twilio equivalent. They are relevant when migrating contact center, PBX, or complex IVR applications.

### Client State (State Machine Pattern)

Telnyx Call Control uses `client_state` as a base64-encoded object to maintain state across webhook events. This replaces Twilio's pattern of encoding state in callback URLs or session storage.

```javascript
// Encode state when issuing a command
const state = Buffer.from(JSON.stringify({
  step: 'greeting_complete',
  caller_tier: 'premium',
  retry_count: 0
})).toString('base64');

await client.calls.actions.answer(callControlId, {
  client_state: state
});

// Decode state in the next webhook
app.post('/webhook', (req, res) => {
  const event = req.body.data;
  const clientState = JSON.parse(
    Buffer.from(event.payload.client_state, 'base64').toString()
  );
  // clientState.step === 'greeting_complete'
});
```

Every Call Control command (`answer`, `speak`, `gather`, `bridge`, `transfer`, etc.) accepts `client_state`. The state is echoed back in the subsequent webhook event, giving you a stateless server architecture.

> **`updateClientState()`** for modifying state on active calls is documented in `sdk-reference/{language}/voice-advanced.md`.

### Bridge, link_to, and bridge_on_answer

Telnyx Call Control provides fine-grained control over how calls are connected:

**Bridge** — connect two active Call Control calls:
```javascript
// Both calls must already be answered
await client.calls.actions.bridge(callControlIdA, {
  call_control_id: callControlIdB,
  client_state: state
});
```

**Dial with bridge_on_answer** — automatically bridge when the B-leg answers, without waiting for a webhook round-trip:
```bash
curl -X POST https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "YOUR_CONNECTION_ID",
    "to": "+15559876543",
    "from": "+15551234567",
    "answering_machine_detection": "disabled",
    "bridge_to": "CALL_CONTROL_ID_OF_WAITING_LEG",
    "bridge_on_answer": "bridge_on_answer"
  }'
```

This eliminates the need to handle the `call.answered` webhook and then issue a separate `bridge` command — reducing latency and code complexity.

**link_to** — permanently associate two calls so they share lifecycle events:
```javascript
// link_to is set during dial or bridge commands
await client.calls.dial({
  connection_id: 'YOUR_CONNECTION_ID',
  to: '+15559876543',
  from: '+15551234567',
  link_to: otherCallControlId
});
```

Linked calls receive each other's events, useful for building agent dashboards or call monitoring.

> **All optional parameters** for `dial` (including `bridge_on_answer`, `bridge_intent`, `link_to`, `supervisor_role`, `park_after_unbridge`, `sip_headers`, `custom_headers`) and `bridge` (including `park_after_unbridge`, `mute_dtmf`) are documented in the sdk-reference files under `voice.md` and `voice-advanced.md`.

### Caller ID Policy

Telnyx enforces caller ID policy on outbound calls. Unlike Twilio (where you pass any owned number as `callerId`), Telnyx validates caller ID against your **Outbound Voice Profile**:

- Each SIP Connection or TeXML Application has an associated Outbound Voice Profile
- The profile controls which numbers and CNAM settings can be used for outbound caller ID
- If you attempt to use a caller ID not authorized in your profile, the call will fail

```bash
# Create an outbound voice profile
curl -X POST https://api.telnyx.com/v2/outbound_voice_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "production-caller-ids"}'
```

Assign it to your connection in the Mission Control Portal under **SIP** → **Connections** → **Outbound**.

> **Complete SIP CRUD examples** for outbound voice profiles (with `whitelisted_destinations`, `traffic_type`, `calling_window`, `concurrent_call_limit`, `daily_spend_limit`, etc.) and credential connections (with `sip_uri_calling_preference`, `encrypted_media`, `inbound`/`outbound` objects, etc.) are in `sdk-reference/{language}/sip.md` and `sdk-reference/{language}/sip-integrations.md`.

### Subdomains

Telnyx supports SIP subdomains for credential-based connections. A subdomain provides a unique SIP registration URI per connection:

```
sip:username@YOUR_SUBDOMAIN.sip.telnyx.com
```

`sip_subdomain_receive_settings` controls who can send calls to the subdomain:
- `from_anyone` — accept calls from any source
- `only_my_connections` — only accept calls from your other Telnyx connections

This is important for multi-tenant PBX deployments and inter-connection routing.

**Configure it in the Portal, not through `/v2/credential_connections`.** Mission Control Portal → **SIP** → **Connections** → your connection.

Measured against the live API: `POST /v2/credential_connections` with `sip_subdomain` / `sip_subdomain_receive_settings` (top-level *or* nested under `inbound`) returns **201**, and a follow-up `PATCH` returns **200** — but a subsequent `GET` never shows the values. Neither field appears in the request or response schema for `POST`, `PATCH`, or `GET /credential_connections` (see `sdk-reference/{language}/sip.md`, generated from the Telnyx OpenAPI spec). They are accepted and silently discarded, so a provisioning script that sets them will report success while configuring nothing.

> `*.sip.telnyx.com` is a DNS wildcard — an unprovisioned subdomain still resolves (`dig +short anything.sip.telnyx.com` returns an A record). A URI built against a subdomain you never created will therefore connect at the network layer and fail at the SIP layer, with no DNS error to diagnose from. Verify a subdomain by registering against it, never by resolving it.

If you do not specifically need a subdomain, address credentials at the bare `sip.telnyx.com` host.

## Testing

When migrating voice tests from Twilio to Telnyx, update mocks and webhook payloads.

### Mock Patterns

**Python (pytest/unittest):**
```python
# Twilio mock:
# @patch('twilio.rest.Client')
# def test_call(mock_client):
#     mock_client.return_value.calls.create.return_value.sid = 'CA...'

# Telnyx mock (v4 SDK — client.calls.create):
@patch('your_module.client.calls.create')  # patch where client is used
def test_call(mock_create):
    mock_create.return_value = type('obj', (object,), {
        'data': type('obj', (object,), {
            'call_control_id': 'v3:uuid-here',
            'call_leg_id': 'uuid-here',
            'call_session_id': 'uuid-here',
            'is_alive': True,
        })()
    })()
    result = make_call('+15559876543')
    mock_create.assert_called_once()
```

**JavaScript (Jest):**
```javascript
jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      create: jest.fn().mockResolvedValue({
        data: {
          call_control_id: 'v3:uuid-here',
          call_leg_id: 'uuid-here',
          call_session_id: 'uuid-here',
          is_alive: true,
        }
      })
    }
  }));
});
```

### Webhook Mock Payloads

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "evt-uuid",
    "occurred_at": "2024-01-15T10:30:00Z",
    "payload": {
      "call_control_id": "v3:uuid-here",
      "call_leg_id": "uuid-here",
      "call_session_id": "uuid-here",
      "connection_id": "conn-uuid",
      "from": "+15551234567",
      "to": "+15559876543",
      "direction": "incoming",
      "state": "ringing",
      "client_state": null
    },
    "record_type": "event"
  },
  "meta": { "attempt": 1 }
}
```

### Assertion Changes

| Twilio Assertion | Telnyx Assertion |
|---|---|
| `assert result.sid.startswith('CA')` | `assert result.data.call_control_id is not None` |
| `assert result.status == 'queued'` | `assert result.data.is_alive == True` |
| `assert result.from_ == '+15551234567'` | `assert result.data.from_ == '+15551234567'` (Call Control) |
| TwiML response content type `text/xml` | TeXML response content type `text/xml` (same) |
