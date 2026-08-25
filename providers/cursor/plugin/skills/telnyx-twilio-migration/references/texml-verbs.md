# TeXML Verb Reference

Complete reference for all TeXML verbs and nouns. TeXML is Telnyx's TwiML-compatible XML markup language for voice call control.

## Table of Contents

- [Document Structure](#document-structure)
- [Nesting Rules](#nesting-rules)
- [Verbs](#verbs): Say, Play, Gather, Dial, Record, Hangup, Pause, Redirect, Reject, Refer, Enqueue, Leave, Start, Stop, Connect, Pay, HttpRequest, AIGather
- [Nouns](#nouns): Number, Sip, Queue, Conference, Recording, Stream, Transcription, Suppression, Siprec, AIAssistant, ConversationRelay
- [Common Patterns](#common-patterns)
- [Telnyx-Specific Features and Options](#telnyx-specific-features-and-options)
- [TwiML Verbs Not Supported](#twiml-verbs-not-supported)

## Document Structure

Every TeXML document is wrapped in a `<Response>` root element. Verbs execute sequentially from top to bottom.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to Telnyx.</Say>
  <Pause length="1"/>
  <Gather input="dtmf" numDigits="1" action="/handle-input">
    <Say>Press 1 for sales. Press 2 for support.</Say>
  </Gather>
  <Say>We didn't receive any input. Goodbye.</Say>
  <Hangup/>
</Response>
```

## Nesting Rules

```
<Response>
  ├── <Say>                     top-level or inside <Gather>
  ├── <Play>                    top-level or inside <Gather>
  ├── <Gather>                  top-level only
  │     ├── <Say>
  │     └── <Play>
  ├── <Dial>                    top-level only
  │     ├── <Number>
  │     ├── <Sip>
  │     ├── <Queue>
  │     └── <Conference>
  ├── <Record>                  top-level only
  ├── <Hangup>                  top-level only
  ├── <Pause>                   top-level only
  ├── <Redirect>                top-level only (terminal)
  ├── <Reject>                  top-level only (terminal)
  ├── <Refer>                   top-level only
  │     └── <Sip>
  ├── <Enqueue>                 top-level only
  ├── <Leave>                   top-level or in waitUrl context
  ├── <AIGather>                top-level only
  │     ├── <Greeting>
  │     ├── <Voice>
  │     ├── <Parameters>            required JSON Schema
  │     ├── <MessageHistory>
  │     └── <Assistant>
  ├── <Start>                   top-level only (async)
  │     ├── <Stream>
  │     ├── <Transcription>
  │     ├── <Suppression>
  │     ├── <Siprec>
  │     └── <Recording>
  ├── <Stop>                    top-level only
  │     ├── <Stream>
  │     ├── <Transcription>
  │     ├── <Suppression>
  │     └── <Siprec>
  └── <Connect>                 top-level only (sync)
        ├── <Stream>
        ├── <AIAssistant>
        └── <ConversationRelay>

  <Pay>                         top-level only
  ├── <Prompt>
  └── <Parameter>

  <HttpRequest>                 top-level only
  └── <Request>
```

## Verbs

### `<Say>` — Text-to-Speech

Converts text to speech and plays it to the caller. Source: the
[public TeXML `<Say>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/say).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `voice` | string | `man` | Voice selection, including `man`, `woman`, `alice`, and documented provider-prefixed voices such as `Polly.*`, `AWS.Polly.*`, `Azure.*`, `ElevenLabs.*`, and `Telnyx.*` |
| `language` | string | — | ISO language code used by `alice`; `man` and `woman` always use `en-US` |
| `loop` | integer | `1` | Repetitions (0-10). Set to `0` for infinite loop. |
| `gender` | string | — | Azure voice gender: `Male` or `Female` |
| `effect` | string | — | Azure audio effect: `eq_telecomhp8k` or `eq_car` |
| `voiceSpeed` | decimal | `1` | Speech rate from `0.1` through `2.0` |
| `api_key_ref` | string | — | Integration-secret reference used to authenticate supported TTS providers |
| `region` | string | — | Provider cloud region; required for Azure voices using a custom API key |
| `pronunciationDictId` | UUID | — | Pronunciation dictionary applied to the spoken text |
| `languageBoost` | string | — | Language hint for Telnyx Qwen3TTS voices, using a documented language name or ISO code |

> **Voice compatibility:** Preserve a documented provider-prefixed voice during
> migration instead of replacing it with `man` or `woman`, which changes the
> caller-facing voice. The public reference is authoritative for supported
> provider and model formats.

```xml
<Say voice="Polly.Joanna-Neural">Hello, welcome to our service.</Say>
```

### `<Play>` — Audio Playback

Plays an audio file, DTMF tones, or a generated ringback tone. Source: the
[public TeXML `<Play>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/play).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `loop` | integer | `1` | Repetitions. |
| `mediaStorage` | boolean | `false` | Use Telnyx media storage instead of URL. Body becomes `media_name`. |
| `digits` | string | — | DTMF tones to play. Characters: `0-9`, `*`, `#`, `w` (0.5s pause). |
| `failoverUrl` | URL | — | Backup audio source tried once if the primary source fails |
| `continueOnError` | boolean | `false` | Continue to the next verb if both the primary and failover source fail |
| `ringTone` | string | — | Generate a country-specific ringback tone; cannot be combined with an audio body or used inside `<Conference>` |

```xml
<Play>https://example.com/hold-music.mp3</Play>
<Play digits="wwww1928"/>
```

### `<Gather>` — Collect DTMF or Speech Input

Collects touch-tone digits or speech from the caller.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `input` | string | `dtmf` | Input type: `dtmf`, `speech`, or `dtmf speech` |
| `numDigits` | integer | — | Exact number of digits to collect |
| `minDigits` | integer | `1` | Minimum digits (1-128) |
| `maxDigits` | integer | `128` | Maximum digits (1-128) |
| `validDigits` | string | — | Restrict which digits are accepted |
| `finishOnKey` | string | `#` | Key that ends input. Set to empty string to disable. |
| `timeout` | integer | `5` | Seconds to wait between inputs (1-120) |
| `speechTimeout` | integer | — | Seconds to wait after speech ends |
| `action` | URL | — | Callback URL when gathering completes |
| `invalidDigitsAction` | URL | — | Callback for invalid input |
| `partialResultCallback` | URL | — | URL for intermediate speech results |
| `partialResultCallbackMethod` | string | `POST` | HTTP method for partial results |
| `transcriptionEngine` | string | — | STT engine: `Google`, `Telnyx`, `Azure`, `Deepgram`, `xAI`, `AssemblyAI`, `Soniox`, `Speechmatics`, `Parakeet`, `Humain`, `Reson8`, or `Cohere` |
| `model` | string | — | Engine-specific model; the vendor prefix must match `transcriptionEngine` |
| `language` | string | `en-US` | Speech recognition language |
| `useEnhanced` | boolean | — | Use enhanced transcription model |
| `hints` | string | — | Comma-separated speech hints; for Deepgram Nova-2 only |
| `keyterms` | string | — | Comma-separated Deepgram Nova-3 keyterms |
| `smartFormat` | boolean | `true` | Deepgram smart formatting; ignored by other engines |
| `profanityFilter` | boolean | — | Filter profanity from results |
| `apiKeyRef` | string | — | Secret name for Azure auth |
| `region` | string | — | Azure region (required when using Azure engine) |

Can contain `<Say>` and `<Play>` as child elements (played while waiting for input). `<Gather>` has no `method` attribute; the `action` callback uses the HTTP method configured on the TeXML Application.

Twilio `<Gather speechModel="...">` maps to TeXML `<Gather model="...">`. Select the matching `transcriptionEngine` and translate the value to that engine's documented model syntax; do not copy a Twilio-only model name unchanged.

```xml
<Gather input="dtmf speech" numDigits="1" action="/handle-menu" language="en-US">
  <Say>Press 1 or say sales. Press 2 or say support.</Say>
</Gather>
```

### `<Dial>` — Transfer or Bridge Calls

Connects the current call to another phone number, SIP endpoint, queue, or conference.

Source: [Telnyx `<Dial>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial), including the documented `recordingChannels="single"` and `recordMaxLength="0"` defaults.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Callback when dialed call ends |
| `method` | string | `POST` | HTTP method for action |
| `callerId` | string | — | Caller ID (E.164 format) |
| `fromDisplayName` | string | — | Display name (max 128 chars) |
| `hangupOnStar` | boolean | `false` | Allow caller to hang up leg by pressing `*` |
| `timeout` | integer | `30` | Ring duration in seconds (5-120) |
| `timeLimit` | integer | `14400` | Max call duration in seconds (60-14400) |
| `ringTone` | string | `us` | Country-specific ringback tone (supports 37+ countries) |
| `record` | string | `do-not-record` | Options: `do-not-record`, `record-from-answer`, `record-from-ringing`, `record-from-answer-dual`, `record-from-ringing-dual` |
| `recordingChannels` | string | `single` | `single` or `dual` |
| `recordMaxLength` | integer | `0` | Max recording length (0-14400 seconds; 0 is unlimited) |
| `recordingStatusCallback` | URL | — | Recording event webhook |
| `recordingStatusCallbackMethod` | string | `POST` | HTTP method |
| `recordingStatusCallbackEvent` | string | `completed` | Events: `in-progress`, `completed`, `absent` |
| `sendRecordingUrl` | boolean | `true` | Include recording URL in callback |
| `audioUrl` | URL | — | Custom ringback audio; overrides `ringTone` |
| `answerOnBridge` | boolean | `false` | Keep an unanswered inbound leg ringing until the dialed party answers |
| `sequential` | boolean | `false` | Dial multiple Number/Sip children in order instead of simultaneously |
| `passDiversionHeader` | boolean | `false` | Pass the inbound SIP Diversion header to the outbound attempt |
| `machineDetectionSpeechThreshold` | integer | — | Premium AMD greeting-duration threshold in milliseconds |
| `machineDetectionSpeechEndThreshold` | integer | — | Premium AMD post-greeting silence threshold in milliseconds |
| `machineDetectionSilenceTimeout` | integer | — | Premium AMD initial-silence timeout in milliseconds |

Contains `<Number>`, `<Sip>`, `<Queue>`, or `<Conference>` nouns. Multiple `<Number>` or `<Sip>` elements enable simultaneous dialing (first to answer wins).

```xml
<Dial callerId="+15551234567" timeout="30" record="record-from-answer-dual">
  <Number>+15559876543</Number>
</Dial>
```

### `<Record>` — Record Audio

Records audio from the caller.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Callback when recording ends |
| `method` | string | `POST` | HTTP method for action |
| `finishOnKey` | string | all keys | Key that stops recording (`0-9`, `#`, `*`) |
| `timeout` | integer | `0` | Seconds of silence before stopping (0 = infinite) |
| `maxLength` | integer | `3600` | Max recording length in seconds (0-14400) |
| `playBeep` | boolean | `true` | Play beep before recording |
| `trim` | string | — | `trim-silence` to remove leading/trailing silence |
| `channels` | string | `dual` | `single` or `dual`. Twilio `<Record>` is single-channel only, so set `single` when migrating. |
| `recordingStatusCallback` | URL | — | Recording event webhook |
| `recordingStatusCallbackMethod` | string | `POST` | HTTP method for the recording callback (`GET` or `POST`) |
| `recordingStatusCallbackEvent` | string | `completed` | Space-separated events: `in-progress`, `completed` |
| `transcription` | boolean | `false` | Enable post-call transcription |
| `transcriptionCallback` | URL | — | Transcription result webhook |
| `transcriptionEngine` | string | `A` | `A` (Google), `B` (Telnyx), or `Deepgram` |
| `transcriptionModel` | string | — | Engine-specific model, such as `deepgram/nova-3` |
| `transcriptionLanguage` | string | `en-US` | BCP-47 transcription language |
| `format` | string | `mp3` | Recording format: `mp3` or `wav` |

When migrating TwiML `<Record>`, rename `transcribe` to `transcription` and `transcribeCallback` to `transcriptionCallback`. Set `timeout="5"`, `trim="trim-silence"`, and `channels="single"` to preserve Twilio defaults, and set `action` explicitly if the flow relied on Twilio re-requesting the current document. Twilio's `recordingConfigurationId` and the `absent` recording callback event have no TeXML `<Record>` equivalent; do not carry them over.

Recording URLs are valid for 10 minutes after the call ends.

```xml
<Say>Please leave a message after the beep.</Say>
<Record maxLength="120" action="/handle-recording" transcription="true"/>
```

### `<Hangup>` — End Call

Ends the current call. No attributes. Self-closing tag.

```xml
<Say>Thank you for calling. Goodbye.</Say>
<Hangup/>
```

### `<Pause>` — Silent Interval

Waits silently for a specified duration.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `length` | integer | `1` | Seconds to pause (1-180) |

```xml
<Say>Please hold.</Say>
<Pause length="3"/>
<Say>Connecting you now.</Say>
```

### `<Redirect>` — Transfer to Another TeXML Document

Transfers call control to a new TeXML document URL. This is a terminal verb.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `method` | string | `POST` | HTTP method (`GET` or `POST`) |

```xml
<Redirect>https://example.com/next-step</Redirect>
```

### `<Reject>` — Reject Incoming Call

Rejects an incoming call without billing. Must be the first verb. Terminal.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `reason` | string | `rejected` | `rejected` (404) or `busy` (486) |

```xml
<Reject reason="busy"/>
```

### `<Refer>` — SIP Transfer

Performs a SIP REFER to transfer the call to another SIP endpoint.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Callback when transfer completes |
| `method` | string | `POST` | HTTP method for action |

Contains a `<Sip>` noun with the target SIP URI.

```xml
<Refer action="/refer-complete">
  <Sip>sip:agent@pbx.example.com</Sip>
</Refer>
```

### `<Enqueue>` — Place Call in Queue

Places the caller into a named queue.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Callback when call leaves queue |
| `method` | string | `POST` | HTTP method for action |
| `waitUrl` | URL | — | TeXML document for hold experience |
| `waitUrlMethod` | string | `POST` | HTTP method for waitUrl |
| `maxWaitTimeSecs` | integer | `14400` | Maximum time in seconds a call may remain queued (minimum 1) |

The `waitUrl` document can use: `<Play>`, `<Say>`, `<Gather>`, `<Pause>`, `<Hangup>`, `<Redirect>`, `<Leave>`.

```xml
<Enqueue waitUrl="/hold-music" action="/queue-complete">support</Enqueue>
```

### `<Leave>` — Exit Queue

Removes the caller from the current queue. Execution continues with the next verb after the original `<Enqueue>`. No attributes.

```xml
<Leave/>
```

### `<Start>` — Start Asynchronous Service

Starts a background service (streaming, transcription, suppression, SIPREC, or recording). Call processing continues immediately with the next verb.

Contains: `<Stream>`, `<Transcription>`, `<Suppression>`, `<Siprec>`, or `<Recording>`.

```xml
<Start>
  <Transcription transcriptionEngine="Deepgram" transcriptionCallback="/transcripts"/>
</Start>
<Dial>
  <Number>+15559876543</Number>
</Dial>
```

### `<Stop>` — Stop Asynchronous Service

Stops a previously started background service.

Contains: `<Stream>`, `<Transcription>`, `<Suppression>`, or `<Siprec>`. A bare noun stops the current service. Use `name` only when stopping a specifically named Stream or SIPREC session.

```xml
<Stop>
  <Transcription/>
</Stop>
```

### `<Connect>` — Start Synchronous Service

Starts a service and waits for it to complete before continuing. Unlike `<Start>`, execution blocks until the service ends.

Source: the [public TeXML `<Connect>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/connect).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Request the next TeXML instructions when a `<ConversationRelay>` or `<AIAssistant>` service ends |
| `method` | string | `POST` | HTTP method for `action`: `GET` or `POST` |

Contains one of: `<Stream>`, `<AIAssistant>`, or `<ConversationRelay>`. TeXML
does not support TwiML's `<Room>` noun, as shown in the
[public TeXML/TwiML compatibility table](https://developers.telnyx.com/docs/voice/programmable-voice/texml-twiml-compatibility);
redesign that flow with a documented Telnyx Video or conferencing surface
instead of copying it into `<Connect>`.

```xml
<Connect>
  <Stream url="wss://example.com/audio-processor"/>
</Connect>
<Say>Processing complete.</Say>
```

**AI voice migration (Twilio → Telnyx).** Twilio's `<Connect><VirtualAgent>` and
`<Connect><ConversationRelay>` map to Telnyx `<Connect>` AI nouns:

| Twilio | Telnyx TeXML |
|---|---|
| `<Connect><VirtualAgent>` (Dialogflow) | `<Connect><AIAssistant>` or `<Connect><ConversationRelay>` |
| `<Connect><ConversationRelay>` | `<Connect><ConversationRelay>` (supported directly) |

```xml
<!-- Telnyx AI Assistant -->
<Connect>
  <AIAssistant id="assistant-123"/>
</Connect>

<!-- ConversationRelay (bring-your-own AI over WebSocket) -->
<Connect>
  <ConversationRelay url="wss://ai.example.com/relay" welcomeGreeting="Hi there"/>
</Connect>
```

### `<Pay>` — Capture Payments (SUPPORTED)

Captures card or bank payment during the call via a payment connector. **Fully
supported and documented in the
[public TeXML Pay reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/pay).
Contains `<Prompt>` and `<Parameter>` children. The dedicated public verb
reference is the source of truth if an older compatibility table disagrees.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | TeXML instructions requested after Pay completes |
| `method` | string | `POST` | HTTP method for `action` (`GET` or `POST`) |
| `statusCallback` | URL | — | Payment progress and completion callback |
| `statusCallbackMethod` | string | `POST` | HTTP method for `statusCallback` (`GET` or `POST`) |
| `paymentConnector` | string | `Default` | Configured Pay connector name |
| `chargeAmount` | string | — | Amount to charge; required for an explicit `charge` |
| `currency` | string | `USD` | Only `USD` is currently supported |
| `paymentToken` | string | — | Existing token; skips payment-data collection |
| `paymentMethod` | string | `credit-card` | `credit-card` or `ach-debit` |
| `postalCode` | boolean or string | `true` | Collect a billing postal code (`true`), skip it (`false`), or use the supplied value without prompting |
| `minPostalCodeLength` | integer | — | Minimum accepted postal-code length when collection is enabled; must be positive |
| `validCardTypes` | token list | — | Space-separated accepted card types: `visa`, `mastercard`, `amex`, `maestro`, `discover`, `optima`, `jcb`, `diners-club`, or `enroute` |
| `transactionType` | string | inferred | `charge` or `tokenize`; inferred from `chargeAmount` when omitted |
| `description` | string | — | Payment description |
| `maxAttempts` | integer | `1` | Attempts per collection step (1-3) |
| `timeout` | integer | `5` | Timeout for each DTMF step (1-600 seconds) |
| `interDigitTimeout` | integer | `5` | Timeout between DTMF digits (1-600 seconds) |
| `voice` | string | `female` | Voice used for payment prompts |
| `language` | string | `en-US` | Language used for payment prompts |
| `serviceLevel` | string | `premium` | Payment processing service level |
| `parameters` | JSON string | — | Additional connector parameters |
| `prompts` | JSON string | — | Custom prompt definitions; alternatively use nested `<Prompt>` elements |
| `metadata` | JSON string | — | Metadata attached to the transaction |

Nested `<Parameter name="..." value="..."/>` elements add connector parameters. Nested `<Prompt for="..."><Say>...</Say></Prompt>` elements customize collection prompts.

```xml
<Pay chargeAmount="25.00" currency="USD" transactionType="charge"
  paymentConnector="my-connector">
  <Prompt for="payment-card-number"><Say>Enter your card number.</Say></Prompt>
</Pay>
```

### `<HttpRequest>` — Make an HTTP Request (Telnyx-only)

Makes an outbound HTTP request mid-flow. No TwiML equivalent.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `async` | boolean | `false` | Whether TeXML processes the request asynchronously |
| `action` | URL | — | Callback URL used when the request is processed with `async="false"` |

The nested `<Request>` supplies the outbound `url` and HTTP `method`; it may contain `<Headers>` and `<Body>`. An optional nested `<Response>` describes how to extract values from the response.

```xml
<HttpRequest async="true">
  <Request url="https://example.com/events" method="POST">
    <Headers><Header><Key>Content-Type</Key><Value>application/json</Value></Header></Headers>
    <Body>{"call":"active"}</Body>
  </Request>
</HttpRequest>
```

### `<AIGather>` — AI-Driven Gather (Telnyx-only)

Collects structured information from call participants using AI. No TwiML equivalent. A `<Parameters>` child containing a JSON Schema object inside CDATA is required.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `action` | URL | — | Callback when gathering completes; Telnyx executes the TeXML returned by this URL |
| `method` | string | `POST` | HTTP method for the action URL (`GET` or `POST`) |

Supported children include `<Greeting>`, `<Voice>`, the required `<Parameters>`, `<MessageHistory>`, and `<Assistant>` (which may contain `<Tools>`). Model names and assistant instructions belong on the nested `<Assistant>`; `name` and `voice_speed` belong on the nested `<Voice>`. They are not attributes of `<AIGather>` itself.

```xml
<Response>
  <AIGather action="/after-ai-gather" method="POST">
    <Greeting>Please tell me your age and location.</Greeting>
    <Parameters>
      <![CDATA[
      {
        "type": "object",
        "properties": {
          "age": { "type": "integer" },
          "location": { "type": "string" }
        },
        "required": ["age", "location"]
      }
      ]]>
    </Parameters>
    <Voice name="Telnyx.NaturalHD.Astra" voice_speed="1.0"/>
  </AIGather>
</Response>
```

## Nouns

### `<Number>` — Phone Number (inside `<Dial>`)

| Attribute | Type | Default | Description |
|---|---|---|---|
| `statusCallback` | URL | — | Event webhook for this leg |
| `statusCallbackEvent` | string | `completed` | Events: `initiated`, `ringing`, `answered`, `amd`, `dtmf`, `deepfake`, `completed` |
| `statusCallbackMethod` | string | `POST` | HTTP method |
| `url` | URL | — | TeXML document to execute on the dialed party |
| `method` | string | `POST` | HTTP method for url |
| `sendDigits` | string | — | DTMF digits to send after connection |
| `machineDetection` | string | `Disable` | `Enable`, `DetectMessageEnd`, `Disable` |
| `detectionMode` | string | `Regular` | `Regular`, `Premium`, or `PremiumCallScreening` |
| `machineDetectionTimeout` | integer | `3500` | Timeout in ms (500-60000) |
| `machineDetectionPromptEndTimeout` | integer | — | Premium Call Screening prompt-end silence threshold in ms (1000-120000) |
| `machineDetectionBeepProfile` | string | `both` | Beep validation: `both` amplitude and frequency detectors, or `freq_only` |
| `amdStatusCallback` | URL | — | Callback that receives the answering-machine-detection result |
| `deepfakeDetection` | string | — | Set to `Enable` to analyze the remote party for AI-generated speech |
| `deepfakeDetectionCallbackUrl` | URL | — | Dedicated deepfake result callback; alternatively include `deepfake` in `statusCallbackEvent` |
| `sipRegion` | string | `US` | SIP region: `US`, `Europe`, `Canada`, `Australia`, or `Middle East` |

```xml
<Dial>
  <Number machineDetection="Enable" sendDigits="wwww1234">+15559876543</Number>
</Dial>
```

### `<Sip>` — SIP Endpoint (inside `<Dial>` or `<Refer>`)

Inside `<Dial>`, `<Sip>` supports these `<Number>` attributes: `statusCallback`, `statusCallbackEvent`, `statusCallbackMethod`, `url`, `method`, `machineDetection`, `detectionMode`, `machineDetectionTimeout`, `machineDetectionPromptEndTimeout`, `machineDetectionBeepProfile`, `amdStatusCallback`, and `sipRegion`. It does **not** support the Number-only `sendDigits` or deepfake-detection attributes. It also adds:

| Attribute | Type | Default | Description |
|---|---|---|---|
| `username` | string | — | SIP authentication username |
| `password` | string | — | SIP authentication password |

For either `<Number>` or `<Sip>`, convert Twilio's `machineDetectionTimeout` from seconds to TeXML milliseconds. Move Twilio's `machineDetectionSpeechThreshold`, `machineDetectionSpeechEndThreshold`, and `machineDetectionSilenceTimeout` settings to the parent `<Dial>`. Preserve a noun-level `amdStatusCallback` when the source flow uses a dedicated AMD callback; otherwise include `amd` in `statusCallbackEvent` and use `statusCallback`. See the [public `<Dial>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial) for the noun attributes and callback behavior.

```xml
<Dial>
  <Sip username="agent" password="secret">sip:agent@pbx.example.com</Sip>
</Dial>
```

### `<Queue>` — Named Queue (inside `<Dial>`)

Connects the call to a caller waiting in the named queue.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `url` | URL | — | TeXML document executed on dequeue |
| `method` | string | `POST` | HTTP method for url |

```xml
<Dial>
  <Queue url="/dequeue-handler">support</Queue>
</Dial>
```

### `<Conference>` — Conference Room (inside `<Dial>`)

| Attribute | Type | Default | Description |
|---|---|---|---|
| `muted` | boolean | `false` | Join muted |
| `startConferenceOnEnter` | boolean | `true` | Start conference when this participant joins |
| `endConferenceOnExit` | boolean | `false` | End conference when this participant leaves |
| `maxParticipants` | integer | `250` | Maximum participants (2-250) |
| `beep` | string | `true` | Beep on join/leave: `true`, `false`, `onEnter`, `onExit` |
| `participantLabel` | string | — | Unique label for REST API management |
| `record` | string | `do-not-record` | `do-not-record` or `record-from-start` |
| `recordBeep` | boolean | `true` | Beep when recording starts |
| `recordingTimeout` | integer | `0` | Seconds of detected silence before stopping the recording (0 disables the silence timeout; maximum 14400) |
| `trim` | string | `do-not-trim` | `trim-silence` or `do-not-trim` |
| `recordingStatusCallback` | URL | — | Recording event webhook |
| `recordingStatusCallbackEvent` | string | `completed` | Space-separated events: `in-progress`, `completed`, `absent` |
| `recordingStatusCallbackMethod` | string | `POST` | HTTP method for the recording callback (`GET` or `POST`) |
| `sendRecordingUrl` | boolean | `true` | Include recording URL in callback |
| `statusCallback` | URL | — | Conference event webhook |
| `statusCallbackMethod` | string | `POST` | HTTP method for the conference callback (`GET` or `POST`) |
| `statusCallbackEvent` | string | — | Events: `start`, `end`, `join`, `leave`, `speaker` |
| `waitUrl` | URL | — | Hold music/instructions URL |
| `waitMethod` | string | `POST` | HTTP method for waitUrl |

```xml
<Dial>
  <Conference startConferenceOnEnter="true" record="record-from-start"
    statusCallback="/conf-events" statusCallbackEvent="join leave"
    waitUrl="/hold-music">team-standup</Conference>
</Dial>
```

### `<Recording>` — Non-Blocking Call Recording (inside `<Start>`)

Starts recording and immediately continues to the next TeXML instruction. The recording stops when the call ends or through the TeXML REST API's Stop Recording command.

Twilio `<Start><Recording>` maps to the same TeXML structure. Preserve `recordingStatusCallback`, `recordingStatusCallbackMethod`, `recordingStatusCallbackEvent`, `track`, and `channels`. Set `trim` explicitly because Twilio defaults to `trim-silence` while TeXML does not. Twilio's `name` and `recordingConfigurationId` attributes have no TeXML equivalent; do not carry them over. TeXML does not support `<Stop><Recording>` by name—use the TeXML REST API's Stop Recording command.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `recordingStatusCallback` | URL | — | Recording status webhook |
| `recordingStatusCallbackMethod` | string | `POST` | HTTP method for the status callback (`GET` or `POST`) |
| `recordingStatusCallbackEvent` | string | `completed` | Space-separated events: `in-progress`, `completed`, `absent` |
| `channels` | string | `dual` | `mono`, `single`, or `dual` |
| `track` | string | `both` | `inbound`, `outbound`, or `both` |
| `trim` | string | — | `trim-silence` removes leading and trailing silence |
| `format` | string | `mp3` | `mp3` or `wav` |

```xml
<Start>
  <Recording channels="dual" track="both" format="mp3"
    recordingStatusCallback="/recording-events"/>
</Start>
<Say>Recording has started.</Say>
```

### `<Stream>` — WebSocket Media Streaming (inside `<Start>`, `<Stop>`, `<Connect>`)

| Attribute | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | WebSocket endpoint (`wss://`); required under `<Start>`/`<Connect>`, omitted under `<Stop>` |
| `track` | string | `inbound_track` | `inbound_track`, `outbound_track`, `both_tracks` |
| `name` | string | — | Identifier for stopping a specific stream |
| `codec` | string | `default` | `PCMU`, `PCMA`, `G722`, `OPUS`, `AMR-WB`, `default` |
| `bidirectionalMode` | string | `mp3` | `mp3` or `rtp` (for bidirectional streams) |
| `bidirectionalCodec` | string | `PCMU` | Codec for return audio |
| `bidirectionalSamplingRate` | string | `8000` | `8000`, `16000`, `24000` |
| `statusCallback` | URL | — | Events: `stream-started`, `stream-stopped`, `stream-failed` |
| `statusCallbackMethod` | string | `POST` | HTTP method for the status callback (`GET` or `POST`) |
| `enableReconnect` | boolean | `true` | Automatically reconnect the WebSocket if it disconnects |

`<Stream>` may contain `<Parameter name="..." value="..."/>` children. Telnyx includes these custom key-value pairs in the WebSocket `start` message.

```xml
<Start>
  <Stream url="wss://example.com/audio" track="both_tracks" name="my-stream">
    <Parameter name="customer_id" value="12345"/>
  </Stream>
</Start>
```

### `<Transcription>` — Real-Time Speech-to-Text (inside `<Start>`, `<Stop>`)

Twilio now supports the same `<Start><Transcription>` and `<Stop><Transcription>` structure. Attribute names and values are not fully compatible, so translate them instead of copying the TwiML unchanged:

| TwiML | TeXML | Migration note |
|---|---|---|
| `statusCallbackUrl` | `transcriptionCallback` | TeXML also supports `transcriptionCallbackMethod` |
| `languageCode` | `language` | Preserve the BCP-47 language value |
| `track` (`inbound_track`, `outbound_track`, `both_tracks`) | `transcriptionTracks` (`inbound`, `outbound`, `both`) | Twilio defaults to both tracks; TeXML defaults to inbound, so set this explicitly |
| `partialResults` | `interimResults` | TeXML interim results apply to the Google engine only |
| `speechModel` | `model` | Convert to the selected TeXML engine's supported model syntax |
| `transcriptionEngine` | `transcriptionEngine` | Normalize the provider value and verify that engine/model/language combination |

The same `speechModel` → `model` attribute mapping applies to `<Gather>`, with value translation for the selected engine. Separately, `speechModel` is a valid attribute on a `<Language>` child of TeXML `<ConversationRelay>` and must be preserved there.

Twilio-only session metadata and persistence attributes such as `name`, track labels, `enableProviderData`, `profanityFilter`, `enableAutomaticPunctuation`, `intelligenceService`, `conversationConfiguration`, and `conversationId` have no direct TeXML attributes. Do not carry them over silently. To stop the current TeXML transcription, use a bare `<Stop><Transcription/></Stop>`.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `language` | string | `en` | Transcription language |
| `interimResults` | boolean | `false` | Send partial results (Google engine only) |
| `transcriptionEngine` | string | `Google` | `Google`, `Telnyx`, `Deepgram`, `Azure`, `xAI`, `AssemblyAI`, `Soniox`, `Speechmatics`, `Parakeet`, `Humain`, `Reson8`, `Cohere`, or legacy `A`/`B` |
| `transcriptionTracks` | string | `inbound` | `inbound`, `outbound`, `both` |
| `transcriptionCallback` | URL | — | Webhook for transcription results; omitted under `<Stop>` |
| `transcriptionCallbackMethod` | string | `POST` | HTTP method |
| `model` | string | — | Engine-specific model (e.g., `deepgram/nova-3`, `openai/whisper-large-v3-turbo`) |
| `hints` | string | — | Comma-separated speech hints; for Deepgram Nova-2 only |
| `keyterms` | string | — | Comma-separated Deepgram Nova-3 keyterms |
| `smartFormat` | boolean | `true` | Deepgram smart formatting; ignored by other engines |
| `apiKeyRef` | string | — | Secret name for Azure authentication |
| `region` | string | — | Azure region (required for Azure engine) |

```xml
<Start>
  <Transcription transcriptionEngine="Deepgram" model="deepgram/nova-3"
    transcriptionCallback="/transcripts" transcriptionTracks="both"/>
</Start>
```

### `<Suppression>` — Audio Suppression (inside `<Start>`, `<Stop>`)

**Telnyx-only.** Suppresses audio on a call leg.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `direction` | string | `inbound` | `inbound`, `outbound`, `both` |
| `noiseSuppressionEngine` | string | `Denoiser` | `Denoiser`, `DeepFilterNet`, `Krisp`, or `AiCoustics` |
| `model` | string | — | Krisp model name |
| `suppressionLevel` | number | — | Krisp suppression intensity (0-100) |
| `family` | string | `sparrow` | AiCoustics model family: `sparrow` or `quail` |
| `size` | string | `s` | AiCoustics model size: `s`, `l`, or `vf` (`vf` requires `quail`) |
| `enhancementLevel` | number | `0.8` | AiCoustics enhancement intensity (0-1) |

```xml
<Start>
  <Suppression direction="inbound"/>
</Start>
```

### `<Siprec>` — SIPREC Session (inside `<Start>`, `<Stop>`)

Twilio `<Start><Siprec>` and `<Stop><Siprec>` map to the same TeXML structure. Set `track="inbound_track"` explicitly to preserve Twilio's default; TeXML defaults to `both_tracks`. Telnyx additionally supports metadata-header routing, transport security, and session timeout controls.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `connectorName` | string | — | SIPREC connector configured in Mission Control; required under `<Start>`, omitted under `<Stop>` |
| `statusCallback` | URL | — | Session event webhook |
| `statusCallbackMethod` | string | `POST` | HTTP method |
| `track` | string | `both_tracks` | `inbound_track`, `outbound_track`, `both_tracks` |
| `name` | string | — | Session identifier for stopping |
| `includeMetadataCustomHeaders` | boolean | `false` | Put custom parameters in SIPREC metadata instead of SIP headers |
| `secure` | boolean | `false` | Use SRTP/TLS |
| `sessionTimeoutSecs` | integer | `1800` | Session timeout (90-14440 seconds); `0` disables it |

```xml
<Start>
  <Siprec connectorName="my-recorder" track="both_tracks" name="session-1"/>
</Start>
```

### `<AIAssistant>` — Telnyx AI Assistant (inside `<Connect>`)

Starts or joins a configured Telnyx AI Assistant conversation. Source: the
[public TeXML `<AIAssistant>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/aiassistant).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | — | AI Assistant identifier |
| `join` | string | — | Existing AI Assistant conversation ID to join instead of starting a new conversation |
| `participantName` | string | — | Participant name used when joining |
| `participantRole` | string | `user` | Participant role: `user` or `assistant` |

```xml
<Connect action="/after-assistant">
  <AIAssistant id="00000000-0000-0000-0000-000000000000"/>
</Connect>
```

### `<ConversationRelay>` — Bring-Your-Own AI (inside `<Connect>`)

Routes the call to a ConversationRelay WebSocket service. Source: the
[public TeXML `<ConversationRelay>` reference](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/conversationrelay).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `url` | WebSocket URL | — | ConversationRelay WebSocket endpoint |
| `welcomeGreeting` | string | — | Greeting spoken when the relay starts |
| `voice` | string | — | Text-to-speech voice |
| `language` | string | — | Default language code |
| `transcriptionProvider` | string | — | Default transcription provider |
| `interruptible` | string | `any` | Interruption mode: `none`, `any`, `speech`, `dtmf`, `true`, or `false` |
| `welcomeGreetingInterruptible` | string | `any` | Interruption mode while the welcome greeting plays |
| `dtmfDetection` | boolean | `false` | Forward detected DTMF events |
| `backgroundAudioType` | string | — | Background-audio type; currently `media_url` |
| `backgroundAudioValue` | string | — | Value paired with `backgroundAudioType` |

Nested `<Language>` elements can override `code`, `ttsProvider`, `voice`,
`transcriptionProvider`, `speechModel`, `backgroundAudioType`, and
`backgroundAudioValue`. Nested `<Parameter name="..." value="..."/>` elements
pass custom values to the relay. Background-audio type and value must be
provided together.

```xml
<Connect action="/after-relay">
  <ConversationRelay url="wss://ai.example.com/relay" welcomeGreeting="Hello"/>
</Connect>
```

## Common Patterns

### IVR Menu with Speech and DTMF

```xml
<Response>
  <Gather input="dtmf speech" numDigits="1" action="/handle-menu"
    timeout="5" language="en-US" hints="sales,support,billing">
    <Say voice="Polly.Joanna-Neural">
      Welcome to Acme Corp. Press 1 or say sales.
      Press 2 or say support. Press 3 or say billing.
    </Say>
  </Gather>
  <Say>Sorry, we didn't get your input.</Say>
  <Redirect>/retry-menu</Redirect>
</Response>
```

### Call Recording with Transcription

```xml
<Response>
  <Say>This call may be recorded for quality purposes.</Say>
  <Dial record="record-from-answer-dual" recordingStatusCallback="/recording-events">
    <Number>+15559876543</Number>
  </Dial>
</Response>
```

### Conference with Hold Music

```xml
<Response>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="false"
      waitUrl="/hold-music" record="record-from-start"
      maxParticipants="50">team-meeting</Conference>
  </Dial>
</Response>
```

### Real-Time Transcription + Bridged Call

```xml
<Response>
  <Start>
    <Transcription transcriptionEngine="Deepgram" model="deepgram/nova-3"
      transcriptionCallback="/live-transcript" transcriptionTracks="both"/>
  </Start>
  <Dial>
    <Number>+15559876543</Number>
  </Dial>
</Response>
```

### WebSocket Media Streaming (Bidirectional)

```xml
<Response>
  <Connect>
    <Stream url="wss://ai.example.com/voice-bot" track="both_tracks"
      bidirectionalMode="rtp" bidirectionalCodec="PCMU"/>
  </Connect>
  <Say>The AI assistant has ended the conversation. Goodbye.</Say>
  <Hangup/>
</Response>
```

### Simultaneous Dial (Ring Multiple Numbers)

```xml
<Response>
  <Dial timeout="20" callerId="+15551234567">
    <Number>+15559876543</Number>
    <Number>+15558765432</Number>
    <Number>+15557654321</Number>
  </Dial>
  <Say>No one was available. Please try again later.</Say>
  <Hangup/>
</Response>
```

## Telnyx-Specific Features and Options

These TeXML capabilities or provider options have no direct TwiML equivalent:

| Feature | How to Use |
|---|---|
| Audio suppression | `<Suppression>` noun inside `<Start>` / `<Stop>` |
| AI-driven structured gather | `<AIGather>` with a required JSON Schema `<Parameters>` child |
| Mid-flow HTTP requests | `<HttpRequest>` with nested `<Request>` |
| Additional explicit STT providers | `<Gather>` and `<Transcription>` document Google, Telnyx, Deepgram, Azure, xAI, AssemblyAI, Soniox, Speechmatics, Parakeet, Humain, Reson8, and Cohere; `<Transcription>` also accepts legacy `A`/`B` |
| ElevenLabs voices in `<Say>` | `voice="ElevenLabs.{ModelId}.{VoiceId}"` |
| Telnyx media storage | `mediaStorage="true"` on `<Play>` |

## TwiML Verbs Not Supported

These TwiML verbs/nouns have **no TeXML equivalent**. The Telnyx runtime silently
drops any verb it does not recognize (it is filtered into `invalid_instructions`
with **no error**), so emitting one produces a subtly broken call flow. Do NOT
emit these — replace each with the alternative below and flag it for the user.

| TwiML Verb/Noun | TeXML Status | Alternative |
|---|---|---|
| `<Sms>` (in-call) | Not supported | Send via the Telnyx Messaging API from your webhook handler. |
| `<Message>` (in Voice) | Not supported | Same — use the Messaging API, not a voice verb. |
| `<Echo>` | Not supported | No equivalent; remove. |
| `<Dial><Client>` | Not supported | Dial the WebRTC client's SIP URI instead: `<Dial><Sip>sip:USERNAME@sip.telnyx.com</Sip></Dial>`, where USERNAME is the telephony credential's SIP username. Twilio's client identity is replaced by a SIP credential — see `webrtc-migration.md`. |
| `<Connect><Autopilot>` | Not supported | Use `<Connect><AIAssistant>` or `<Connect><ConversationRelay>`. |
| `<Connect><VirtualAgent>` | Not supported | Use `<Connect><AIAssistant>` (Telnyx AI Assistant) or `<Connect><ConversationRelay>`. |

## TwiML → TeXML Conversion Deltas (read before converting)

The TeXML runtime is **permissive and silent**: it never rejects an unknown or
miscased attribute — it ignores it and uses the default. XML attribute names are
**case-sensitive** and matched exactly. So a wrong name/case does not error; the
feature just silently does nothing. Get these exactly right.

### Attribute renames (TwiML → TeXML)

| TwiML | TeXML | Verb |
|---|---|---|
| `transcribe="true"` | `transcription="true"` | `<Record>` |
| `transcribeCallback` | `transcriptionCallback` | `<Record>` |

### Case-sensitive attributes (exact casing required)

| Correct (runtime reads this) | Common wrong forms that are silently ignored |
|---|---|
| `ringTone` (on `<Dial>`) | `ringtone`, `RingTone` |
| `timeout` (on `<Gather>`) | `Timeout`, `dialTimeout` |
| `invalidDigitsAction` (on `<Gather>`) | `invalidDigitAction`, `invalidDigitActions`, and other misspellings |
| `numDigits`, `maxDigits`, `minDigits` | lowercased variants |

### Default and capability drift

| Setting | Twilio behavior | TeXML behavior | Migration action |
|---|---|---|---|
| `<Record timeout>` | `5` seconds | `0` (no silence timeout) | Set `timeout="5"` to preserve Twilio behavior. |
| `<Record trim>` | `trim-silence` | no trimming by default | Set `trim="trim-silence"`. |
| `<Record>` channels | single channel only | `channels="dual"` by default | Set `channels="single"`. |
| `<Recording trim>` | `trim-silence` | no trimming by default | Set `trim="trim-silence"`. |
| `<Transcription>` track | both tracks | inbound track | Set `transcriptionTracks="both"`. |
| `<Siprec track>` | inbound track | both tracks | Set `track="inbound_track"`. |

TeXML's `recordingChannels` on `<Dial>` defaults to `single`; Twilio instead selects dual-channel output through the `-dual` variants of the `record` value, so preserve the original `record` value and set `recordingChannels` only when the target behavior requires it. Telnyx also supports `<Dial answerOnBridge>` (default `false`); preserve it when the existing TwiML relies on keeping the caller in a ringing state until the dialed party answers.

### Vendor-specific attributes

Do not carry `Studio`/`Flex`-specific metadata into TeXML unless the Telnyx verb reference explicitly documents an equivalent.
