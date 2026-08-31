# Video Migration: Twilio Video to Telnyx Video Rooms

Migrate from Twilio Video (retired December 5, 2024) to the Telnyx Video Rooms API.

## Table of Contents

- [Overview](#overview)
- [Key Differences](#key-differences)
- [Concept Mapping](#concept-mapping)
- [Step 1: Create a Video Room](#step-1-create-a-video-room)
- [Step 2: Generate Client Tokens](#step-2-generate-client-tokens)
- [Step 3: Connect Clients via SDK](#step-3-connect-clients-via-sdk)
- [Step 4: Manage Participants](#step-4-manage-participants)
- [Step 5: Recording](#step-5-recording)
- [Room Sessions and Lifecycle](#room-sessions-and-lifecycle)
- [Client SDK Migration](#client-sdk-migration)
- [Compositions](#compositions)
- [API Endpoint Mapping](#api-endpoint-mapping)
- [Common Pitfalls](#common-pitfalls)

## Overview

Twilio retired its Video product on December 5, 2024. If you are migrating from Twilio Video, Telnyx Video Rooms provides a comparable platform for adding real-time audio and video capabilities to web, iOS, and Android applications.

Telnyx Video Rooms consists of:
- **REST API (v2)** for server-side room management, token generation, and recording
- **Client SDKs** (JavaScript, iOS, Android) for browser and mobile integration
- **Compositions API** for combining recordings into a single output

## Key Differences

1. **Twilio Video is retired** — As of December 5, 2024, Twilio Video is no longer available. Telnyx Video Rooms is actively supported.
2. **Room model** — Twilio used Room Types (Group, Peer-to-Peer, Go). Telnyx uses a single room model with configurable `max_participants`.
3. **Token format** — Twilio used Access Tokens (JWT with Video Grant). Telnyx uses Client Join Tokens (JWT) generated via a dedicated API endpoint.
4. **Refresh tokens** — Telnyx provides a Refresh Token alongside the Client Join Token for extending sessions without re-authenticating.
5. **Server-side participant control** — Telnyx provides REST API endpoints to mute, unmute, and kick participants from active sessions.
6. **Webhook signatures** — Twilio used HMAC-SHA1. Telnyx uses Ed25519.

## Concept Mapping

| Twilio Video Concept | Telnyx Equivalent | Notes |
|---|---|---|
| Room | Room | Created via `POST /v2/rooms` |
| Room SID | Room `id` (UUID) | Different ID format |
| Room Type (Group, P2P, Go) | `max_participants` setting | No named types; configure participant limit |
| Room UniqueName | `unique_name` | Same concept |
| Access Token (JWT + Video Grant) | Client Join Token (JWT) | Generated via `POST /v2/rooms/{id}/actions/generate_join_client_token` |
| N/A | Refresh Token | Provided with join token for session extension |
| Participant SID | Participant `id` | Managed via Sessions API |
| Room Session | Room Session | `GET /v2/rooms/{id}/sessions` to list |
| Composition | Composition | `POST /v2/room_compositions` |
| Recording | Recording | Top-level recording management (`GET /v2/room_recordings`) |
| Track (Audio/Video/Data) | Media streams | Managed via Client SDK |
| Room Status Callback | Webhook events on room | Configured via `webhook_event_url` |
| Twilio Video JS SDK | `@telnyx/video` JS SDK | Different API surface |
| Twilio Video iOS SDK | Telnyx Video iOS SDK | See iOS client SDK docs |
| Twilio Video Android SDK | Telnyx Video Android SDK | See Android client SDK docs |

## Step 1: Create a Video Room

### curl

```bash
# Twilio (no longer available)
curl -X POST "https://video.twilio.com/v1/Rooms" \
  -u "$TWILIO_SID:$TWILIO_AUTH_TOKEN" \
  -d "UniqueName=my-meeting" \
  -d "Type=group" \
  -d "MaxParticipants=10" \
  -d "RecordParticipantsOnConnect=true" \
  -d "StatusCallback=https://example.com/video-events"

# Telnyx
curl -X POST https://api.telnyx.com/v2/rooms \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "unique_name": "my-meeting",
    "max_participants": 10,
    "enable_recording": true,
    "webhook_event_url": "https://example.com/video-events"
  }'
```

### Python

```python
# Twilio (no longer available)
from twilio.rest import Client
client = Client(account_sid, auth_token)
room = client.video.rooms.create(
    unique_name="my-meeting",
    type="group",
    max_participants=10,
    record_participants_on_connect=True,
    status_callback="https://example.com/video-events"
)

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

room = client.rooms.create(
    unique_name="my-meeting",
    max_participants=10,
    enable_recording=True,
    webhook_event_url="https://example.com/video-events"
)
if room.data is None:
    raise RuntimeError("Telnyx room creation returned no data")
print(room.data.id)
```

### JavaScript

```javascript
// Twilio (no longer available)
const twilio = require('twilio');
const client = twilio(accountSid, authToken);
const room = await client.video.rooms.create({
  uniqueName: 'my-meeting',
  type: 'group',
  maxParticipants: 10,
  recordParticipantsOnConnect: true,
  statusCallback: 'https://example.com/video-events'
});

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });

const room = await client.rooms.create({
  unique_name: 'my-meeting',
  max_participants: 10,
  enable_recording: true,
  webhook_event_url: 'https://example.com/video-events'
});
console.log(room.data.id);
```

**Room creation parameters:**

| Parameter | Description |
|---|---|
| `unique_name` | Human-readable room identifier |
| `max_participants` | Maximum number of concurrent participants |
| `enable_recording` | Enable automatic recording (boolean) |
| `webhook_event_url` | URL for room and participant events |
| `webhook_event_failover_url` | Backup webhook URL |
| `webhook_timeout_secs` | Webhook delivery timeout |

**Room response fields:**

| Field | Description |
|---|---|
| `id` | Room UUID |
| `unique_name` | The name you assigned |
| `max_participants` | Configured limit |
| `enable_recording` | Recording status |
| `active_session_id` | UUID of the currently active session, if any |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

## Step 2: Generate Client Tokens

Clients need a JWT token to join a room. In Twilio, you generated Access Tokens server-side with a Video Grant. In Telnyx, you use a dedicated token generation endpoint.

### curl

```bash
# Twilio (no longer available) — generated server-side with SDK
# Required: AccountSID, API Key SID, API Key Secret, Room Name

# Telnyx
curl -X POST "https://api.telnyx.com/v2/rooms/$ROOM_ID/actions/generate_join_client_token" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token_ttl_secs": 3600,
    "token_ttl_secs": 600
  }'
```

### Python

```python
# Twilio (no longer available)
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VideoGrant
token = AccessToken(account_sid, api_key_sid, api_key_secret, identity="user-1")
token.add_grant(VideoGrant(room="my-meeting"))
jwt_token = token.to_jwt()

# Telnyx
from telnyx import Telnyx
client = Telnyx(api_key="YOUR_TELNYX_API_KEY")

token_response = client.rooms.actions.generate_join_client_token(
    room_id,
    refresh_token_ttl_secs=3600,
    token_ttl_secs=600
)
client_token = token_response.data.token
refresh_token = token_response.data.refresh_token
```

### JavaScript

```javascript
// Twilio (no longer available)
const { jwt: { AccessToken } } = require('twilio');
const { VideoGrant } = AccessToken;
const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity: 'user-1' });
token.addGrant(new VideoGrant({ room: 'my-meeting' }));
const jwtToken = token.toJwt();

// Telnyx
const Telnyx = require('telnyx');
const client = new Telnyx({ apiKey: 'YOUR_TELNYX_API_KEY' });

const tokenResponse = await client.rooms.actions.generateJoinClientToken(roomId, {
  refresh_token_ttl_secs: 3600,
  token_ttl_secs: 600
});
const clientToken = tokenResponse.data.token;
const refreshToken = tokenResponse.data.refresh_token;
```

The **Refresh Token** is a Telnyx-specific feature with no Twilio equivalent. Use it to extend a participant's session without generating a new join token from your server.

## Step 3: Connect Clients via SDK

### JavaScript Client

```javascript
// Twilio (no longer available)
import Video from 'twilio-video';
const room = await Video.connect(token, { name: 'my-meeting' });
room.on('participantConnected', participant => {
  console.log(`${participant.identity} joined`);
});

// Telnyx (@telnyx/video 1.0.2)
import { initialize } from '@telnyx/video';
const room = await initialize({ roomId, clientToken });
room.on('participant_joined', (participantId, state) => {
  console.log(`${participantId} joined`);
});
room.on('participant_left', (participantId, state) => {
  console.log(`${participantId} left`);
});
await room.connect();
```

**SDK event mapping:**

| Twilio Video JS Event | Telnyx Video JS Event | Notes |
|---|---|---|
| `participantConnected` | `participant_joined` | Callback receives participant ID and room state |
| `participantDisconnected` | `participant_left` | Callback receives participant ID and room state |
| `trackSubscribed` | `subscription_started` | Callback receives participant ID, stream key, and room state |
| `trackUnsubscribed` | `subscription_ended` | Callback receives participant ID, stream key, and room state |
| `disconnected` | `disconnected` | Same event name |
| `reconnecting` / `reconnected` | No direct event | Observe `state_changed` / `disconnected` and implement application reconnect handling |

## Step 4: Manage Participants

Telnyx provides server-side REST API endpoints for participant management that Twilio offered through its Data Track API or REST API. These actions operate on a room **session**, not on individual participant URLs. Set `participants` to the string `"all"` or to an array of participant UUIDs; when targeting all participants, `exclude` can list UUIDs to skip.

### Mute Participants

```bash
MUTE_EXCLUDE_ID="participant_id_to_keep_unmuted"
MUTE_APPROVAL="$SESSION_ID|mute|all|exclude:$MUTE_EXCLUDE_ID"
test -n "$SESSION_ID" -a -n "$MUTE_EXCLUDE_ID" || exit 1
printf 'Mute-all approval token: %s\n' "$MUTE_APPROVAL"
test "${TELNYX_APPROVE_ROOM_MUTATION:-}" = "$MUTE_APPROVAL" || {
  echo "Session-wide mute not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.telnyx.com/v2/room_sessions/$SESSION_ID/actions/mute" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn --arg id "$MUTE_EXCLUDE_ID" \
    '{participants: "all", exclude: [$id]}')" || exit 1
```

### Unmute Participants

```bash
UNMUTE_APPROVAL="$SESSION_ID|unmute|all|exclude:none"
test -n "$SESSION_ID" || exit 1
printf 'Unmute-all approval token: %s\n' "$UNMUTE_APPROVAL"
test "${TELNYX_APPROVE_ROOM_MUTATION:-}" = "$UNMUTE_APPROVAL" || {
  echo "Session-wide unmute not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.telnyx.com/v2/room_sessions/$SESSION_ID/actions/unmute" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"participants": "all", "exclude": []}' || exit 1
```

### Kick Participants

```bash
PARTICIPANT_ID="participant-id-to-kick"
KICK_APPROVAL="$SESSION_ID|$PARTICIPANT_ID"
test -n "$SESSION_ID" -a -n "$PARTICIPANT_ID" || exit 1
printf 'Kick participant %s from room session %s\n' "$PARTICIPANT_ID" "$SESSION_ID"
test "${TELNYX_APPROVE_ROOM_KICK:-}" = "$KICK_APPROVAL" || {
  echo "Participant kick not approved" >&2; exit 1;
}
jq -n --arg participant "$PARTICIPANT_ID" \
  '{participants: [$participant], exclude: []}' |
curl -fsS -X POST "https://api.telnyx.com/v2/room_sessions/$SESSION_ID/actions/kick" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @-
```

### List Participants

```bash
# All participants (filter by room via query params)
curl -X GET "https://api.telnyx.com/v2/room_participants" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# Participants for a specific session
curl -X GET "https://api.telnyx.com/v2/room_sessions/$SESSION_ID/participants" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Step 5: Recording

Telnyx Video supports room-level recording. Enable recording when creating the room or update an existing room.

Recordings are exposed as a top-level resource. Filter the list by `room_id` to scope results to a specific room.

### List Recordings

```bash
curl -X GET -G --data-urlencode "filter[room_id]=$ROOM_ID" \
  "https://api.telnyx.com/v2/room_recordings" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### View a Recording

```bash
curl -X GET "https://api.telnyx.com/v2/room_recordings/$RECORDING_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Delete Recordings

```bash
# Enumerate the exact recording IDs for one room and review the final set.
RECORDINGS=$(curl -fsS -G -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "filter[room_id]=$ROOM_ID" \
  --data-urlencode "page[size]=250" \
  "https://api.telnyx.com/v2/room_recordings") || exit 1
RECORDING_IDS=$(jq -cer --arg room "$ROOM_ID" '
  select(.meta.total_pages == 1)
  | [.data[] | select(.room_id == $room) | .id]
  | select(length > 0 and all(.[]; type == "string" and test("\\S")))
  | unique | sort
' <<<"$RECORDINGS") || exit 1
: "${RECORDING_RECOVERY_PLAN:?Set to the reviewed backup location or irreversible-no-recovery}"
RECORDING_APPROVAL="$ROOM_ID|delete-recordings|$(jq -r 'join(",")' <<<"$RECORDING_IDS")|recovery:$RECORDING_RECOVERY_PLAN"
printf 'Recordings selected for irreversible deletion:\n%s\n' \
  "$(jq -r '.[]' <<<"$RECORDING_IDS")"
printf 'Reviewed recovery plan: %s\n' "$RECORDING_RECOVERY_PLAN"
printf 'Recording deletion approval token: %s\n' "$RECORDING_APPROVAL"
test "${TELNYX_APPROVE_RECORDING_DELETE:-}" = "$RECORDING_APPROVAL" || {
  echo "Recording deletion not approved" >&2; exit 1;
}

# Delete only the reviewed IDs; never issue a collection DELETE.
jq -r '.[]' <<<"$RECORDING_IDS" | while IFS= read -r recording_id; do
  curl -fsS -X DELETE \
    "https://api.telnyx.com/v2/room_recordings/$recording_id" \
    -H "Authorization: Bearer $TELNYX_API_KEY" || exit 1
done

```

Do not issue an unfiltered collection DELETE. For broader cleanup, enumerate
the exact recording IDs from a reviewed export and delete those IDs one at a
time after explicit confirmation.

**Recording comparison:**

| Aspect | Twilio Video (was) | Telnyx Video |
|---|---|---|
| Enable recording | `RecordParticipantsOnConnect` | `enable_recording` on room |
| Recording scope | Per-participant tracks | Per-room |
| Storage | Twilio media storage | Telnyx media storage |
| Composition | Compositions API | Compositions API |
| Download | REST API + media URL | REST API + media URL |

## Room Sessions and Lifecycle

A **Room Session** represents a single period of activity in a room. When the first participant joins, a session starts. When the last participant leaves, the session ends. A room can have multiple sessions over its lifetime.

```bash
# List sessions for a room
curl -X GET "https://api.telnyx.com/v2/rooms/$ROOM_ID/sessions" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# View a specific session
curl -X GET "https://api.telnyx.com/v2/room_sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# End a session (disconnect all participants)
END_APPROVAL="$SESSION_ID|end|all-participants"
test -n "$SESSION_ID" || exit 1
printf 'End-session approval token: %s\n' "$END_APPROVAL"
test "${TELNYX_APPROVE_ROOM_MUTATION:-}" = "$END_APPROVAL" || {
  echo "Ending the room session not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.telnyx.com/v2/room_sessions/$SESSION_ID/actions/end" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Room lifecycle comparison:**

| Twilio | Telnyx |
|---|---|
| Room auto-closes when empty | Session ends when empty; room persists |
| Room has single lifecycle | Room has multiple sessions |
| Complete a room via API | End a session via API |
| Room is a one-time resource | Room is reusable |

## Client SDK Migration

| Twilio SDK | Telnyx SDK | Install |
|---|---|---|
| `twilio-video` (npm) | `@telnyx/video` (npm) | `npm install @telnyx/video` |
| `TwilioVideo` (CocoaPods) | Telnyx Video iOS SDK | See iOS SDK docs |
| `com.twilio:video-android` | Telnyx Video Android SDK | See Android SDK docs |

The JavaScript SDK is the most mature Telnyx Video client SDK. For iOS and Android, consult the Telnyx developer documentation for the latest SDK availability and setup instructions.

## Compositions

Compositions combine individual participant recordings into a single media file. This is useful for archiving meetings or creating shareable recordings.

```bash
# Create a composition
# session_id, format, resolution, and video_layout are all optional.
# video_layout is an object describing named regions, not a preset string.
curl -X POST https://api.telnyx.com/v2/room_compositions \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "SESSION_ID",
    "format": "mp4",
    "resolution": "1280x720",
    "video_layout": {
      "main": {
        "z_pos": 1,
        "video_sources": ["*"]
      }
    }
  }'

# List compositions
curl -X GET "https://api.telnyx.com/v2/room_compositions" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## API Endpoint Mapping

| Operation | Twilio Endpoint (was) | Telnyx Endpoint |
|---|---|---|
| Create room | `POST /v1/Rooms` | `POST /v2/rooms` |
| List rooms | `GET /v1/Rooms` | `GET /v2/rooms` |
| Get room | `GET /v1/Rooms/{SID}` | `GET /v2/rooms/{id}` |
| Update room | `POST /v1/Rooms/{SID}` | `PATCH /v2/rooms/{id}` |
| Delete room | N/A | `DELETE /v2/rooms/{id}` |
| Generate token | Server-side SDK (Access Token) | `POST /v2/rooms/{id}/actions/generate_join_client_token` |
| List participants | `GET /v1/Rooms/{SID}/Participants` | `GET /v2/room_participants` or `GET /v2/room_sessions/{session_id}/participants` |
| Mute participants | Client-side only | `POST /v2/room_sessions/{session_id}/actions/mute` |
| Kick participants | `POST /Participants/{SID} (Status=disconnected)` | `POST /v2/room_sessions/{session_id}/actions/kick` |
| List sessions | N/A | `GET /v2/rooms/{id}/sessions` or `GET /v2/room_sessions` |
| Get session | N/A | `GET /v2/room_sessions/{session_id}` |
| End session | `POST /Rooms/{SID} (Status=completed)` | `POST /v2/room_sessions/{session_id}/actions/end` |
| List recordings | `GET /v1/Rooms/{SID}/Recordings` | `GET /v2/room_recordings` |
| Get recording | `GET /v1/Recordings/{SID}` | `GET /v2/room_recordings/{id}` |
| Delete recording | `DELETE /v1/Recordings/{SID}` | `DELETE /v2/room_recordings/{id}` (single) or `DELETE /v2/room_recordings` (bulk) |
| Create composition | `POST /v1/Compositions` | `POST /v2/room_compositions` |

## Common Pitfalls

1. **Token generation is server-side only** — Unlike Twilio where you generated Access Tokens using SDK helper classes, Telnyx token generation is a REST API call. Your server must call the Telnyx API and pass the token to the client.

2. **Room type does not exist** — Twilio had Group, Peer-to-Peer, and Go room types. Telnyx uses a single room model. Set `max_participants` to control room capacity. For 1:1 calls, set `max_participants: 2`.

3. **Client SDK event names differ** — `participantConnected` becomes `participant_joined`, `participantDisconnected` becomes `participant_left`. Update all event listeners.

4. **Sessions vs rooms** — Telnyx rooms are persistent and reusable. A single room can host multiple sessions. If your Twilio code creates a new room per meeting, you may want to reuse Telnyx rooms and track sessions instead.

5. **Refresh tokens are new** — Telnyx provides refresh tokens for extending sessions. Implement refresh logic in your client to avoid disconnections when the join token expires.

6. **Recording scope is room-level** — Twilio recorded individual participant tracks. Telnyx records at the room level. Use the Compositions API to combine recordings if needed.

7. **Webhook payload structure** — Telnyx webhooks use the standard nested structure (`event.data.event_type`, `event.data.payload`). This differs from Twilio's Status Callback format.

8. **Sub-resources are not nested under `/rooms/{id}/...` (with one exception) — but they ARE session-scoped where that is the natural parent.** Recordings and compositions are top-level only (`/room_recordings`, `/room_compositions`); scope them to a room by filtering on `room_id`. Participants are listed either account-wide (`GET /v2/room_participants`) **or session-scoped (`GET /v2/room_sessions/{session_id}/participants`) — use the session-scoped route when you want the participants of one session**, since participants carry `session_id`, not `room_id`. Under `/rooms/{room_id}/...` the only valid nested route is `GET /v2/rooms/{room_id}/sessions`; per-session actions (get, end, mute, kick) live at `/room_sessions/{session_id}`.
