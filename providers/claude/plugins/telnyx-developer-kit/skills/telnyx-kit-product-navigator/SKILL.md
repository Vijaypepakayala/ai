---
name: telnyx-kit-product-navigator
description: >-
  Pick the right Telnyx product and API for a job before writing code. Use at
  the START of any Telnyx build: maps use cases (notifications, 2FA, voice
  agents, contact centers, email, IoT, video, fax, Twilio migration) to the correct
  product, API surface, and companion skill.
metadata:
  author: telnyx
  product: platform
  kind: advisor
---

# Telnyx Product Navigator

Answer three questions, then jump to the row that matches. Install the named
product plugin (`/plugin install telnyx-<product>@telnyx`) for deep guidance.

## Use case → product

| You want to… | Product | API surface | Deep-dive |
|---|---|---|---|
| Send SMS/MMS notifications | Messaging | `POST /v2/messages` | telnyx-messaging plugin |
| Verify users by OTP (SMS, call, flash call) | Verify | `POST /v2/verifications/{sms\|call\|flashcall}` | telnyx-verify plugin |
| Send WhatsApp messages | WhatsApp Business | WhatsApp API | telnyx-whatsapp plugin |
| Send or receive email | Email | `/v2/email_messages` + inbox/domain APIs | telnyx-email plugin |
| Serve voice menus / IVR from XML | TeXML | TeXML Application + XML docs | telnyx-platform plugin |
| Drive calls imperatively from code (AI agents, dynamic flows) | Call Control | `POST /v2/calls` + per-call actions | telnyx-voice plugin |
| Build a browser/mobile softphone | WebRTC SDKs | Credential connections + SDKs | telnyx-webrtc plugin |
| Real-time media into your AI model | Media Streaming | `<Connect><Stream>` or Call Control streaming | telnyx-voice plugin |
| Speech-to-text / text-to-speech | STT / TTS | OpenAI-compatible + TTS API | telnyx-stt / telnyx-tts plugins |
| Buy, configure, port numbers | Numbers | `/v2/available_phone_numbers`, `/v2/number_orders`, porting | telnyx-numbers plugin |
| Look up carrier/caller data for a number | Number Lookup | `GET /v2/number_lookup/{number}` | telnyx-numbers plugin |
| Send/receive fax | Programmable Fax | `POST /v2/faxes` (requires `connection_id`) | telnyx-platform plugin |
| Connect a PBX/SIP system | SIP Trunking | credential or IP connections | telnyx-platform plugin |
| Cellular connectivity for devices | IoT SIM | `/v2/sim_cards` (eSIM buys use `amount`) | telnyx-platform plugin |
| Video rooms | Video | `/v2/rooms` + top-level room resources | telnyx-webrtc plugin |
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
- **Coming from Twilio**: product names map non-obviously (Messaging Service
  → messaging profile, TwiML App → TeXML Application, Verify Service →
  Verify profile). The telnyx-twilio-migration skill has the complete
  mapping plus automated scanners.

## Anti-patterns

- Hand-rolling OTP flows on raw SMS when Verify exists.
- Polling call state when webhooks/streaming deliver events.
- Buying numbers without checking `cost_information.monthly_cost` first.
- Treating fax/video/IoT as unsupported: they are first-class APIs.
