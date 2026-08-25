# Messaging Migration: Twilio to Telnyx

Migrate from Twilio Programmable Messaging to the Telnyx Messaging API.

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Sending Messages](#sending-messages)
- [Receiving Messages (Webhooks)](#receiving-messages-webhooks)
- [Replying to Inbound SMS (`MessagingResponse` → no TwiML)](#replying-to-inbound-sms-messagingresponse--no-twiml)
- [MMS and Media](#mms-and-media)
- [Messaging Profiles](#messaging-profiles)
- [10DLC Registration](#10dlc-registration)
- [Short Codes and Toll-Free](#short-codes-and-toll-free)
- [Webhook Payload Mapping](#webhook-payload-mapping)
- [Error Code Mapping](#error-code-mapping)

## Overview

Telnyx Messaging is a new SDK integration, not a drop-in replacement. The core changes:

1. Different SDK and client initialization
2. Different parameter names (`body` → `text`, flat params → structured objects)
3. Webhook payloads use Telnyx's event structure (nested under `data`)
4. Webhook signatures use Ed25519 instead of HMAC-SHA1
5. Numbers must be assigned to a **Messaging Profile** (analogous to Twilio's Messaging Service)

## Setup

### Install the Telnyx SDK

```bash
# Python
pip install 'telnyx>=4.0,<5.0'

# Node.js
npm install telnyx@^6 ws@^8

# Ruby (in Gemfile)
gem 'telnyx', '~> 5.0'
# then: bundle install

# Go
go get github.com/team-telnyx/telnyx-go/v4
```

### Configure Authentication

```python
# Python
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")
```

```javascript
// Node.js
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });
```

```bash
# curl
export TELNYX_API_KEY="YOUR_API_KEY"
```

## Sending Messages

### SMS

```python
# Twilio
from twilio.rest import Client
client = Client(account_sid, auth_token)
message = client.messages.create(
    to="+15559876543",
    from_="+15551234567",
    body="Hello from Twilio"
)
print(message.sid)

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_API_KEY")
message = client.messages.send(
    to="+15559876543",
    from_="+15551234567",
    text="Hello from Telnyx",
    messaging_profile_id="YOUR_MESSAGING_PROFILE_ID"
)
if message.data is None:
    raise RuntimeError("Telnyx message send returned no data")
print(message.data.id)
```

```javascript
// Twilio
const client = require('twilio')(accountSid, authToken);
const message = await client.messages.create({
  to: '+15559876543',
  from: '+15551234567',
  body: 'Hello from Twilio'
});

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_API_KEY' });
const message = await client.messages.send({
  to: '+15559876543',
  from: '+15551234567',
  text: 'Hello from Telnyx',
  messaging_profile_id: 'YOUR_MESSAGING_PROFILE_ID'
});
```

```bash
# Twilio
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/Messages.json" \
  -u "$SID:$AUTH_TOKEN" \
  -d "To=+15559876543" -d "From=+15551234567" -d "Body=Hello"

# Telnyx
curl -X POST "https://api.telnyx.com/v2/messages" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15559876543","from":"+15551234567","text":"Hello","messaging_profile_id":"YOUR_MESSAGING_PROFILE_ID"}'
```

```go
// Go
// Twilio
import "github.com/twilio/twilio-go"
import twilioApi "github.com/twilio/twilio-go/rest/api/v2010"

client := twilio.NewRestClient()
params := &twilioApi.CreateMessageParams{}
params.SetTo("+15559876543")
params.SetFrom("+15551234567")
params.SetBody("Hello from Twilio")
resp, _ := client.Api.CreateMessage(params)

// Telnyx
import (
	"context"
	"os"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)
client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
message, _ := client.Messages.Send(context.TODO(), telnyx.MessageSendParams{
	To:                  telnyx.String("+15559876543"),
	From:                telnyx.String("+15551234567"),
	Text:                telnyx.String("Hello from Telnyx"),
	MessagingProfileID:  telnyx.String("YOUR_MESSAGING_PROFILE_ID"),
})
```

```ruby
# Twilio
require 'twilio-ruby'
client = Twilio::REST::Client.new(account_sid, auth_token)
message = client.messages.create(
  to: '+15559876543', from: '+15551234567', body: 'Hello from Twilio'
)

# Telnyx
require 'telnyx'
client = Telnyx::Client.new(api_key: 'YOUR_API_KEY')
message = client.messages.send_(
  to: '+15559876543', from: '+15551234567', text: 'Hello from Telnyx',
  messaging_profile_id: 'YOUR_MESSAGING_PROFILE_ID'
)
```

```java
// Twilio
import com.twilio.rest.api.v2010.account.Message;
import com.twilio.type.PhoneNumber;

Message message = Message.creator(
    new PhoneNumber("+15559876543"),
    new PhoneNumber("+15551234567"),
    "Hello from Twilio"
).create();

// Telnyx — use REST API with OkHttp or HttpClient
// POST https://api.telnyx.com/v2/messages
// Body: {"to":"+15559876543","from":"+15551234567","text":"Hello from Telnyx","messaging_profile_id":"YOUR_PROFILE_ID"}
```

### Key Parameter Differences

| Twilio | Telnyx | Notes |
|---|---|---|
| `body` | `text` | Message content |
| `from_` / `From` | `from_` (Python), `from` (other SDKs/REST) | Sender number (E.164). Python SDK uses `from_` to avoid reserved keyword — same as Twilio |
| `to` / `To` | `to` | Recipient number (E.164) |
| `StatusCallback` | `webhook_url` (per-message) or Messaging Profile | Per-message: pass `webhook_url` in send request. Profile-wide: configure on Messaging Profile |
| `MessagingServiceSid` | `messaging_profile_id` | Message routing profile |
| `MediaUrl` | `media_urls` | Array of media URLs (for MMS) |

> `messaging_profile_id` is conditional. It can be omitted for a `from` phone number or short code that already resolves to the intended Messaging Profile, but it is required for number-pool and alphanumeric-sender sends.

### Listing Messages (Pagination)

Twilio uses auto-paging iterators; Telnyx returns paginated responses with `data` array and `meta` for pagination.

```python
# Twilio — auto-paging
for msg in client.messages.list(from_="+15551234567", limit=100):
    print(msg.sid, msg.body)

# Telnyx — paginated response
# Note: Telnyx messaging does not have a list-all-messages endpoint.
# Use the messaging_profile_metrics or webhook events to track messages.
# For other resources (numbers, profiles), pagination works like this:
page = client.messaging_profiles.list(page_size=25)
for profile in page.data:
    print(profile.id, profile.name)
# Check page.meta for pagination: page.meta.total_pages, page.meta.page_number
```

```javascript
// Twilio
const messages = await client.messages.list({ from: '+15551234567', limit: 100 });
messages.forEach(msg => console.log(msg.sid, msg.body));

// Telnyx — paginated
const { data: profiles } = await telnyx.messagingProfiles.list({ page: { size: 25 } });
profiles.forEach(p => console.log(p.id, p.name));
```

## Receiving Messages (Webhooks)

Configure your webhook URL on a **Messaging Profile** in the Mission Control Portal (not per-number like Twilio).

### Webhook Payload Comparison

**Twilio incoming message webhook:**
```json
{
  "MessageSid": "SM...",
  "AccountSid": "AC...",
  "From": "+15559876543",
  "To": "+15551234567",
  "Body": "Hello",
  "NumMedia": "0"
}
```

**Telnyx incoming message webhook:**
```json
{
  "data": {
    "event_type": "message.received",
    "id": "evt_...",
    "occurred_at": "2026-01-15T12:00:00Z",
    "payload": {
      "id": "msg_...",
      "from": {
        "phone_number": "+15559876543",
        "carrier": "T-Mobile"
      },
      "to": [{
        "phone_number": "+15551234567"
      }],
      "text": "Hello",
      "media": [],
      "direction": "inbound",
      "type": "SMS"
    }
  }
}
```

### Webhook Handler Example

```python
# Twilio
@app.route('/sms', methods=['POST'])
def handle_sms():
    from_number = request.form['From']
    body = request.form['Body']
    # Process message...

# Telnyx
@app.route('/sms', methods=['POST'])
def handle_sms():
    event = request.json['data']
    payload = event['payload']
    from_number = payload['from']['phone_number']
    body = payload['text']
    # Process message...
```

```javascript
// Twilio
app.post('/sms', (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;
  // Process message...
});

// Telnyx
app.post('/sms', (req, res) => {
  const { payload } = req.body.data;
  const from = payload.from.phone_number;
  const body = payload.text;
  // Process message...
  res.sendStatus(200);
});
```

## Replying to Inbound SMS (`MessagingResponse` → no TwiML)

**This is the largest architectural change in a messaging migration.** Twilio's canonical inbound-SMS pattern is to return TwiML from the webhook:

```python
from twilio.twiml.messaging_response import MessagingResponse

@app.route('/sms', methods=['POST'])
def sms():
    resp = MessagingResponse()
    resp.message("Thanks! We got your message.")
    return str(resp)           # Twilio reads the XML and sends the reply for you
```

**Telnyx has no equivalent. There is no XML reply format for SMS at all.**

TeXML is voice-only — `<Response><Message>…</Message></Response>` is not a thing on Telnyx. A Telnyx messaging webhook is plain JSON in, and its response body is **ignored**. You reply by making an outbound API call.

Unlike the voice migration (where `VoiceResponse` → raw TeXML string is a near-mechanical swap, see `{baseDir}/references/voice-migration.md`), there is no equivalent transformation here. Every `MessagingResponse` in the codebase is a rewrite.

### The two changes you must make

| | Twilio | Telnyx |
|---|---|---|
| How the reply is sent | Return TwiML; Twilio sends it | Call `client.messages.send()` yourself |
| Webhook response body | The TwiML document | Ignored — return an empty **200** |
| Sender number | Implicit (the number that was messaged) | Explicit — pass `from_` (the number that received the message). `messaging_profile_id` is **optional**: the number's assigned profile is used by default; pass it only to override |
| Multiple replies | Multiple `<Message>` elements | Multiple `send()` calls |
| Conversation state | **Cookies**, round-tripped by Twilio | **None — Telnyx sends no cookies.** Use server-side storage |

### 1. Reply with an API call, return an empty 200

Authenticate the raw webhook body **before** parsing its phone numbers or
performing a billed send. The SDK's `unwrap` call verifies the Ed25519
signature and timestamp; a forged or stale request must stop at 403. See
`{baseDir}/references/webhook-migration.md` for framework-specific setup.

```python
# Telnyx
import json, os, redis
from flask import abort, request
from telnyx import Telnyx

client = Telnyx(
    api_key=os.environ['TELNYX_API_KEY'],
    public_key=os.environ['TELNYX_PUBLIC_KEY'],
)
redis_client = redis.from_url(os.environ['REDIS_URL'])

def claim_event(event_id):
    """Return claimed, pending, or completed for this delivery.

    Shown with Redis because the claim must be atomic and shared across every
    worker and instance; a module-level set silently stops deduplicating the
    moment you run more than one worker. `NX` makes SET succeed only when the
    key is absent, so two concurrent retries cannot both win. The 24h TTL keeps
    the key space bounded while comfortably outlasting the retry window.
    """
    key = f'telnyx:event:{event_id}'
    if redis_client.set(key, 'pending', nx=True, ex=300):
        return 'claimed'
    return (redis_client.get(key) or b'pending').decode()

def verified_telnyx_data():
    raw_body = request.get_data(as_text=True)  # original body, before parsing
    try:
        client.webhooks.unwrap(raw_body, headers=request.headers)
    except Exception:
        abort(403)
    return json.loads(raw_body)['data']

@app.route('/sms', methods=['POST'])
def sms():
    event = verified_telnyx_data()
    if event.get('event_type') != 'message.received':
        return '', 200

    # DEDUPLICATE BEFORE REPLYING. Telnyx retries a webhook until it gets a
    # 2xx, so a slow handler, a timeout or a deploy mid-request delivers the
    # SAME event again. The reply below is a BILLABLE outbound SMS: without
    # this guard a retry sends the customer a second message and bills you for
    # it. Every webhook carries a stable `id`; record it FIRST and drop the
    # event if it is already known.
    #
    # `seen_event` must be atomic and shared across every worker and instance —
    # an in-process set does not deduplicate behind more than one worker.
    # Redis: `SET <id> 1 NX EX 86400` returns falsy when the key already
    # exists. A unique index on an events table works equally well.
    event_key = f"telnyx:event:{event['id']}"
    claim = claim_event(event['id'])
    if claim == 'completed':
        return '', 200
    if claim == 'pending':
        return '', 503  # ask Telnyx to retry after the active worker/lease

    payload = event['payload']
    from_number = payload['from']['phone_number']       # the person who texted us
    to_number   = payload['to'][0]['phone_number']      # our number they texted
    body        = payload.get('text', '')

    try:
        client.messages.send(
            to=from_number,
            from_=to_number,
            text="Thanks! We got your message.",
        )
    except Exception:
        redis_client.delete(event_key)  # let the webhook retry resume the send
        raise
    redis_client.set(event_key, 'completed', ex=86400)

    return '', 200          # body is ignored; the 200 is what matters
```

```javascript
// Telnyx
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Capture the original body once, when installing Express JSON middleware.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf-8'); },
}));

app.post('/sms', async (req, res) => {
  try {
    await client.webhooks.unwrap(req.rawBody, {
      headers: req.headers,
      key: process.env.TELNYX_PUBLIC_KEY,
    });
  } catch (error) {
    return res.status(403).send('Forbidden');
  }

  const { id: eventId, event_type: eventType, payload } = req.body.data;
  if (eventType !== 'message.received') return res.sendStatus(200);

  // DEDUPLICATE BEFORE REPLYING. Telnyx retries until it gets a 2xx, so a slow
  // handler, a timeout or a deploy mid-request delivers the SAME event again -
  // and the reply below is a BILLABLE outbound SMS. Claim the event id FIRST.
  //
  // The claim must be atomic and shared across every worker and instance; an
  // in-process Set stops deduplicating the moment you run more than one worker.
  // Redis SET NX EX returns null when the key already exists. A unique index on
  // an events table works equally well.
  const eventKey = `telnyx:event:${eventId}`;
  const claimed = await redis.set(eventKey, 'pending', 'NX', 'EX', 300);
  if (!claimed) {
    const state = await redis.get(eventKey);
    return state === 'completed' ? res.sendStatus(200) : res.sendStatus(503);
  }

  const fromNumber = payload.from.phone_number;
  const toNumber   = payload.to[0].phone_number;

  try {
    await client.messages.send({
      to: fromNumber,
      from: toNumber,
      text: 'Thanks! We got your message.',
    });
  } catch (error) {
    await redis.del(eventKey); // let the webhook retry resume the send
    throw error;
  }
  await redis.set(eventKey, 'completed', 'EX', 86400);

  res.sendStatus(200);
});
```

The pending lease makes failed sends retryable, while completed sends remain
deduplicated. For strict crash-safe delivery across the narrow interval between
the provider accepting a send and recording `completed`, enqueue a durable outbox
job transactionally and let a worker own the send/complete transition.

Two things bite here:

- **`from_` is now mandatory.** Twilio inferred the sender from the inbound message. Telnyx does not — read it from `data.payload.to[0].phone_number` (the number the user texted) rather than hardcoding one, or a multi-number deployment will reply from the wrong number.
- **Reply latency now sits inside your webhook.** Telnyx retries on webhook timeout, and a retry will send your reply twice. If `send()` is slow, enqueue it (see [Async / Background Task Patterns](#async--background-task-patterns)) and return 200 immediately.

Multiple `<Message>` elements become multiple calls:

```python
# Twilio:  resp.message("First"); resp.message("Second")
client.messages.send(to=from_number, from_=to_number, text="First")
client.messages.send(to=from_number, from_=to_number, text="Second")
```

An MMS reply (`resp.message().media(url)`) becomes `media_urls=[url]` on the same `send()` call. A webhook that deliberately sends **no** reply (`return str(MessagingResponse())` with no `<Message>`) becomes simply `return '', 200`.

### 2. Move cookie-based session state to server-side storage

Twilio round-trips cookies on messaging webhooks, which is what makes this common pattern work:

```python
# Twilio — relies on Twilio storing and returning a cookie per conversation
@app.route('/sms', methods=['POST'])
def survey():
    qid = int(session.get('question_id', 0))     # Flask session == signed cookie
    answers = session.get('answers', [])
    answers.append(request.form['Body'])

    resp = MessagingResponse()
    if qid < len(QUESTIONS):
        resp.message(QUESTIONS[qid])
        session['question_id'] = qid + 1          # persisted via Set-Cookie
        session['answers'] = answers
    else:
        resp.message("All done, thanks!")
        session.clear()
    return str(resp)
```

**Telnyx sends no cookies.** It does not send a `Cookie` header on webhook requests and it does not retain `Set-Cookie` from your response. Any `session[...]` access in a Twilio messaging webhook is therefore **silently broken** after migration: `session.get('question_id', 0)` returns the default on every single request, so the survey above answers question 1 forever. Nothing raises — the endpoint returns 200 and the conversation never advances. Grep for `session[`, `request.cookies`, `req.cookies`, and `flask.session` in every messaging webhook before you migrate.

Key the state on the phone-number pair instead:

```python
# Telnyx — state keyed by conversation, stored server-side (Redis shown)
import json, os, redis
from flask import abort, request
from telnyx import Telnyx

r = redis.from_url(os.environ['REDIS_URL'])
client = Telnyx(
    api_key=os.environ['TELNYX_API_KEY'],
    public_key=os.environ['TELNYX_PUBLIC_KEY'],
)
SESSION_TTL = 60 * 60 * 4          # 4h, matching Twilio's cookie lifetime

def verified_telnyx_data():
    raw_body = request.get_data(as_text=True)
    try:
        client.webhooks.unwrap(raw_body, headers=request.headers)
    except Exception:
        abort(403)
    return json.loads(raw_body)['data']

def _key(their_number, our_number):
    return f"sms:{our_number}:{their_number}"

def claim_survey_event(event_id):
    event_key = f"telnyx:survey-event:{event_id}"
    if r.set(event_key, 'pending', nx=True, ex=300):
        return event_key, 'claimed'
    return event_key, (r.get(event_key) or b'pending').decode()

@app.route('/sms', methods=['POST'])
def survey():
    event = verified_telnyx_data()
    if event.get('event_type') != 'message.received':
        return '', 200
    event_key, claim = claim_survey_event(event['id'])
    if claim == 'completed':
        return '', 200
    if claim == 'pending':
        return '', 503
    payload = event['payload']
    their_number = payload['from']['phone_number']
    our_number   = payload['to'][0]['phone_number']
    body         = payload.get('text', '')

    key = _key(their_number, our_number)
    # Distinct events for one conversation can arrive concurrently. Serialize
    # the complete read/modify/send/write transition for that number pair.
    with r.lock(f"{key}:lock", timeout=30, blocking_timeout=5):
        state = json.loads(r.get(key) or '{}')
        qid = state.get('question_id', 0)
        answers = state.get('answers', [])
        answers.append(body)

        if qid < len(QUESTIONS):
            reply = QUESTIONS[qid]
            next_state = {'question_id': qid + 1, 'answers': answers}
        else:
            reply = "All done, thanks!"
            next_state = None

        try:
            client.messages.send(to=their_number, from_=our_number, text=reply)
            if next_state is None:
                save_survey(their_number, answers)
                r.delete(key)
            else:
                r.setex(key, SESSION_TTL, json.dumps(next_state))
            r.set(event_key, 'completed', ex=86400)
        except Exception:
            r.delete(event_key)
            raise
    return '', 200
```

Notes on the rewrite:

- **Key on both numbers**, not just the sender. One user texting two of your numbers is two conversations — the same isolation Twilio's per-number cookie gave you for free.
- **Set a TTL.** Cookies expired on their own; rows in your datastore do not. Roughly 4 hours matches Twilio's messaging cookie lifetime; pick what suits your flow, but pick something.
- **Redis is illustrative.** Any shared store works (Postgres table, DynamoDB, Django's cache/session framework with a non-cookie backend). What does *not* work is process memory — a dict keyed by phone number breaks the moment you run more than one worker, and breaks intermittently, which is worse.
- **Serialize each conversation.** Event deduplication handles retries of one event; the per-conversation lock prevents two different inbound messages from reading and overwriting the same survey state concurrently.
- **Make the handler idempotent.** The pending/completed event guard above prevents an ordinary webhook retry from advancing the conversation twice. For strict crash safety between an accepted outbound send and the final Redis writes, use the durable-outbox pattern described above.

### Migration checklist for inbound SMS handlers

- [ ] Every `MessagingResponse` / `<Response><Message>` construction removed
- [ ] Each reply replaced with `client.messages.send(...)` including `from_` (pass `messaging_profile_id` only to override the number's assigned profile)
- [ ] `from_` read from `data.payload.to[0].phone_number`, not hardcoded
- [ ] Ed25519 signature and timestamp verified against the raw request body before parsing fields, changing state, enqueuing work, or sending a reply
- [ ] Webhook returns an empty **200** (body ignored by Telnyx)
- [ ] Every `session[...]` / cookie read replaced with server-side lookup keyed on the number pair
- [ ] Session store has a TTL and is shared across workers (not in-process)
- [ ] Handler is idempotent against webhook retries

## MMS and Media

```python
# Twilio MMS
message = client.messages.create(
    to="+15559876543",
    from_="+15551234567",
    body="Check this out",
    media_url=["https://example.com/image.jpg"]
)

# Telnyx MMS
message = client.messages.send(
    to="+15559876543",
    from_="+15551234567",
    text="Check this out",
    media_urls=["https://example.com/image.jpg"],
    messaging_profile_id="YOUR_MESSAGING_PROFILE_ID"
)
```

Telnyx MMS supports images (JPEG, PNG, GIF), audio, video, and vCard. Maximum media size: 1 MB for most carriers.

## Messaging Profiles

Telnyx uses **Messaging Profiles** to configure message routing, webhooks, and features. This is analogous to Twilio's Messaging Service.

Create a profile in the portal or via API:

```bash
curl -X POST https://api.telnyx.com/v2/messaging_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App",
    "whitelisted_destinations": ["US"],
    "webhook_url": "https://example.com/webhooks/messaging",
    "webhook_failover_url": "https://example.com/webhooks/messaging-backup"
  }'
```

`name` and `whitelisted_destinations` are both **required** on profile creation. `whitelisted_destinations` is an array of ISO country codes the profile is allowed to send to (e.g., `["US"]`).

Then assign numbers to the profile. All messages to/from those numbers use the profile's webhook configuration.

## Messaging Service → Messaging Profile Migration

If you're using Twilio Messaging Services, here's how to map them to Telnyx Messaging Profiles:

| Twilio Messaging Service Feature | Telnyx Messaging Profile Feature |
|---|---|
| Friendly name | `name` |
| Webhook URL (StatusCallback) | `webhook_url` |
| Fallback URL | `webhook_failover_url` |
| Sticky Sender | `number_pool_settings.sticky_sender` |
| Smart Encoding | `smart_encoding` (boolean, configurable on the Messaging Profile) |
| MMS Converter | `mms_transcoding` + `mms_fall_back_to_sms` (booleans, configurable on the Messaging Profile) |
| Area Code Geomatch | `number_pool_settings.geomatch` |
| Copilot Features | Configure on the Messaging Profile |

`number_pool_settings` accepts these documented keys: `toll_free_weight`, `long_code_weight`, `skip_unhealthy`, `sticky_sender`, and `geomatch`. Set the whole field to `null` to disable number-pool routing.

**Steps to migrate:**

1. Create a Messaging Profile for each Messaging Service:
   ```bash
   curl -X POST https://api.telnyx.com/v2/messaging_profiles \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "My Messaging Service Replacement",
       "whitelisted_destinations": ["US"],
       "webhook_url": "https://example.com/webhooks/messaging",
       "webhook_failover_url": "https://example.com/webhooks/messaging-backup"
     }'
   ```
   To enable number-pool routing, also send the documented `number_pool_settings` keys that match your policy:
   ```bash
   # Include this object in the create payload:
   "number_pool_settings": {
     "toll_free_weight": 10,
     "long_code_weight": 1,
     "skip_unhealthy": true,
     "sticky_sender": true,
     "geomatch": true
   }
   ```
2. Assign phone numbers to the profile
3. Replace `MessagingServiceSid` according to the sender type: pass `messaging_profile_id` explicitly for number-pool and alphanumeric-sender requests; a phone-number or short-code send may omit it when that sender is already assigned to the intended Messaging Profile

## Alphanumeric Sender ID & Toll-Free Verification

### Alphanumeric Sender ID

Both Twilio and Telnyx support alphanumeric sender IDs in supported countries. On Telnyx:

- Register your sender ID via the Mission Control Portal or API
- Sender IDs must be 1-11 alphanumeric characters (spaces are allowed) and contain at least one letter
- Include `messaging_profile_id` in every alphanumeric-sender request; the Messages API requires it for this sender type
- Country-specific registration may be required (e.g., UK, Germany)
- Not available in the US or Canada (carrier restriction, not Telnyx-specific)

### Toll-Free Verification

US toll-free numbers require carrier-managed verification for SMS/MMS. This is separate from 10DLC brand and campaign registration through The Campaign Registry (TCR):

1. Submit the business identity, use case, opt-in workflow, and realistic sample messages
2. Include `businessRegistrationNumber`, `businessRegistrationType`, and `businessRegistrationCountry`; these BRN fields have been required for new submissions since February 17, 2026
3. Allow roughly 1-2 weeks for carrier review
4. Treat unverified numbers as limited-throughput and subject to carrier filtering

On Telnyx, manage toll-free verification through the Mission Control Portal under **Messaging** → **Toll-Free Verification**.

## 10DLC Registration

Both Twilio and Telnyx use The Campaign Registry (TCR) for 10DLC compliance. The process is the same:

1. **Register your brand** (business identity)
2. **Create a campaign** (use case: marketing, 2FA, customer care, etc.)
3. **Assign numbers** to the campaign

Telnyx provides 10DLC registration via the Mission Control Portal (**Messaging** → **10DLC**) or via API.

> **Complete 10DLC API examples** with all parameters are in the sdk-reference files: `sdk-reference/{language}/10dlc.md`.

## Short Codes and Toll-Free

| Feature | Twilio | Telnyx |
|---|---|---|
| Dedicated short codes | Supported | Supported |
| Shared short codes | Deprecated | Not available |
| Toll-free SMS | Supported | Supported |
| Toll-free verification | Required | Required (via portal or API) |
| Alphanumeric sender ID | Supported (select countries) | Supported (select countries) |

## Webhook Payload Mapping

| Twilio Field | Telnyx Field | Location in Telnyx Payload |
|---|---|---|
| `MessageSid` | `id` | `data.payload.id` |
| `From` | `from.phone_number` | `data.payload.from.phone_number` |
| `To` | `to[0].phone_number` | `data.payload.to[0].phone_number` |
| `Body` | `text` | `data.payload.text` |
| `NumMedia` | `media.length` | `data.payload.media` (array) |
| `MediaUrl0` | `media[0].url` | `data.payload.media[0].url` |
| `MessageStatus` | `event_type` + per-recipient `status` | `data.event_type` is `message.sent` then `message.finalized`; the actual delivery result is per-recipient in `data.payload.to[0].status` (`delivered`, `delivery_failed`, `sending_failed`) |
| `ErrorCode` | `errors` | `data.payload.errors` (array) |

> There is no `message.delivered` / `message.failed` event. Telnyx emits an intermediate `message.sent` and a terminal `message.finalized`; read the outcome from `data.payload.to[0].status`.

## Error Code Mapping

| Scenario | Twilio Error | Telnyx Error |
|---|---|---|
| Invalid destination | 21211 | `40310` — Invalid 'to' address (sync 400 error) |
| Unsubscribed recipient | 21610 | `40300` — recipient opted out (synchronous; do not retry) |
| Rate limit exceeded | 14107 / 30022 | HTTP 429 / generic API rate limit, or `40011` for an asynchronous upstream carrier limit |
| Carrier rejected | 30007 | Inspect the finalized event: Telnyx uses specific delivery codes such as `40002`, `40003`, and `40004` rather than `40300` |
| Number not provisioned for this profile | 21606 | `40305` — invalid `from` address / sender is not associated with the Messaging Profile |

Telnyx error details are included in webhook delivery-status events and in API error responses.

## Async / Background Task Patterns

If the Twilio codebase uses Celery, Sidekiq, or other task queues for messaging, the migration is straightforward — only the API call inside the task changes.

### Celery (Python)

```python
# Twilio (before):
# @app.task
# def send_sms(to, body):
#     client = Client(TWILIO_SID, TWILIO_TOKEN)
#     client.messages.create(to=to, body=body, from_=TWILIO_NUMBER)

# Telnyx (after):
import os
from telnyx import Telnyx
from celery import shared_task

client = Telnyx(api_key=os.environ.get('TELNYX_API_KEY'))

@shared_task(bind=True, max_retries=3)
def send_sms(self, to, text):
    try:
        result = client.messages.send(
            from_=os.environ['TELNYX_PHONE_NUMBER'],
            to=to,
            text=text,  # 'text' not 'body'
            # messaging_profile_id optional: the from_ number's assigned
            # profile applies by default; pass it only to override.
        )
        if result.data is None:
            raise RuntimeError("Telnyx message send returned no data")
        return {'id': result.data.id, 'to': to}
    except Exception as e:
        # Retry with exponential backoff on transient errors
        if hasattr(e, 'status_code') and e.status_code == 429:
            raise self.retry(countdown=2 ** self.request.retries)
        if hasattr(e, 'status_code') and 400 <= e.status_code < 500:
            raise  # Don't retry on 4xx client errors
        raise self.retry(countdown=5)
```

### Django + Celery Webhook Handler

```python
# Process inbound messages asynchronously
@csrf_exempt
@require_POST
def telnyx_messaging_webhook(request):
    data = json.loads(request.body)
    event_type = data['data']['event_type']

    if event_type == 'message.received':
        payload = data['data']['payload']
        # Offload to Celery task
        process_inbound_message.delay(
            from_number=payload['from']['phone_number'],
            text=payload.get('text', ''),
            media=[m['url'] for m in payload.get('media', [])],
        )

    return JsonResponse({'status': 'ok'})
```

**Key migration notes for async patterns:**
- Replace `body` with `text` in the task function signature and call
- For phone-number sends, ensure `from` is assigned to the intended Messaging Profile and pass `messaging_profile_id` only to override it; for number-pool or alphanumeric-sender sends, include the required `messaging_profile_id`
- Handle `telnyx.error.RateLimitError` (HTTP 429) with retry logic
- Do not hard-code 1 MPS for 10DLC: throughput varies by campaign, carrier, use case, and brand vetting score, and account/profile limits also apply. Pace or queue traffic to the current limits and honor `retry-after` and Telnyx rate-limit headers when retrying.

## Testing

When migrating tests from Twilio to Telnyx, update mocks, payloads, and assertions.

### Mock Patterns

**Python (pytest/unittest):**
```python
# Twilio mock:
# @patch('twilio.rest.Client')
# def test_send(mock_client):
#     mock_client.return_value.messages.create.return_value.sid = 'SM...'

# Telnyx mock (v4 SDK — client.messages.send):
@patch('your_module.client.messages.send')  # patch where client is used
def test_send(mock_send):
    mock_send.return_value = type('obj', (object,), {
        'data': type('obj', (object,), {
            'id': '4010000e-1234-5678-abcd-1234567890ab',
            'to': [{'phone_number': '+15559876543'}],
            'text': 'Hello',
            'type': 'SMS',
        })()
    })()
    result = send_message('+15559876543', 'Hello')
    mock_send.assert_called_once()
    assert result.data.id is not None
```

**JavaScript (Jest):**
```javascript
// Twilio mock:
// jest.mock('twilio', () => ...)

// Telnyx mock:
jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      send: jest.fn().mockResolvedValue({
        data: {
          id: '4010000e-1234-5678-abcd-1234567890ab',
          to: [{ phone_number: '+15559876543' }],
          text: 'Hello',
          type: 'SMS',
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
    "event_type": "message.received",
    "id": "evt-uuid",
    "occurred_at": "2024-01-15T10:30:00Z",
    "payload": {
      "id": "msg-uuid",
      "from": { "phone_number": "+15551234567" },
      "to": [{ "phone_number": "+15559876543" }],
      "text": "Test message",
      "type": "SMS",
      "media": [],
      "direction": "inbound"
    },
    "record_type": "event"
  },
  "meta": { "attempt": 1 }
}
```

### Assertion Changes

| Twilio Assertion | Telnyx Assertion |
|---|---|
| `assert result is not None` | `assert result.data is not None` (guard the optional response envelope) |
| `assert result.sid.startswith('SM')` | `assert result.data.id is not None` (UUID format) |
| `assert result.body == 'Hello'` | `assert result.data.text == 'Hello'` |
| `assert result.from_ == '+15551234567'` | `assert result.data.from_ is not None; assert result.data.from_.phone_number == '+15551234567'` |
| `assert result.status == 'queued'` | `assert result.data.type == 'SMS'` (status via webhook) |
