#!/usr/bin/env bash
#
# validate-texml.sh — Check TwiML/TeXML XML for Telnyx compatibility
#
# Usage: bash validate-texml.sh <file.xml>
#
# Reports:
#   [ERROR]   Unsupported elements, invalid nesting, and dead attributes
#   [WARN]    Attributes with different defaults or behavior
#   [INFO]    Telnyx features and migration notes
#   [OK]      Verb is fully supported
#
# Exit codes:
#   0 — All checks passed (may have warnings/info)
#   1 — TeXML compatibility errors found
#   2 — Usage/dependency error (missing file, not XML, or no Python 3)

set -euo pipefail

# --- Colors (disabled if not a terminal) ---
if [ -t 1 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' YELLOW='' GREEN='' BLUE='' BOLD='' NC=''
fi

# --- Usage ---
if [ $# -lt 1 ]; then
  echo "Usage: bash validate-texml.sh <file.xml>"
  echo ""
  echo "Analyzes a TwiML/TeXML XML file for Telnyx TeXML compatibility."
  exit 2
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo -e "${RED}[ERROR]${NC} File not found: $FILE"
  exit 2
fi

# Element names, nesting, attributes, CDATA, and well-formedness are structured
# XML concerns. The historical lexical fallbacks produced both false passes and
# false blocks, so do not claim compatibility when the parser is unavailable.
if ! command -v python3 >/dev/null 2>&1; then
  echo -e "${RED}[ERROR]${NC} TeXML validation requires Python 3 for fail-closed XML parsing."
  exit 2
fi

echo -e "${BOLD}TeXML Compatibility Report${NC}"
echo -e "File: $FILE"
echo "─────────────────────────────────────"

ERRORS=0
WARNINGS=0
INFO=0
OK=0

# --- Supported top-level verbs. Dedicated public verb documentation is
# authoritative when an older compatibility matrix conflicts with it. ---
SUPPORTED_VERBS="Say Play Gather Dial Record Hangup Pause Redirect Reject Refer Enqueue Leave Start Stop Connect Pay HttpRequest AIGather"

# --- Supported nouns/children. Their exact parents are checked below. ---
SUPPORTED_NOUNS="Number Sip Queue Conference Stream Transcription Suppression Siprec Recording AIAssistant ConversationRelay Language Parameter Request Headers Header Key Value Body Type StatusCode Content Field Name Greeting Voice Parameters MessageHistory Message InterruptionSettings Assistant Tools Tool Prompt"

# --- Parse once, then validate root, namespaces, vocabulary, full parent/child
# grammar, bounded attribute domains, and cross-field dependencies from the same
# tree. Unknown dynamic template values are warnings, never guessed as valid or
# rejected as invalid static values. ---
if ! ANALYSIS_OUTPUT=$(python3 - "$FILE" <<'PYEOF'
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit


def emit(*fields: object) -> None:
    print("\t".join(
        str(field).replace("\t", " ").replace("\n", " ")
        for field in fields
    ))


def namespaced(name: object) -> bool:
    return isinstance(name, str) and (name.startswith("{") or "}" in name)


def local_name(name: object) -> str:
    return name if isinstance(name, str) and not namespaced(name) else ""


def is_dynamic(value: str, *, single_brace: bool = True) -> bool:
    patterns = [
        r"\{\{[\s\S]*?\}\}",       # Mustache / Handlebars
        r"\$\{[^{}]+\}",             # shell / JavaScript template
        r"<%=?[\s\S]*?%>",           # ERB
        r"#\{[^{}]+\}",               # Ruby interpolation
        r"^\{\$[A-Za-z_][^{}]*\}$",  # PHP interpolation placeholder
    ]
    if single_brace:
        patterns.append(r"^\{[^{}]+\}$")  # single-brace / PHP placeholder
    return any(re.search(pattern, value) for pattern in patterns)


def is_secure_websocket_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        # Access the port too so malformed static ports fail validation rather
        # than raising outside this predicate.
        _ = parsed.port
    except ValueError:
        return False
    return parsed.scheme.lower() == "wss" and bool(hostname)


def text_value(element: ET.Element) -> str:
    return "".join(element.itertext()).strip()


top_level = {
    "Say", "Play", "Gather", "Dial", "Record", "Hangup", "Pause",
    "Redirect", "Reject", "Refer", "Enqueue", "Leave", "Start", "Stop",
    "Connect", "Pay", "HttpRequest", "AIGather",
}
children = {
    "Gather": {"Say", "Play"},
    "Dial": {"Number", "Sip", "Queue", "Conference"},
    "Refer": {"Sip"},
    "Start": {"Stream", "Transcription", "Suppression", "Siprec", "Recording"},
    "Stop": {"Stream", "Transcription", "Suppression", "Siprec"},
    "Connect": {"Stream", "ConversationRelay", "AIAssistant"},
    "Stream": {"Parameter"},
    "ConversationRelay": {"Language", "Parameter"},
    "Pay": {"Parameter", "Prompt"},
    "Prompt": {"Say"},
    "HttpRequest": {"Request", "Response"},
    "Request": {"Headers", "Body"},
    "Headers": {"Header"},
    "Header": {"Key", "Value"},
    "Content": {"Field"},
    "Field": {"Name", "Value"},
    "AIGather": {
        "Greeting", "Voice", "Parameters", "MessageHistory",
        "InterruptionSettings", "Transcription", "Assistant", "Tools",
    },
    "MessageHistory": {"Message"},
    "Assistant": {"Tools"},
    "Tools": {"Tool"},
}
nouns = {
    "Number", "Sip", "Queue", "Conference", "Stream", "Transcription",
    "Suppression", "Siprec", "Recording", "AIAssistant",
    "ConversationRelay", "Language", "Parameter", "Request", "Headers",
    "Header", "Key", "Value", "Body", "Type", "StatusCode", "Content",
    "Field", "Name", "Greeting", "Voice", "Parameters", "MessageHistory",
    "Message", "InterruptionSettings", "Assistant", "Tools", "Tool", "Prompt",
}
known = {"Response"} | top_level | nouns
unsupported = {"Sms", "Client", "Room", "Echo", "VirtualAgent", "Autopilot"}

methods = frozenset({"GET", "POST"})
ring_tones = frozenset({
    "at", "au", "bg", "br", "be", "ch", "cl", "cn", "cz", "de", "dk",
    "ee", "es", "fi", "fr", "gr", "hu", "il", "in", "it", "lt", "jp",
    "mx", "my", "nl", "no", "nz", "ph", "pl", "pt", "ru", "se", "sg",
    "th", "tw", "ve", "za", "us", "us-old", "uk",
})
stt_engines = frozenset({
    "Google", "Telnyx", "Azure", "Deepgram", "xAI", "AssemblyAI", "Soniox",
    "Speechmatics", "Parakeet", "Humain", "Reson8", "Cohere",
})
status_events = frozenset({"initiated", "ringing", "answered", "amd", "dtmf", "deepfake", "completed"})
pay_valid_card_types = frozenset({
    "visa", "mastercard", "amex", "maestro", "discover", "optima", "jcb",
    "diners-club", "enroute",
})

ENUMS = {
    ("Dial", "method"): methods,
    ("Dial", "record"): frozenset({"do-not-record", "record-from-answer", "record-from-ringing", "record-from-answer-dual", "record-from-ringing-dual"}),
    ("Dial", "recordingChannels"): frozenset({"single", "dual"}),
    ("Dial", "recordingStatusCallbackMethod"): methods,
    ("Dial", "ringTone"): ring_tones,
    ("Dial.Number", "statusCallbackMethod"): methods,
    ("Dial.Number", "method"): methods,
    ("Dial.Number", "machineDetection"): frozenset({"Enable", "DetectMessageEnd", "Disable"}),
    ("Dial.Number", "detectionMode"): frozenset({"Regular", "Premium", "PremiumCallScreening"}),
    ("Dial.Number", "machineDetectionBeepProfile"): frozenset({"both", "freq_only"}),
    ("Dial.Number", "sipRegion"): frozenset({"US", "Europe", "Canada", "Australia", "Middle East"}),
    ("Dial.Sip", "statusCallbackMethod"): methods,
    ("Dial.Sip", "method"): methods,
    ("Dial.Sip", "machineDetection"): frozenset({"Enable", "DetectMessageEnd", "Disable"}),
    ("Dial.Sip", "detectionMode"): frozenset({"Regular", "Premium", "PremiumCallScreening"}),
    ("Dial.Sip", "machineDetectionBeepProfile"): frozenset({"both", "freq_only"}),
    ("Dial.Sip", "sipRegion"): frozenset({"US", "Europe", "Canada", "Australia", "Middle East"}),
    ("Dial.Queue", "method"): methods,
    ("Say", "gender"): frozenset({"Male", "Female"}),
    ("Say", "effect"): frozenset({"eq_telecomhp8k", "eq_car"}),
    ("Say", "languageBoost"): frozenset({"Auto", "English", "German", "Chinese", "French", "Italian", "Japanese", "Korean", "Portuguese", "Russian", "Spanish", "en", "de", "zh", "fr", "it", "ja", "ko", "pt", "ru", "es"}),
    ("Play", "mediaStorage"): frozenset({"true", "false"}),
    ("Play", "continueOnError"): frozenset({"true", "false"}),
    ("Play", "ringTone"): ring_tones,
    ("Gather", "input"): frozenset({"dtmf", "speech", "dtmf speech"}),
    ("Gather", "partialResultCallbackMethod"): methods,
    ("Gather", "transcriptionEngine"): stt_engines,
    ("AIGather", "method"): methods,
    ("Request", "method"): methods,
    ("AIAssistant", "participantRole"): frozenset({"user", "assistant"}),
    ("Record", "method"): methods,
    ("Record", "trim"): frozenset({"trim-silence"}),
    ("Record", "channels"): frozenset({"single", "dual"}),
    ("Record", "recordingStatusCallbackMethod"): methods,
    ("Record", "transcription"): frozenset({"true", "false"}),
    ("Record", "transcriptionEngine"): frozenset({"A", "B", "Deepgram", "deepgram"}),
    ("Record", "format"): frozenset({"mp3", "wav"}),
    ("Conference", "beep"): frozenset({"true", "false", "onEnter", "onExit"}),
    ("Conference", "record"): frozenset({"do-not-record", "record-from-start"}),
    ("Conference", "recordingStatusCallbackMethod"): methods,
    ("Conference", "statusCallbackMethod"): methods,
    ("Conference", "waitMethod"): methods,
    ("Conference", "trim"): frozenset({"trim-silence", "do-not-trim"}),
    ("Enqueue", "method"): methods,
    ("Enqueue", "waitUrlMethod"): methods,
    ("Redirect", "method"): methods,
    ("Reject", "reason"): frozenset({"rejected", "busy"}),
    ("Stream", "track"): frozenset({"inbound_track", "outbound_track", "both_tracks"}),
    ("Stream", "codec"): frozenset({"PCMU", "PCMA", "G722", "OPUS", "AMR-WB", "default"}),
    ("Stream", "bidirectionalMode"): frozenset({"mp3", "rtp"}),
    ("Stream", "bidirectionalCodec"): frozenset({"PCMU", "PCMA", "G722", "OPUS", "AMR-WB"}),
    ("Stream", "bidirectionalSamplingRate"): frozenset({"8000", "16000", "24000"}),
    ("Stream", "statusCallbackMethod"): methods,
    ("ConversationRelay", "interruptible"): frozenset({"none", "any", "speech", "dtmf", "true", "false"}),
    ("ConversationRelay", "welcomeGreetingInterruptible"): frozenset({"none", "any", "speech", "dtmf", "true", "false"}),
    ("ConversationRelay", "backgroundAudioType"): frozenset({"media_url"}),
    ("ConversationRelay.Language", "backgroundAudioType"): frozenset({"media_url"}),
    ("Connect", "method"): methods,
    ("Refer", "method"): methods,
    ("Siprec", "statusCallbackMethod"): methods,
    ("Siprec", "track"): frozenset({"inbound_track", "outbound_track", "both_tracks"}),
    ("Suppression", "direction"): frozenset({"inbound", "outbound", "both"}),
    ("Suppression", "noiseSuppressionEngine"): frozenset({"Denoiser", "DeepFilterNet", "Krisp", "AiCoustics"}),
    ("Suppression", "family"): frozenset({"sparrow", "quail"}),
    ("Suppression", "size"): frozenset({"s", "l", "vf"}),
    ("Transcription", "transcriptionEngine"): stt_engines | frozenset({"A", "B"}),
    ("Transcription", "transcriptionTracks"): frozenset({"inbound", "outbound", "both"}),
    ("Transcription", "transcriptionCallbackMethod"): methods,
    ("Pay", "method"): methods,
    ("Pay", "statusCallbackMethod"): methods,
    ("Pay", "currency"): frozenset({"USD"}),
    ("Pay", "paymentMethod"): frozenset({"credit-card", "ach-debit"}),
    ("Pay", "transactionType"): frozenset({"charge", "tokenize"}),
    ("Pay", "serviceLevel"): frozenset({"premium"}),
    ("Pay.Prompt", "for"): frozenset({"payment-card-number", "expiration-date", "postal-code", "security-code", "bank-routing-number", "bank-account-number"}),
    ("Recording", "recordingStatusCallbackMethod"): methods,
    ("Recording", "channels"): frozenset({"mono", "single", "dual"}),
    ("Recording", "track"): frozenset({"inbound", "outbound", "both"}),
    ("Recording", "trim"): frozenset({"trim-silence"}),
    ("Recording", "format"): frozenset({"mp3", "wav"}),
    ("AIGather.Message", "role"): frozenset({"user", "assistant"}),
}

TOKEN_ENUMS = {
    ("Dial", "recordingStatusCallbackEvent"): frozenset({"in-progress", "completed", "absent"}),
    ("Dial.Number", "statusCallbackEvent"): status_events,
    ("Dial.Sip", "statusCallbackEvent"): status_events,
    ("Record", "recordingStatusCallbackEvent"): frozenset({"in-progress", "completed"}),
    ("Conference", "recordingStatusCallbackEvent"): frozenset({"in-progress", "completed", "absent"}),
    ("Conference", "statusCallbackEvent"): frozenset({"start", "end", "join", "leave", "speaker"}),
    ("Recording", "recordingStatusCallbackEvent"): frozenset({"in-progress", "completed", "absent"}),
    ("Pay", "validCardTypes"): pay_valid_card_types,
}

BOOL_ATTRS = {
    ("Dial", name) for name in ("hangupOnStar", "sendRecordingUrl", "answerOnBridge", "sequential", "passDiversionHeader")
} | {
    ("Gather", name) for name in ("profanityFilter", "useEnhanced", "smartFormat")
} | {
    ("Conference", name) for name in ("muted", "startConferenceOnEnter", "endConferenceOnExit", "recordBeep", "sendRecordingUrl")
} | {
    ("Record", "playBeep"), ("HttpRequest", "async"),
    ("Stream", "enableReconnect"),
    ("ConversationRelay", "dtmfDetection"),
    ("Siprec", "includeMetadataCustomHeaders"), ("Siprec", "secure"),
    ("Transcription", "interimResults"), ("Transcription", "smartFormat"),
    ("AIGather.InterruptionSettings", "enable"),
}

# (minimum, maximum, explicitly allowed values outside that range)
INT_RANGES = {
    ("Dial", "timeout"): (5, 120, frozenset()),
    ("Dial", "timeLimit"): (60, 14400, frozenset()),
    ("Dial", "recordMaxLength"): (0, 14400, frozenset()),
    ("Dial.Number", "machineDetectionTimeout"): (500, 60000, frozenset()),
    ("Dial.Number", "machineDetectionPromptEndTimeout"): (1000, 120000, frozenset()),
    ("Dial.Sip", "machineDetectionTimeout"): (500, 60000, frozenset()),
    ("Dial.Sip", "machineDetectionPromptEndTimeout"): (1000, 120000, frozenset()),
    ("Say", "loop"): (0, 10, frozenset()),
    ("Play", "loop"): (0, None, frozenset()),
    ("Gather", "timeout"): (1, 120, frozenset()),
    ("Gather", "numDigits"): (1, 128, frozenset()),
    ("Gather", "minDigits"): (1, 128, frozenset()),
    ("Gather", "maxDigits"): (1, 128, frozenset()),
    ("Gather", "speechTimeout"): (0, None, frozenset()),
    ("Dial", "machineDetectionSpeechThreshold"): (0, None, frozenset()),
    ("Dial", "machineDetectionSpeechEndThreshold"): (0, None, frozenset()),
    ("Dial", "machineDetectionSilenceTimeout"): (0, None, frozenset()),
    ("Record", "timeout"): (0, None, frozenset()),
    ("Record", "maxLength"): (0, 14400, frozenset()),
    ("Conference", "maxParticipants"): (2, 250, frozenset()),
    ("Conference", "recordingTimeout"): (0, 14400, frozenset()),
    ("Enqueue", "maxWaitTimeSecs"): (1, None, frozenset()),
    ("Pause", "length"): (1, 180, frozenset()),
    ("Siprec", "sessionTimeoutSecs"): (90, 14440, frozenset({0})),
    ("Pay", "maxAttempts"): (1, 3, frozenset()),
    ("Pay", "timeout"): (1, 600, frozenset()),
    ("Pay", "interDigitTimeout"): (1, 600, frozenset()),
    ("Pay", "minPostalCodeLength"): (1, None, frozenset()),
}

DECIMAL_RANGES = {
    ("Say", "voiceSpeed"): (Decimal("0.1"), Decimal("2.0")),
    ("AIGather.Voice", "voice_speed"): (Decimal("0.1"), Decimal("2.0")),
    ("Suppression", "suppressionLevel"): (Decimal("0"), Decimal("100")),
    ("Suppression", "enhancementLevel"): (Decimal("0"), Decimal("1")),
}

# Static DTMF attributes have closed character alphabets. Accept an empty
# Gather finishOnKey because the public contract uses it to disable the
# terminator; the other attributes must contain at least one valid symbol.
DTMF_ATTRS = {
    ("Play", "digits"): (re.compile(r"[0-9*#w]+"), False),
    ("Gather", "finishOnKey"): (re.compile(r"[0-9*#]?"), True),
    ("Gather", "validDigits"): (re.compile(r"[0-9*#]+"), False),
    ("Record", "finishOnKey"): (re.compile(r"[0-9*#]+"), False),
    ("Dial.Number", "sendDigits"): (re.compile(r"[0-9*#w]+"), False),
}

# The TeXML runtime silently ignores unknown/miscased attributes. Keep these
# context-specific allowlists closed so a typo cannot be reported as migration
# compatible merely because its value is outside one of the finite schemas
# above. Attribute names cannot be templated in well-formed XML; template
# handling therefore applies to values, not names.
ALLOWED_ATTRS = {
    "Response": frozenset(),
    "Say": frozenset({"voice", "language", "loop", "gender", "effect", "voiceSpeed", "api_key_ref", "region", "pronunciationDictId", "languageBoost"}),
    "Play": frozenset({"loop", "mediaStorage", "digits", "failoverUrl", "continueOnError", "ringTone"}),
    "Gather": frozenset({"action", "timeout", "input", "speechTimeout", "partialResultCallback", "partialResultCallbackMethod", "profanityFilter", "useEnhanced", "hints", "keyterms", "smartFormat", "transcriptionEngine", "model", "apiKeyRef", "region", "finishOnKey", "numDigits", "language", "validDigits", "invalidDigitsAction", "minDigits", "maxDigits"}),
    "Dial": frozenset({"action", "method", "callerId", "fromDisplayName", "hangupOnStar", "timeout", "timeLimit", "record", "recordingChannels", "recordMaxLength", "recordingStatusCallback", "recordingStatusCallbackMethod", "recordingStatusCallbackEvent", "sendRecordingUrl", "ringTone", "audioUrl", "answerOnBridge", "sequential", "passDiversionHeader", "machineDetectionSpeechThreshold", "machineDetectionSpeechEndThreshold", "machineDetectionSilenceTimeout"}),
    "Dial.Number": frozenset({"statusCallback", "statusCallbackEvent", "statusCallbackMethod", "url", "method", "sendDigits", "machineDetection", "detectionMode", "machineDetectionTimeout", "machineDetectionPromptEndTimeout", "machineDetectionBeepProfile", "amdStatusCallback", "deepfakeDetection", "deepfakeDetectionCallbackUrl", "sipRegion"}),
    "Dial.Sip": frozenset({"username", "password", "statusCallback", "statusCallbackEvent", "statusCallbackMethod", "url", "method", "machineDetection", "detectionMode", "machineDetectionTimeout", "machineDetectionPromptEndTimeout", "machineDetectionBeepProfile", "amdStatusCallback", "sipRegion"}),
    "Dial.Queue": frozenset({"url", "method"}),
    "Refer.Sip": frozenset(),
    "Conference": frozenset({"muted", "startConferenceOnEnter", "endConferenceOnExit", "maxParticipants", "beep", "participantLabel", "record", "recordBeep", "recordingStatusCallback", "recordingStatusCallbackEvent", "recordingStatusCallbackMethod", "recordingTimeout", "trim", "sendRecordingUrl", "statusCallback", "statusCallbackMethod", "statusCallbackEvent", "waitUrl", "waitMethod"}),
    "Record": frozenset({"action", "method", "finishOnKey", "timeout", "maxLength", "playBeep", "trim", "channels", "recordingStatusCallback", "recordingStatusCallbackMethod", "transcription", "transcriptionCallback", "transcriptionEngine", "transcriptionModel", "transcriptionLanguage", "format", "recordingStatusCallbackEvent"}),
    "Hangup": frozenset(),
    "Pause": frozenset({"length"}),
    "Redirect": frozenset({"method"}),
    "Reject": frozenset({"reason"}),
    "Refer": frozenset({"action", "method"}),
    "Enqueue": frozenset({"action", "method", "waitUrl", "waitUrlMethod", "maxWaitTimeSecs"}),
    "Leave": frozenset(),
    "Start": frozenset(),
    "Stop": frozenset(),
    "Connect": frozenset({"action", "method"}),
    "Stream": frozenset({"url", "track", "name", "codec", "bidirectionalMode", "bidirectionalCodec", "bidirectionalSamplingRate", "statusCallback", "statusCallbackMethod", "enableReconnect"}),
    "Transcription": frozenset({"language", "interimResults", "transcriptionEngine", "transcriptionTracks", "transcriptionCallback", "transcriptionCallbackMethod", "model", "hints", "keyterms", "smartFormat", "apiKeyRef", "region"}),
    "Suppression": frozenset({"direction", "noiseSuppressionEngine", "model", "suppressionLevel", "family", "size", "enhancementLevel"}),
    "Siprec": frozenset({"connectorName", "statusCallback", "statusCallbackMethod", "track", "name", "includeMetadataCustomHeaders", "secure", "sessionTimeoutSecs"}),
    "Recording": frozenset({"recordingStatusCallback", "recordingStatusCallbackMethod", "recordingStatusCallbackEvent", "channels", "track", "trim", "format"}),
    "Stop.Stream": frozenset({"name"}),
    "Stop.Transcription": frozenset(),
    "Stop.Suppression": frozenset(),
    "Stop.Siprec": frozenset({"name"}),
    "AIAssistant": frozenset({"id", "join", "participantName", "participantRole"}),
    "ConversationRelay": frozenset({"url", "welcomeGreeting", "voice", "language", "transcriptionProvider", "interruptible", "welcomeGreetingInterruptible", "dtmfDetection", "backgroundAudioType", "backgroundAudioValue"}),
    "ConversationRelay.Language": frozenset({"code", "ttsProvider", "voice", "transcriptionProvider", "speechModel", "backgroundAudioType", "backgroundAudioValue"}),
    "Stream.Parameter": frozenset({"name", "value"}),
    "ConversationRelay.Parameter": frozenset({"name", "value"}),
    "Pay": frozenset({"action", "method", "statusCallback", "statusCallbackMethod", "paymentConnector", "chargeAmount", "currency", "paymentToken", "paymentMethod", "postalCode", "minPostalCodeLength", "validCardTypes", "transactionType", "description", "maxAttempts", "timeout", "interDigitTimeout", "voice", "language", "serviceLevel", "parameters", "prompts", "metadata"}),
    "Pay.Parameter": frozenset({"name", "value"}),
    "Pay.Prompt": frozenset({"for", "attempt", "errorType", "cardType"}),
    "HttpRequest": frozenset({"async", "action"}),
    "Request": frozenset({"url", "method"}),
    "Headers": frozenset(),
    "Header": frozenset(),
    "Key": frozenset(),
    "Value": frozenset(),
    "Body": frozenset(),
    "Type": frozenset(),
    "StatusCode": frozenset(),
    "Content": frozenset(),
    "Field": frozenset(),
    "Name": frozenset(),
    "AIGather": frozenset({"action", "method"}),
    "Greeting": frozenset(),
    "AIGather.Voice": frozenset({"name", "api_key_ref", "voice_speed"}),
    "Parameters": frozenset(),
    "MessageHistory": frozenset(),
    "AIGather.Message": frozenset({"role"}),
    "AIGather.InterruptionSettings": frozenset({"enable"}),
    "AIGather.Transcription": frozenset({"model"}),
    "Assistant": frozenset({"model", "api_key_ref", "instructions"}),
    "Tools": frozenset(),
    "Tool": frozenset(),
}

PAY_CARD_TYPES = frozenset({
    "visa", "mastercard", "amex", "discover", "diners-club", "jcb",
    "unionpay", "maestro", "optima", "enroute",
})

BAD_ATTRS = {
    "ringtone": "ringTone", "RingTone": "ringTone", "Timeout": "timeout",
    "invalidDigitAction": "invalidDigitsAction", "dialTimeout": "timeout",
    "transcribe": "transcription", "transcribeCallback": "transcriptionCallback",
    "numdigits": "numDigits", "maxdigits": "maxDigits", "mindigits": "minDigits",
    "finishonkey": "finishOnKey", "validdigits": "validDigits",
    "maxlength": "maxLength", "playbeep": "playBeep", "callerid": "callerId",
    "senddigits": "sendDigits", "timelimit": "timeLimit",
    "speechtimeout": "speechTimeout", "machinedetection": "machineDetection",
}
ELEMENT_BAD_ATTRS = {
    "Transcription": {
        "statusCallbackUrl": "transcriptionCallback", "languageCode": "language",
        "partialResults": "interimResults", "speechModel": "model",
    },
    "Gather": {"speechModel": "model"},
}


def context_key(tag: str, parent_tag: str) -> str:
    if parent_tag == "Dial" and tag in {"Number", "Sip", "Queue"}:
        return f"Dial.{tag}"
    if parent_tag == "Refer" and tag == "Sip":
        return "Refer.Sip"
    if parent_tag == "Stop" and tag in {"Stream", "Transcription", "Suppression", "Siprec"}:
        return f"Stop.{tag}"
    if parent_tag == "AIGather" and tag in {"Voice", "Transcription", "InterruptionSettings"}:
        return f"AIGather.{tag}"
    if parent_tag == "MessageHistory" and tag == "Message":
        return "AIGather.Message"
    if parent_tag == "ConversationRelay" and tag == "Language":
        return "ConversationRelay.Language"
    if parent_tag == "Pay" and tag == "Prompt":
        return "Pay.Prompt"
    if tag == "Parameter":
        return f"{parent_tag}.Parameter"
    return tag


reported = set()


def report_once(*fields: str) -> None:
    if fields not in reported:
        reported.add(fields)
        emit(*fields)


def unresolved(tag: str, attr: str, detail: str) -> None:
    report_once("UNRESOLVED", tag, attr, detail)


def validate_pay_json_attribute(element: ET.Element, attr: str) -> None:
    raw = element.attrib[attr]
    # A flat JSON object is itself wrapped in single braces, so the generic
    # single-brace template heuristic would misclassify valid JSON as dynamic.
    # Keep the unambiguous template syntaxes plus a lone `{identifier}` form.
    if is_dynamic(raw, single_brace=False) or re.fullmatch(
        r"\{[A-Za-z_][A-Za-z0-9_.-]*\}", raw.strip()
    ):
        unresolved("Pay", attr, "dynamic JSON cannot be statically validated")
        return
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        report_once("SCHEMA_ERROR", "Pay", attr, "expected a valid JSON object")
        return
    if not isinstance(value, dict):
        report_once("SCHEMA_ERROR", "Pay", attr, "expected a JSON object")
        return
    if attr != "prompts":
        return

    prompt_steps = ENUMS[("Pay.Prompt", "for")]
    for step, specification in value.items():
        if step not in prompt_steps:
            report_once(
                "SCHEMA_ERROR", "Pay", attr,
                f"unsupported prompt step {step!r}; expected one of: {', '.join(sorted(prompt_steps))}",
            )
            continue
        if isinstance(specification, str):
            continue
        if not isinstance(specification, list) or not specification:
            report_once(
                "SCHEMA_ERROR", "Pay", attr,
                f"prompt step {step!r} must be a string or a non-empty list of prompt objects",
            )
            continue
        for index, prompt in enumerate(specification):
            if not isinstance(prompt, dict):
                report_once(
                    "SCHEMA_ERROR", "Pay", attr,
                    f"prompt step {step!r} entry {index} must be an object",
                )
                continue
            text = prompt.get("text")
            if not isinstance(text, str) or not text.strip():
                report_once(
                    "SCHEMA_ERROR", "Pay", attr,
                    f"prompt step {step!r} entry {index} requires non-empty string text",
                )
            card_type = prompt.get("cardType")
            if card_type is not None and card_type not in PAY_CARD_TYPES:
                report_once(
                    "SCHEMA_ERROR", "Pay", attr,
                    f"prompt step {step!r} entry {index} cardType must be one of: {', '.join(sorted(PAY_CARD_TYPES))}",
                )


try:
    tree = ET.parse(sys.argv[1])
except (ET.ParseError, OSError) as exc:
    emit("PARSE_ERROR", str(exc))
    emit("ANALYSIS_COMPLETE")
    raise SystemExit(0)

root = tree.getroot()
parents = {child: parent for parent in tree.iter() for child in parent}

# Reject namespaces before local-name processing. Silently stripping a namespace
# could turn a foreign element into a supported TeXML verb.
for element in tree.iter():
    if namespaced(element.tag):
        report_once("NAMESPACE", str(element.tag), "elements may not use XML namespaces")
    for raw_name in element.attrib:
        if namespaced(raw_name):
            report_once("NAMESPACE_ATTR", local_name(element.tag) or "(namespaced)", str(raw_name))

root_name = local_name(root.tag)
if root_name != "Response":
    emit("ROOT_ERROR", root_name or str(root.tag) or "(non-element)")

used = set()
attributes = set()
non_neural_polly = set()
position_valid = {}

for element in tree.iter():
    tag = local_name(element.tag)
    parent = parents.get(element)
    parent_tag = local_name(parent.tag) if parent is not None else ""
    grandparent = parents.get(parent) if parent is not None else None
    grandparent_tag = local_name(grandparent.tag) if grandparent is not None else ""
    position_valid[element] = False

    if not tag:
        continue
    if tag in unsupported:
        report_once("UNSUPPORTED", tag)
        continue
    if tag not in known:
        report_once("UNKNOWN", tag)
        continue

    valid_position = element is root and tag == "Response"
    if element is not root:
        if tag == "Response":
            valid_position = parent_tag == "HttpRequest"
            if not valid_position:
                report_once("NESTED_RESPONSE", parent_tag or "(none)")
        else:
            if parent is root and root_name == "Response":
                allowed = top_level
            elif parent_tag == "Response" and parents.get(parent) is not None and local_name(parents[parent].tag) == "HttpRequest":
                # The public HttpRequest contract documents both response
                # headers/body and type/status/content extraction families.
                allowed = {"Headers", "Body", "Type", "StatusCode", "Content"}
            elif parent_tag == "Stream" and grandparent_tag == "Stop":
                # A stopping Stream is a selector, not a new stream
                # configuration. Parameter children belong only to streams
                # started under Start or Connect.
                allowed = set()
            else:
                allowed = children.get(parent_tag, set())
            valid_position = tag in allowed
            if not valid_position:
                if tag in {"Message", "MessageHistory"}:
                    report_once("MESSAGE_CONTEXT", tag)
                else:
                    expected = sorted(
                        name for name, allowed_children in children.items()
                        if tag in allowed_children
                    )
                    if tag in top_level:
                        expected.insert(0, "Response")
                    report_once(
                        "NESTING", tag, parent_tag or "(none)",
                        ", ".join(dict.fromkeys(expected)) or "no documented parent",
                    )

    valid_position = valid_position and (element is root or position_valid.get(parent, False))
    position_valid[element] = valid_position
    if valid_position:
        used.add(tag)

    context = context_key(tag, parent_tag)
    bad_for_element = ELEMENT_BAD_ATTRS.get(tag, {})
    for raw_name, value in element.attrib.items():
        name = local_name(raw_name)
        if not name:
            continue
        attributes.add((tag, name))
        if name == "voice" and value.startswith("Polly.") and "-Neural" not in value:
            non_neural_polly.add(value)
        if name == "speechModel" and tag == "Language" and parent_tag == "ConversationRelay":
            continue
        replacement = bad_for_element.get(name, BAD_ATTRS.get(name))
        if name == "speechModel" and replacement is None:
            replacement = "REMOVE"
        if replacement is not None:
            report_once("BAD_ATTR", tag, name, replacement)
        elif name not in ALLOWED_ATTRS.get(context, frozenset()):
            report_once("UNKNOWN_ATTR", tag, name, context)

    # Closed single-value domains.
    for (schema_context, attr), allowed in ENUMS.items():
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic template value cannot be statically validated")
        elif value not in allowed:
            report_once("SCHEMA_ERROR", tag, attr, f"expected one of: {', '.join(sorted(allowed))}")

    # Whitespace-delimited token lists.
    for (schema_context, attr), allowed in TOKEN_ENUMS.items():
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic template token list cannot be statically validated")
        else:
            tokens = value.split()
            if not tokens or any(token not in allowed for token in tokens):
                report_once("SCHEMA_ERROR", tag, attr, f"expected whitespace-delimited tokens from: {', '.join(sorted(allowed))}")

    for schema_context, attr in BOOL_ATTRS:
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic boolean cannot be statically validated")
        elif value not in {"true", "false"}:
            report_once("SCHEMA_ERROR", tag, attr, "expected true or false")

    for (schema_context, attr), (minimum, maximum, extras) in INT_RANGES.items():
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic integer cannot be statically range-checked")
            continue
        if not re.fullmatch(r"[+-]?\d+", value):
            report_once("SCHEMA_ERROR", tag, attr, "expected an integer")
            continue
        number = int(value)
        in_range = number >= minimum and (maximum is None or number <= maximum)
        if number not in extras and not in_range:
            upper = "unbounded" if maximum is None else str(maximum)
            extra = f" or {', '.join(map(str, sorted(extras)))}" if extras else ""
            report_once("SCHEMA_ERROR", tag, attr, f"expected {minimum}..{upper}{extra}")

    for (schema_context, attr), (minimum, maximum) in DECIMAL_RANGES.items():
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic number cannot be statically range-checked")
            continue
        try:
            number = Decimal(value)
        except InvalidOperation:
            number = Decimal("NaN")
        if not number.is_finite() or number < minimum or number > maximum:
            report_once("SCHEMA_ERROR", tag, attr, f"expected a finite number in {minimum}..{maximum}")

    for (schema_context, attr), (pattern, allows_empty) in DTMF_ATTRS.items():
        if schema_context != context or attr not in element.attrib:
            continue
        value = element.attrib[attr]
        if is_dynamic(value):
            unresolved(tag, attr, "dynamic DTMF value cannot be statically validated")
        elif not pattern.fullmatch(value):
            empty_note = "; empty is allowed" if allows_empty else ""
            report_once(
                "SCHEMA_ERROR", tag, attr,
                f"contains unsupported DTMF characters{empty_note}",
            )

# Required children and cross-field dependencies.
for element in tree.iter():
    tag = local_name(element.tag)
    if not tag:
        continue
    direct_children = [child for child in element if local_name(child.tag)]

    if tag == "AIGather":
        parameters = [child for child in direct_children if local_name(child.tag) == "Parameters"]
        if len(parameters) != 1:
            report_once("STRUCTURE_ERROR", tag, "requires exactly one direct <Parameters> child")
        elif parameters:
            raw_schema = text_value(parameters[0])
            if is_dynamic(raw_schema, single_brace=False):
                unresolved("Parameters", "content", "dynamic JSON Schema cannot be statically validated")
            else:
                try:
                    schema = json.loads(raw_schema)
                except (json.JSONDecodeError, TypeError):
                    schema = None
                    report_once("STRUCTURE_ERROR", "Parameters", "content must be valid JSON")
                if schema is not None:
                    if not isinstance(schema, dict):
                        report_once("STRUCTURE_ERROR", "Parameters", "JSON Schema must be an object")
                    else:
                        schema_type = schema.get("type")
                        properties = schema.get("properties")
                        if schema_type != "object" and not isinstance(properties, dict):
                            report_once("STRUCTURE_ERROR", "Parameters", "JSON must describe an object schema (type=object or properties)")
                        if schema_type is not None and schema_type != "object":
                            report_once("STRUCTURE_ERROR", "Parameters", "schema type must be object")
                        if properties is not None and not isinstance(properties, dict):
                            report_once("STRUCTURE_ERROR", "Parameters", "schema properties must be an object")
                        required = schema.get("required")
                        if required is not None and (not isinstance(required, list) or any(not isinstance(item, str) for item in required)):
                            report_once("STRUCTURE_ERROR", "Parameters", "schema required must be an array of strings")
                        elif required and isinstance(properties, dict) and any(item not in properties for item in required):
                            report_once("STRUCTURE_ERROR", "Parameters", "schema required entries must exist in properties")

    elif tag == "HttpRequest":
        requests = [child for child in direct_children if local_name(child.tag) == "Request"]
        responses = [child for child in direct_children if local_name(child.tag) == "Response"]
        if len(requests) != 1:
            report_once("STRUCTURE_ERROR", tag, "requires exactly one direct <Request> child")
        else:
            request_url = requests[0].attrib.get("url", "").strip()
            if not request_url:
                report_once("STRUCTURE_ERROR", "Request", "requires a non-empty url attribute")
            elif is_dynamic(request_url):
                unresolved("Request", "url", "dynamic request URL cannot be statically validated")
        if len(responses) > 1:
            report_once("STRUCTURE_ERROR", tag, "allows at most one direct <Response> child")

    elif tag == "Pay":
        for json_attr in ("parameters", "prompts", "metadata"):
            if json_attr in element.attrib:
                validate_pay_json_attribute(element, json_attr)
        transaction_type = element.attrib.get("transactionType")
        if transaction_type == "charge":
            charge = element.attrib.get("chargeAmount", "").strip()
            if not charge:
                report_once("STRUCTURE_ERROR", tag, "transactionType=charge requires chargeAmount")
            elif is_dynamic(charge):
                unresolved(tag, "chargeAmount", "dynamic charge amount cannot be statically validated")

    elif tag == "Prompt" and parents.get(element) is not None and local_name(parents[element].tag) == "Pay":
        prompt_for = element.attrib.get("for", "").strip()
        if not prompt_for:
            report_once("STRUCTURE_ERROR", "Prompt", "requires a non-empty for attribute")
        if not any(local_name(child.tag) == "Say" for child in direct_children):
            report_once("STRUCTURE_ERROR", "Prompt", "requires at least one direct <Say> child")
        attempt = element.attrib.get("attempt")
        max_attempts = parents[element].attrib.get("maxAttempts", "1")
        if attempt:
            if is_dynamic(attempt):
                unresolved("Prompt", "attempt", "dynamic attempt list cannot be statically validated")
            else:
                attempts = attempt.split()
                if not attempts or any(not re.fullmatch(r"[1-9]\d*", item) for item in attempts):
                    report_once("SCHEMA_ERROR", "Prompt", "attempt", "expected a whitespace-delimited list of positive integers")
                elif is_dynamic(max_attempts):
                    unresolved("Prompt", "attempt", "dynamic Pay maxAttempts prevents upper-bound validation")
                elif re.fullmatch(r"[+-]?\d+", max_attempts) and any(int(item) > int(max_attempts) for item in attempts):
                    report_once("SCHEMA_ERROR", "Prompt", "attempt", "attempt numbers cannot exceed Pay maxAttempts")
        card_type = element.attrib.get("cardType")
        if card_type is not None:
            if is_dynamic(card_type):
                unresolved("Prompt", "cardType", "dynamic card type cannot be statically validated")
            elif card_type not in PAY_CARD_TYPES:
                report_once(
                    "SCHEMA_ERROR", "Prompt", "cardType",
                    f"expected one of: {', '.join(sorted(PAY_CARD_TYPES))}",
                )

    parent = parents.get(element)
    parent_tag = local_name(parent.tag) if parent is not None else ""
    if tag == "Stream" and parent_tag in {"Start", "Connect"}:
        stream_url = element.attrib.get("url", "").strip()
        if not stream_url:
            report_once("STRUCTURE_ERROR", tag, f"under {parent_tag} requires a non-empty url attribute")
        elif is_dynamic(stream_url):
            unresolved(tag, "url", "dynamic required stream URL cannot be statically validated")
        elif not is_secure_websocket_url(stream_url):
            report_once("SCHEMA_ERROR", tag, "url", "expected a secure WebSocket URL beginning with wss://")

    if tag == "ConversationRelay" and parent_tag == "Connect":
        relay_url = element.attrib.get("url", "").strip()
        if not relay_url:
            report_once("STRUCTURE_ERROR", tag, "under Connect requires a non-empty url attribute")
        elif is_dynamic(relay_url):
            unresolved(tag, "url", "dynamic required WebSocket URL cannot be statically validated")
        elif not is_secure_websocket_url(relay_url):
            report_once("SCHEMA_ERROR", tag, "url", "expected a secure WebSocket URL beginning with wss://")

    if tag == "Siprec" and parent_tag == "Start":
        connector_name = element.attrib.get("connectorName", "").strip()
        if not connector_name:
            report_once("STRUCTURE_ERROR", tag, "under Start requires a non-empty connectorName attribute")
        elif is_dynamic(connector_name):
            unresolved(tag, "connectorName", "dynamic required connector name cannot be statically validated")

    if tag == "Reject" and parent is root and list(root).index(element) != 0:
        report_once("STRUCTURE_ERROR", tag, "must be the first verb under Response")

    if tag in {"Reject", "Redirect"} and parent is root and list(root).index(element) != len(list(root)) - 1:
        report_once("STRUCTURE_ERROR", tag, "is terminal and must be the last verb under Response")

    if tag == "Connect":
        services = [
            child for child in direct_children
            if local_name(child.tag) in {"Stream", "AIAssistant", "ConversationRelay"}
        ]
        if len(services) != 1:
            report_once(
                "STRUCTURE_ERROR", tag,
                "requires exactly one direct Stream, AIAssistant, or ConversationRelay child",
            )

    if tag == "Parameter" and parent_tag in {"Pay", "Stream", "ConversationRelay"}:
        for required_attr in ("name", "value"):
            value = element.attrib.get(required_attr, "").strip()
            if not value:
                report_once("STRUCTURE_ERROR", "Parameter", f"under {parent_tag} requires non-empty {required_attr}")
            elif is_dynamic(value):
                unresolved("Parameter", required_attr, "dynamic required value cannot be statically validated")

    if tag in {"ConversationRelay", "Language"} and (tag != "Language" or parent_tag == "ConversationRelay"):
        has_type = "backgroundAudioType" in element.attrib
        has_value = "backgroundAudioValue" in element.attrib
        if has_type != has_value:
            report_once("STRUCTURE_ERROR", tag, "backgroundAudioType and backgroundAudioValue must be provided together")

    if tag == "Message" and parent_tag == "MessageHistory":
        role = element.attrib.get("role", "").strip()
        if not role:
            report_once("STRUCTURE_ERROR", tag, "requires a role attribute")

    if tag == "Say":
        voice = element.attrib.get("voice", "")
        if is_dynamic(voice):
            unresolved(tag, "voice", "dynamic voice dependencies cannot be statically validated")
        elif voice.startswith("ElevenLabs."):
            api_key_ref = element.attrib.get("api_key_ref", "").strip()
            if not api_key_ref:
                report_once("STRUCTURE_ERROR", tag, "ElevenLabs voice requires api_key_ref")
            elif is_dynamic(api_key_ref):
                unresolved(tag, "api_key_ref", "dynamic secret reference cannot be statically validated")
        elif voice.startswith("Azure.") and element.attrib.get("api_key_ref"):
            api_key_ref = element.attrib["api_key_ref"]
            region = element.attrib.get("region", "").strip()
            if is_dynamic(api_key_ref):
                unresolved(tag, "api_key_ref", "dynamic custom-key usage cannot prove the region dependency")
            elif not region:
                report_once("STRUCTURE_ERROR", tag, "Azure custom API key requires region")
            elif is_dynamic(region):
                unresolved(tag, "region", "dynamic Azure region cannot be statically validated")

    if tag == "Gather":
        engine = element.attrib.get("transcriptionEngine")
        if engine == "Azure":
            region = element.attrib.get("region", "").strip()
            if not region:
                report_once("STRUCTURE_ERROR", tag, "Azure transcriptionEngine requires region")
            elif is_dynamic(region):
                unresolved(tag, "region", "dynamic Azure region cannot be statically validated")

    if tag == "Transcription" and parent_tag in {"Start", "Stop"}:
        engine = element.attrib.get("transcriptionEngine")
        if engine == "Azure":
            region = element.attrib.get("region", "").strip()
            if not region:
                report_once("STRUCTURE_ERROR", tag, "Azure transcriptionEngine requires region")
            elif is_dynamic(region):
                unresolved(tag, "region", "dynamic Azure region cannot be statically validated")

    if tag == "Record" and element.attrib.get("transcription") == "true":
        callback = element.attrib.get("transcriptionCallback", "").strip()
        if not callback:
            report_once("STRUCTURE_ERROR", tag, "transcription=true requires transcriptionCallback")
        elif is_dynamic(callback):
            unresolved(tag, "transcriptionCallback", "dynamic callback cannot be statically validated")

    if tag == "Play" and "ringTone" in element.attrib:
        ring_tone = element.attrib["ringTone"]
        body = text_value(element)
        if is_dynamic(ring_tone):
            if parent_tag == "Gather" or body:
                unresolved(tag, "ringTone", "dynamic ring tone cannot prove placement/content dependencies")
        else:
            if parent_tag == "Gather":
                report_once("STRUCTURE_ERROR", tag, "ringTone is not valid inside Gather")
            if body:
                if is_dynamic(body):
                    unresolved(tag, "content", "dynamic audio body may conflict with ringTone")
                else:
                    report_once("STRUCTURE_ERROR", tag, "ringTone cannot be combined with an audio body")

    if tag == "Dial" and "record" in element.attrib and not is_dynamic(element.attrib["record"]):
        if any(local_name(child.tag) == "Conference" for child in direct_children):
            report_once("STRUCTURE_ERROR", tag, "record is valid only for Number/Sip calls, not Conference")

    if tag == "Stream" and any(attr in element.attrib for attr in ("bidirectionalCodec", "bidirectionalSamplingRate")):
        mode = element.attrib.get("bidirectionalMode")
        dependent_values = [
            element.attrib[attr]
            for attr in ("bidirectionalCodec", "bidirectionalSamplingRate")
            if attr in element.attrib
        ]
        if mode is not None and is_dynamic(mode):
            unresolved(tag, "bidirectionalMode", "dynamic mode cannot prove codec/sampling dependency")
        elif mode != "rtp":
            if all(is_dynamic(value) for value in dependent_values):
                unresolved(tag, "bidirectionalMode", "dynamic codec/sampling values cannot prove the RTP dependency")
            else:
                report_once("STRUCTURE_ERROR", tag, "bidirectionalCodec and bidirectionalSamplingRate require bidirectionalMode=rtp")

    if tag == "Suppression":
        engine = element.attrib.get("noiseSuppressionEngine")
        krisp_attrs = {"model", "suppressionLevel"} & set(element.attrib)
        ai_attrs = {"family", "size", "enhancementLevel"} & set(element.attrib)
        if engine is not None and is_dynamic(engine) and (krisp_attrs or ai_attrs):
            unresolved(tag, "noiseSuppressionEngine", "dynamic engine cannot prove engine-specific attributes")
        else:
            static_krisp = {attr for attr in krisp_attrs if not is_dynamic(element.attrib[attr])}
            static_ai = {attr for attr in ai_attrs if not is_dynamic(element.attrib[attr])}
            if krisp_attrs and engine != "Krisp":
                if static_krisp:
                    report_once("STRUCTURE_ERROR", tag, "model and suppressionLevel require noiseSuppressionEngine=Krisp")
                else:
                    unresolved(tag, "noiseSuppressionEngine", "dynamic Krisp-only values cannot prove the engine dependency")
            if ai_attrs and engine != "AiCoustics":
                if static_ai:
                    report_once("STRUCTURE_ERROR", tag, "family, size, and enhancementLevel require noiseSuppressionEngine=AiCoustics")
                else:
                    unresolved(tag, "noiseSuppressionEngine", "dynamic AiCoustics-only values cannot prove the engine dependency")
        size = element.attrib.get("size")
        if size is not None and is_dynamic(size):
            unresolved(tag, "size", "dynamic model size cannot prove the family dependency")
        elif size == "vf":
            family = element.attrib.get("family")
            if family is not None and is_dynamic(family):
                unresolved(tag, "family", "dynamic family cannot prove size=vf dependency")
            elif family != "quail":
                report_once("STRUCTURE_ERROR", tag, "size=vf requires family=quail")

    if tag == "AIAssistant":
        selectors = [attr for attr in ("id", "join") if element.attrib.get(attr, "").strip()]
        if len(selectors) != 1:
            report_once("STRUCTURE_ERROR", tag, "requires exactly one non-empty id or join selector")
        elif is_dynamic(element.attrib[selectors[0]]):
            unresolved(tag, selectors[0], "dynamic assistant selector cannot be statically validated")
        join = element.attrib.get("join")
        if join is not None:
            if is_dynamic(join):
                unresolved(tag, "join", "dynamic conversation ID cannot be statically validated")
            elif not join.strip() or join in {"true", "false"}:
                report_once("SCHEMA_ERROR", tag, "join", "expected an existing AI Assistant conversation ID, not a boolean")
        if any(attr in element.attrib for attr in ("participantName", "participantRole")) and join is None:
            participant_values = [
                element.attrib[attr]
                for attr in ("participantName", "participantRole")
                if attr in element.attrib
            ]
            if all(is_dynamic(value) for value in participant_values):
                unresolved(tag, "join", "dynamic participant values cannot prove the join dependency")
            else:
                report_once("STRUCTURE_ERROR", tag, "participantName and participantRole require a join conversation ID")

# ElementTree intentionally normalizes CDATA to text. Prove the common lexical
# form when possible; otherwise warn instead of making a false runtime claim.
parameter_count = sum(1 for element in tree.iter() if local_name(element.tag) == "Parameters")
if parameter_count:
    try:
        raw_xml = Path(sys.argv[1]).read_bytes()
        raw_xml = re.sub(rb"<!--[\s\S]*?-->", b"", raw_xml)
        cdata_count = len(re.findall(rb"<Parameters(?:\s[^>]*)?>\s*<!\[CDATA\[", raw_xml))
    except OSError:
        cdata_count = 0
    if cdata_count < parameter_count:
        report_once("UNRESOLVED", "Parameters", "CDATA", "could not prove required CDATA lexical form")

for tag in sorted(used):
    emit("USED", tag)
for tag, name in sorted(attributes):
    emit("ATTR", tag, name)
for value in sorted(non_neural_polly):
    emit("POLLY", value)

visible = "\n".join(
    chunk
    for element in tree.iter()
    for chunk in (element.text or "", element.tail or "", *element.attrib.values())
)
visible_lower = visible.lower()
if any(marker in visible_lower for marker in ("x-twilio-signature", "requestvalidator", "validaterequest")):
    emit("CONTENT", "TWILIO_SIGNATURE")
if "api.twilio.com" in visible_lower:
    emit("CONTENT", "TWILIO_API")
if "accountsid" in visible_lower or re.search(r"AC[a-f0-9]{32}", visible):
    emit("CONTENT", "ACCOUNT_SID")

emit("ANALYSIS_COMPLETE")
PYEOF
); then
  echo -e "${RED}[ERROR]${NC} TeXML structural analysis failed unexpectedly; compatibility was not evaluated."
  exit 2
fi

if ! printf '%s\n' "$ANALYSIS_OUTPUT" | grep -qx 'ANALYSIS_COMPLETE'; then
  echo -e "${RED}[ERROR]${NC} TeXML structural analysis did not complete; refusing to pass an unvalidated document."
  exit 2
fi

while IFS=$'\t' read -r record field1 field2 field3; do
  [ -z "$record" ] && continue
  case "$record" in
    PARSE_ERROR)
      echo -e "${RED}[ERROR]${NC} Document is not well-formed XML — the runtime cannot parse it. ${field1}"
      ERRORS=$((ERRORS + 1))
      ;;
    ROOT_ERROR)
      echo -e "${RED}[ERROR]${NC} TeXML document root must be <Response>; found <${field1}>."
      ERRORS=$((ERRORS + 1))
      ;;
    NESTED_RESPONSE)
      echo -e "${RED}[ERROR]${NC} Nested <Response> under <${field1}> is invalid. Only the document root and the documented <HttpRequest><Response> mapping may use this element."
      ERRORS=$((ERRORS + 1))
      ;;
    MESSAGE_CONTEXT)
      if [ "$field1" = "Message" ]; then
        echo -e "${RED}[ERROR]${NC} <Message> — Valid only inside <MessageHistory> directly under <AIGather>; top-level TwiML <Message> has no TeXML equivalent."
      else
        echo -e "${RED}[ERROR]${NC} <MessageHistory> — Valid only as a direct child of <AIGather>."
      fi
      ERRORS=$((ERRORS + 1))
      ;;
    UNSUPPORTED)
      case "$field1" in
        Client)
          echo -e "${RED}[ERROR]${NC} <Client> — Twilio client identities do not exist in TeXML. Dial the WebRTC client's SIP URI instead: <Dial><Sip>sip:USERNAME@sip.telnyx.com</Sip></Dial>." ;;
        *)
          echo -e "${RED}[ERROR]${NC} <${field1}> — No TeXML equivalent. The Telnyx runtime may silently DROP unknown verbs. Replace it (for example, <Sms> → Messaging API; <VirtualAgent> → <Connect><AIAssistant>)." ;;
      esac
      ERRORS=$((ERRORS + 1))
      ;;
    UNKNOWN)
      echo -e "${RED}[ERROR]${NC} <${field1}> — Not a recognized TeXML verb/noun. The runtime may silently DROP it; check spelling, casing, and the public TeXML verb reference."
      ERRORS=$((ERRORS + 1))
      ;;
    NESTING)
      echo -e "${RED}[ERROR]${NC} <${field1}> — Invalid TeXML nesting under <${field2}>. Documented parent(s): ${field3}."
      ERRORS=$((ERRORS + 1))
      ;;
    BAD_ATTR)
      if [ "$field3" = "REMOVE" ]; then field3="(remove — Twilio-only, silently ignored)"; fi
      echo -e "${RED}[ERROR]${NC} <${field1}> attribute '${field2}' — the runtime matches names case-sensitively and SILENTLY IGNORES unknown ones, so this feature would be dead at runtime. Use: ${field3}"
      ERRORS=$((ERRORS + 1))
      ;;
    UNKNOWN_ATTR)
      echo -e "${RED}[ERROR]${NC} <${field1}> attribute '${field2}' is not documented for ${field3}. The runtime silently ignores unknown/misplaced attributes, so this feature would be dead at runtime."
      ERRORS=$((ERRORS + 1))
      ;;
    SCHEMA_ERROR)
      echo -e "${RED}[ERROR]${NC} <${field1}> attribute '${field2}' has an invalid static value — ${field3}."
      ERRORS=$((ERRORS + 1))
      ;;
    STRUCTURE_ERROR)
      echo -e "${RED}[ERROR]${NC} <${field1}> — ${field2}."
      ERRORS=$((ERRORS + 1))
      ;;
    UNRESOLVED)
      echo -e "${YELLOW}[WARN]${NC}  <${field1}> '${field2}' — ${field3}; validate the rendered TeXML before production."
      WARNINGS=$((WARNINGS + 1))
      ;;
    NAMESPACE)
      echo -e "${RED}[ERROR]${NC} Namespaced TeXML element '${field1}' is not supported — ${field2}."
      ERRORS=$((ERRORS + 1))
      ;;
    NAMESPACE_ATTR)
      echo -e "${RED}[ERROR]${NC} <${field1}> uses namespaced attribute '${field2}'. TeXML attributes must be unqualified."
      ERRORS=$((ERRORS + 1))
      ;;
    ANALYSIS_COMPLETE)
      ;;
  esac
