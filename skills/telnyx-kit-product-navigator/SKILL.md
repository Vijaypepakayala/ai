---
name: telnyx-kit-product-navigator
description: >-
  Pick the right Telnyx product and API for a job before writing code. Use at
  the START of any Telnyx build: maps use cases (notifications, 2FA, voice
  agents, contact centers, IoT, video, fax, Twilio migration) to the correct
  product, API surface, and companion skill. Do not use for a fixed-design
  compliance review, a runtime incident diagnosis, or a task where the Telnyx
  product has already been selected.
metadata:
  author: telnyx
  product: platform
  kind: advisor
---

# Telnyx Product Navigator

Answer three questions, then jump to the row that matches.

## Continue in your client

- **Claude or Codex with the Telnyx Developer Kit installed**: Use the
  installed `telnyx` hosted MCP: call
  `list_api_endpoints` to discover the relevant operation, then call
  `get_api_endpoint_schema` for the selected endpoint before writing a request.
  The public catalog is documentation-only and cannot execute account API
  operations. Use its exact schema to generate implementation guidance or SDK
  code; use only a separately reviewed focused MCP App when account inspection
  is required. Do not ask for or accept a Telnyx API key in chat. Do not install
  another product plugin unless the user explicitly asks to add that separate
  package after reviewing its capabilities.
- **Cursor**: Matching canonical product skills are already bundled in the
  flat Telnyx Cursor plugin. Load the relevant `telnyx-<product>-*` skill or
  skills from the current installation; do not run Claude `/plugin install`
  commands.

## Use case → product

| You want to… | Product | API surface | Optional reference pack |
|---|---|---|---|
| Send SMS/MMS notifications or alerts | Messaging | `POST /v2/messages` | telnyx-messaging plugin |
| Verify users by OTP (SMS, call, flash call) | Verify | `POST /v2/verifications/{sms\|call\|flashcall}` | telnyx-verify plugin |
| Send WhatsApp messages | WhatsApp Business | WhatsApp API | telnyx-whatsapp plugin |
| Serve voice menus / IVR from XML | TeXML | TeXML Application + XML docs | telnyx-voice plugin |
| Drive calls imperatively from code (AI agents, dynamic flows) | Call Control | `POST /v2/calls` + per-call actions | telnyx-voice plugin |
| Build a browser/mobile softphone | WebRTC SDKs | Credential connections + SDKs | telnyx-webrtc plugin |
| Real-time media into your AI model | Media Streaming | `<Connect><Stream>` or Call Control streaming | telnyx-voice plugin |
| Speech-to-text / text-to-speech | STT / TTS | OpenAI-compatible + TTS API | telnyx-stt / telnyx-tts plugins |
| Buy, configure, port numbers | Numbers | `/v2/available_phone_numbers`, `/v2/number_orders`, porting | telnyx-numbers plugin |
| Look up carrier/caller data for a number | Number Lookup | `GET /v2/number_lookup/{number}` | telnyx-numbers plugin |
| Send/receive fax | Programmable Fax | `POST /v2/faxes` (requires `connection_id`) | telnyx-platform plugin |
| Connect a PBX/SIP system | SIP Trunking | credential or IP connections | telnyx-platform plugin |
| Cellular connectivity for devices | IoT SIM | `/v2/sim_cards` (eSIM buys use `amount`) | telnyx-platform plugin |
| Video rooms | Video | `/v2/rooms` + top-level room resources | telnyx-platform plugin |
| Move an existing Twilio app | Migration | — | telnyx-twilio-migration skill (in telnyx-platform) |

## Decision rules the tables cannot express

- **TeXML vs Call Control**: TeXML when your logic fits declarative XML
  responses to webhooks (classic IVR, Twilio-style apps — and the direct
  TwiML migration target). Call Control when code must decide mid-call
  (AI agents, complex routing): every action is a REST command against
  `call_control_id`, no XML round-trip.
- **US A2P sender registration is sender-specific**: local 10-digit long
  codes use a 10DLC brand and campaign linked to the sending number's
  messaging profile; toll-free senders use toll-free verification; short
  codes use carrier approval/provisioning. Consent and opt-out handling,
  including STOP, apply to every sender type (see telnyx-kit-guardrails).
- **A message needs a messaging profile via the sending number's assignment
  or an explicit `messaging_profile_id`** — per-request passing is an
  override, not a requirement.
- **Voice AI stack shortcut**: inbound number → TeXML `<Connect><Stream>` or
  Call Control streaming → your model → TTS back. Do not build a webhook
  server just to answer calls if `<Connect>` to an AI Assistant fits.
- **Any voice flow that records or transcribes**: route through
  telnyx-kit-guardrails before implementation so recording starts only after
  applicable notice/consent and the retention, access, deletion, and failover
  policy is explicit.
- **Coming from Twilio**: product names map non-obviously (Messaging Service
  → messaging profile, TwiML App → TeXML Application, Verify Service →
  Verify profile). In the Telnyx Developer Kit, use `list_api_endpoints` for
  the corresponding Messaging, TeXML, Verify, Numbers, or other Telnyx
  operation, then inspect each selected operation with
  `get_api_endpoint_schema`. Treat any separate
  migration package as an explicit user choice, not an automatic dependency.

## Anti-patterns

- Hand-rolling OTP flows on raw SMS when Verify exists.
- Polling call state when webhooks/streaming deliver events.
- Buying numbers without checking `cost_information.monthly_cost` first.
- Treating fax/video/IoT as unsupported: they are first-class APIs.
