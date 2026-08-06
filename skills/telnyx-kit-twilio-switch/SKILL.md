---
name: telnyx-kit-twilio-switch
description: >-
  Orient fast when moving from Twilio to Telnyx: concept and name mapping,
  the differences that silently break ported code, and when to hand off to
  the full telnyx-twilio-migration skill. Use when the user mentions Twilio,
  TwiML, a Messaging Service, or pasting Twilio code to convert.
metadata:
  author: telnyx
  product: platform
  kind: advisor
---

# Coming from Twilio

Most Twilio concepts have a Telnyx equivalent with a different name. The
danger is not the renames — it is the handful of differences that make ported
code fail **silently**, with a 200 response and nothing happening.

## Name mapping

| Twilio | Telnyx | Note |
|---|---|---|
| Account SID + Auth Token | API key v2 (`Authorization: Bearer`) | one credential, not a pair |
| Messaging Service SID | `messaging_profile_id` | per-request passing is an OVERRIDE; the sending number's assignment is the norm |
| TwiML | TeXML | same verb vocabulary, different runtime — see silent breakage below |
| TwiML App | TeXML Application | |
| Programmable Voice REST | Call Control API | imperative commands against a `call_control_id` |
| Verify Service | Verify Profile | channel is chosen by the ENDPOINT (`/v2/verifications/sms\|call\|flashcall`), not a `type` body field |
| Lookup `Fields=` | `?type=carrier` / `?type=caller-name` | data is null unless requested |
| Access Token (Voice SDK) | SIP credential / credential connection | no backend token service required |
| Studio flow | (no equivalent) | extract the logic, then migrate the code |
| TaskRouter, Flex, Sync, Proxy, Autopilot | (no equivalent) | keep on Twilio or build custom |

## The five silent breakers

1. **TeXML attributes are case-sensitive and unknown ones are ignored.**
   `transcribe=`, `Timeout=`, `numdigits=`, `speechModel=` are dead at runtime
   with no error — transcription and digit collection just never happen. Same
   for unknown verbs: dropped silently.
2. **Recording defaults flipped.** Telnyx records dual-channel by default;
   Twilio single. Set `channels="single"` (and `recordingChannels="single"`
   on `<Dial>`) to preserve behavior.
3. **Delivery events differ.** There is no `message.delivered`. Outcome
   arrives in `message.finalized` at `data.payload.to[0].status`. Retry logic
   keyed on Twilio's event names never fires.
4. **Webhook payloads are nested JSON, not flat form-encoded.**
   `data.event_type` and `data.payload.*` — code reading `req.body.From`
   silently sees undefined.
5. **Signatures are Ed25519, not HMAC-SHA1.** A ported verifier fails closed
   (or worse, is left disabled).

Two more worth knowing: Telnyx supports payments through the TeXML `<Pay>`
verb. Create a Telnyx Payment Connector, translate and validate the `<Pay>`
attributes, then exercise the payment progress and completion callbacks in
test mode before switching the connector to live mode. Follow the
[Pay over Voice guide](https://developers.telnyx.com/docs/voice/programmable-voice/pay)
instead of silently dropping the payment step. Telnyx also returns HTTP `409`
preconditions (e.g. `40312` profile disabled) that Twilio has no counterpart
for — ported code usually has no 409 branch and surfaces it as an unhandled
exception. Never retry a 409 in a backoff loop.

## Choosing the voice path

- Twilio app is **TwiML-driven** → TeXML. Nearly a drop-in: same verbs, swap
  the endpoint and auth, then validate the XML against the runtime's verb and
  attribute rules.
- Twilio app **drives calls from code** (dynamic routing, AI agents) → Call
  Control. Each action is a REST command; no XML round-trip.
- Twilio **Media Streams** (`<Connect><Stream>`) → TeXML `<Connect><Stream>`
  or Call Control streaming. Field renames: `streamSid` → `stream_id`,
  `callSid` → `call_control_id`.

## When to hand off

For anything beyond orientation — an actual codebase to migrate — switch to
the **`telnyx-twilio-migration`** skill (in the `telnyx-platform` plugin). It
runs a 6-phase migration with automated scanners, a TeXML validator that
catches the silent breakers above, per-language SDK references, and live
integration tests. This skill is the map; that one is the machinery.