done <<< "$ANALYSIS_OUTPUT"

USED_TAGS=$(printf '%s\n' "$ANALYSIS_OUTPUT" | awk -F '\t' '$1 == "USED" {print $2}')
ATTR_RECORDS=$(printf '%s\n' "$ANALYSIS_OUTPUT" | awk -F '\t' '$1 == "ATTR" {print $2 "\t" $3}')
POLLY_VALUES=$(printf '%s\n' "$ANALYSIS_OUTPUT" | awk -F '\t' '$1 == "POLLY" {print $2}')

has_used_tag() {
  local haystack needle
  haystack=$'\n'"$USED_TAGS"$'\n'
  needle=$'\n'"$1"$'\n'
  [[ "$haystack" == *"$needle"* ]]
}

has_attribute() {
  local haystack needle
  haystack=$'\n'"$ATTR_RECORDS"$'\n'
  needle=$'\n'"${1}"$'\t'"${2}"$'\n'
  [[ "$haystack" == *"$needle"* ]]
}

has_content_flag() {
  local haystack needle
  haystack=$'\n'"$ANALYSIS_OUTPUT"$'\n'
  needle=$'\n'"CONTENT"$'\t'"${1}"$'\n'
  [[ "$haystack" == *"$needle"* ]]
}

# --- Check for supported verbs and report ---
for verb in $SUPPORTED_VERBS; do
  if has_used_tag "$verb"; then
    echo -e "${GREEN}[OK]${NC}    <${verb}> — Supported"
    OK=$((OK + 1))
  fi
