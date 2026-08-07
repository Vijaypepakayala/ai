# Telnyx Voice Monitor MCP App

Read-only Telnyx MCP App for active-call monitoring, call timelines, call status, and post-call recording discovery.

## Tools

- `voice_monitor_list_options` — discovers connections, call-control applications, and voice numbers for dropdowns.
- `voice_monitor_active_calls` — lists active calls for a selected connection, or a capped set of discovered connections when omitted. The aggregate response is capped near 1 MiB and stops querying later connections once the cap is reached.
- `voice_monitor_call_timeline` — reads `GET /call_events` with supported deepObject filters.
- `voice_monitor_call_status` — reads `GET /calls/{call_control_id}`.
- `voice_monitor_recordings` — searches recordings with sensitive URLs/transcripts/metadata redacted.

## Safety

This app is read-only. It does not answer, hang up, transfer, speak, record, modify conferences, modify queues, or mutate Telnyx resources.

The app preserves operational IDs needed for follow-up (`connection_id`, `call_control_id`, `call_leg_id`, `call_session_id`) while redacting phone numbers, credentials, recording URLs, transcripts, and metadata.

Active-call payloads appear once in `active_calls`; `per_connection` contains counts only, avoiding duplicate large arrays. A bounded partial response sets `truncated_output: true`, includes an explicit warning, and lists only the connections actually queried. Every tool also has a final serialized-output cap with a generic safe error if an upstream shape cannot be returned safely.

## Configuration

Copy `.env.example` and set:

```sh
TELNYX_API_KEY=***
TELNYX_API_BASE_URL=https://api.telnyx.com/v2 # optional; root form is also accepted
```

Optional guardrails:

```sh
VOICE_MONITOR_MAX_PAGE_SIZE=100
VOICE_MONITOR_MAX_DISCOVERY_CONNECTIONS=10
VOICE_MONITOR_MAX_TIMELINE_WINDOW_HOURS=168
VOICE_MONITOR_MAX_RECORDING_WINDOW_HOURS=168
```

## Development

From `tools/mcp-apps`:

```sh
npm install
npm --workspace @telnyx-mcp-apps/voice-monitor test
npm --workspace @telnyx-mcp-apps/voice-monitor run typecheck
npm --workspace @telnyx-mcp-apps/voice-monitor run build
```