done

for noun in $SUPPORTED_NOUNS; do
  if has_used_tag "$noun"; then
    echo -e "${GREEN}[OK]${NC}    <${noun}> — Supported"
    OK=$((OK + 1))
  fi
done

# --- Check for behavioral differences ---

# Recording channel default
if has_used_tag "Record"; then
  if ! has_attribute "Record" "channels"; then
    echo -e "${YELLOW}[WARN]${NC}  <Record> — No 'channels' attribute set. Telnyx defaults to dual-channel (Twilio defaults to single). Add channels=\"single\" to match Twilio behavior."
    WARNINGS=$((WARNINGS + 1))
  fi
fi

# `<Dial recordingChannels>` already defaults to `single` on Telnyx. Preserve
# the source `record` value (`record-from-*-dual` when dual output is intended)
# and only set `recordingChannels` when the target behavior requires it.

# Polly voice compatibility — the runtime keeps any supported named Polly voice
# as-is (and rewrites -Neural variants internally), so a valid Polly voice must
# NOT be downgraded. Only note Neural as a quality preference; never suggest
# replacing a caller-facing voice with "woman".
if [ -n "$POLLY_VALUES" ]; then
  non_neural=$(printf '%s\n' "$POLLY_VALUES" | sed 's/^/voice="/; s/$/"/' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
  echo -e "${BLUE}[INFO]${NC}  Non-Neural Polly voice(s): $non_neural — valid and kept as-is by the runtime. A -Neural variant gives higher quality where available; do NOT replace the voice with \"woman\"."
  INFO=$((INFO + 1))
fi

# HMAC signature references in code-like content
if has_content_flag "TWILIO_SIGNATURE"; then
  echo -e "${YELLOW}[WARN]${NC}  File references Twilio webhook signature validation. Telnyx uses Ed25519 (telnyx-signature-ed25519 header)."
  WARNINGS=$((WARNINGS + 1))
fi

# Twilio-specific URL patterns
if has_content_flag "TWILIO_API"; then
  echo -e "${YELLOW}[WARN]${NC}  File contains api.twilio.com URLs. Replace with api.telnyx.com/v2/texml endpoints."
  WARNINGS=$((WARNINGS + 1))
fi

# Check for Basic Auth patterns
if has_content_flag "ACCOUNT_SID"; then
  echo -e "${YELLOW}[WARN]${NC}  File references Twilio Account SID. Telnyx uses Bearer token authentication."
  WARNINGS=$((WARNINGS + 1))
fi

# --- Telnyx features and migration notes ---
echo ""
echo -e "${BOLD}Telnyx Features and Migration Notes${NC}"
echo "─────────────────────────────────────"

if has_used_tag "Gather"; then
  if ! has_attribute "Gather" "transcriptionEngine"; then
    echo -e "${BLUE}[INFO]${NC}  <Gather> supports multiple documented STT engines. Select an engine/model/language combination from the current TeXML Gather reference instead of assuming the default."
    INFO=$((INFO + 1))
  fi
fi

if has_used_tag "Say"; then
  echo -e "${BLUE}[INFO]${NC}  <Say> supports ElevenLabs voices: voice=\"ElevenLabs.{ModelId}.{VoiceId}\" for high-quality synthesis."
  INFO=$((INFO + 1))
fi

if has_used_tag "Dial"; then
  if ! has_used_tag "Transcription"; then
    echo -e "${BLUE}[INFO]${NC}  Telnyx supports real-time transcription with <Start><Transcription .../></Start> before <Dial>. TwiML supports the same structure, but its attributes and defaults differ; translate them using references/texml-verbs.md."
    INFO=$((INFO + 1))
  fi
  if ! has_attribute "Dial" "ringTone"; then
    echo -e "${BLUE}[INFO]${NC}  <Dial> supports country-specific ringback tones via ringTone attribute (37+ countries)."
    INFO=$((INFO + 1))
  fi
fi

if has_used_tag "Start" || has_used_tag "Stream"; then
  if ! has_attribute "Stream" "bidirectionalMode"; then
    echo -e "${BLUE}[INFO]${NC}  <Stream> supports bidirectional audio via bidirectionalMode and bidirectionalCodec attributes."
    INFO=$((INFO + 1))
  fi
fi

# --- Summary ---
echo ""
echo "─────────────────────────────────────"
echo -e "${BOLD}Summary${NC}"
echo -e "  ${GREEN}OK${NC}:       $OK supported elements"
echo -e "  ${RED}Errors${NC}:   $ERRORS compatibility blockers"
echo -e "  ${YELLOW}Warnings${NC}: $WARNINGS behavioral differences"
echo -e "  ${BLUE}Info${NC}:     $INFO Telnyx feature/migration notes"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Migration blocked:${NC} $ERRORS compatibility error(s) found. Fix them before migrating."
  exit 1
else
  echo ""
  echo -e "${GREEN}${BOLD}Migration compatible.${NC} Address warnings before going to production."
  exit 0
fi
