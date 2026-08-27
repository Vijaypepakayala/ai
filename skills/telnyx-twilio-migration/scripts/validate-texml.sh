#!/usr/bin/env bash
#
# validate-texml.sh — Check TwiML/TeXML XML for Telnyx compatibility
#
# Usage: bash validate-texml.sh <file.xml>
#
# Reports:
#   [ERROR]   Unsupported verbs with no TeXML equivalent
#   [WARN]    Attributes with different defaults or behavior
#   [INFO]    Telnyx-only features you could adopt
#   [OK]      Verb is fully supported
#
# Exit codes:
#   0 — All checks passed (may have warnings/info)
#   1 — Errors found (unsupported verbs)
#   2 — Usage error (missing file, not XML)

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

# Check if file looks like XML
if ! head -5 "$FILE" | grep -Eq '<(Response|response)([[:space:]/>]|$)'; then
  echo -e "${RED}[ERROR]${NC} File does not appear to be a TwiML/TeXML document (no <Response> tag found)"
  exit 2
fi

echo -e "${BOLD}TeXML Compatibility Report${NC}"
echo -e "File: $FILE"
echo "─────────────────────────────────────"

ERRORS=0
WARNINGS=0
INFO=0
OK=0

# --- Supported top-level verbs ---
SUPPORTED_VERBS="Say Play Gather Dial Record Hangup Pause Redirect Reject Refer Enqueue Leave Start Stop Connect Pay"

# --- Supported nouns ---
SUPPORTED_NOUNS="Number Sip Queue Conference Stream Transcription Suppression Siprec"

# --- Unsupported TwiML verbs ---
# Keep the loop for future compatibility gaps. Pay is supported and therefore
# belongs in SUPPORTED_VERBS, not in this denylist.
UNSUPPORTED_VERBS=""

has_tag() {
  awk -v tag="$1" '
    BEGIN { in_comment = 0; found = 0 }
    {
      input = $0; active = ""
      while (length(input)) {
        if (in_comment) {
          close_at = index(input, "-->")
          if (!close_at) { input = ""; continue }
          input = substr(input, close_at + 3); in_comment = 0
        } else {
          open_at = index(input, "<!--")
          if (!open_at) { active = active input; input = ""; continue }
          active = active substr(input, 1, open_at - 1)
          input = substr(input, open_at + 4); in_comment = 1
        }
      }
      if (active ~ ("<" tag "([[:space:]/>]|$)")) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$FILE"
}

# --- Check for unsupported verbs ---
for verb in $UNSUPPORTED_VERBS; do
  if has_tag "$verb"; then
    echo -e "${RED}[ERROR]${NC} <${verb}> — No TeXML equivalent. This verb is not supported by Telnyx."
    ERRORS=$((ERRORS + 1))
  fi
done

# --- Check for supported verbs and report ---
for verb in $SUPPORTED_VERBS; do
  [ "$verb" = "Pay" ] && continue
  if has_tag "$verb"; then
    echo -e "${GREEN}[OK]${NC}    <${verb}> — Supported"
    OK=$((OK + 1))
  fi
done

for noun in $SUPPORTED_NOUNS; do
  if has_tag "$noun"; then
    echo -e "${GREEN}[OK]${NC}    <${noun}> — Supported"
    OK=$((OK + 1))
  fi
done

if has_tag Pay; then
  pay_errors=0
  if ! command -v python3 >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} <Pay> — python3 is required for fail-closed Pay attribute validation"
    ERRORS=$((ERRORS + 1))
    pay_errors=$((pay_errors + 1))
  else
    pay_validation_output=""
    pay_validation_status=0
    pay_errors_before_parser=$pay_errors
    if pay_validation_output=$(python3 - "$FILE" <<'PY'
import json
import re
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
allowed = {
    "action", "method", "statusCallback", "statusCallbackMethod",
    "paymentConnector", "chargeAmount", "currency", "paymentToken",
    "paymentMethod", "postalCode", "minPostalCodeLength", "validCardTypes",
    "transactionType", "description", "maxAttempts",
    "timeout", "interDigitTimeout", "voice", "language", "serviceLevel",
    "parameters", "prompts", "metadata",
}
prompt_allowed = {"for", "attempt", "errorType", "cardType"}
prompt_steps = {
    "payment-card-number", "expiration-date", "postal-code", "security-code",
    "bank-routing-number", "bank-account-number",
}
valid_card_types = {
    "visa", "mastercard", "amex", "maestro", "discover", "optima", "jcb",
    "diners-club", "enroute",
}


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def dynamic(value):
    return bool(
        re.search(r"(?:\$\{|\{\{|<%|#\{)", value)
        or re.fullmatch(r"\{[A-Za-z_][A-Za-z0-9_.:-]*\}", value.strip())
    )


def validate_integer(element, name, minimum, maximum):
    value = element.attrib.get(name)
    if value is None or dynamic(value):
        return
    valid = re.fullmatch(r"\d+", value) and int(value) >= minimum
    if valid and maximum is not None:
        valid = int(value) <= maximum
    if not valid:
        if maximum is None:
            print(f"{name} must be an integer of at least {minimum}")
        else:
            print(f"{name} must be an integer from {minimum} through {maximum}")


def validate_json_object(element, name):
    value = element.attrib.get(name)
    if value is None or dynamic(value):
        return
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        print(f"{name} must be a valid JSON object string")
        return
    if not isinstance(parsed, dict):
        print(f"{name} must be a JSON object")


try:
    tree = ET.parse(path)
    root = tree.getroot()
except (ET.ParseError, LookupError, OSError, ValueError) as exc:
    print(f"XML parse error: {exc}")
    raise SystemExit(1)

parents = {child: parent for parent in tree.iter() for child in parent}
for element in root.iter():
    if local_name(element.tag) != "Pay":
        continue
    parent = parents.get(element)
    if parent is not root or local_name(root.tag) != "Response":
        print("Pay must be a direct child of the Response root")
    for name in element.attrib:
        if name not in allowed:
            print(f"unknown or mis-cased attribute {name!r}; allowed attributes: {', '.join(sorted(allowed))}")
    connector = element.attrib.get("paymentConnector")
    if connector is not None and not connector.strip():
        print("paymentConnector must not be blank")
    amount = element.attrib.get("chargeAmount")
    if amount is not None and not dynamic(amount) and not re.fullmatch(r"(?:\d+(?:\.\d+)?|\.\d+)", amount):
        print("chargeAmount must be a non-negative decimal string")
    currency = element.attrib.get("currency")
    if currency is not None and not dynamic(currency) and currency != "USD":
        print("currency must be USD")
    payment_method = element.attrib.get("paymentMethod")
    if payment_method is not None and not dynamic(payment_method) and payment_method not in {"credit-card", "ach-debit"}:
        print("paymentMethod must be credit-card or ach-debit")
    postal_code = element.attrib.get("postalCode")
    if postal_code is not None and not dynamic(postal_code) and not postal_code.strip():
        print("postalCode must not be blank")
    validate_integer(element, "minPostalCodeLength", 1, None)
    card_types = element.attrib.get("validCardTypes")
    if card_types is not None and not dynamic(card_types):
        tokens = card_types.split()
        if not tokens or any(token not in valid_card_types for token in tokens):
            print("validCardTypes must be a whitespace-delimited list of supported card types")
    for name in ("method", "statusCallbackMethod"):
        value = element.attrib.get(name)
        if value is not None and not dynamic(value) and value not in {"GET", "POST"}:
            print(f"{name} must be GET or POST")
    transaction_type = element.attrib.get("transactionType")
    if transaction_type is not None and not dynamic(transaction_type) and transaction_type not in {"charge", "tokenize"}:
        print("transactionType must be charge or tokenize")
    if transaction_type == "charge" and (amount is None or not amount.strip()):
        print("transactionType=charge requires chargeAmount")
    if amount is not None and not dynamic(amount):
        try:
            if float(amount) <= 0:
                print("chargeAmount must be greater than zero when provided")
        except ValueError:
            pass
    service_level = element.attrib.get("serviceLevel")
    if service_level is not None and not dynamic(service_level) and service_level != "premium":
        print("serviceLevel must be premium")
    validate_integer(element, "maxAttempts", 1, 3)
    validate_integer(element, "timeout", 1, 600)
    validate_integer(element, "interDigitTimeout", 1, 600)
    for name in ("parameters", "prompts", "metadata"):
        validate_json_object(element, name)

    for child in element:
        child_name = local_name(child.tag)
        if child_name not in {"Parameter", "Prompt"}:
            print(f"unsupported direct child <{child_name}>; Pay allows Parameter and Prompt")
            continue
        if child_name == "Parameter":
            unknown = set(child.attrib) - {"name", "value"}
            for name in sorted(unknown):
                print(f"unknown or mis-cased Parameter attribute {name!r}")
            for name in ("name", "value"):
                if not child.attrib.get(name, "").strip():
                    print(f"Parameter requires non-empty {name}")
            if list(child):
                print("Parameter must not contain child elements")
        if child_name == "Prompt":
            for name in child.attrib:
                if name not in prompt_allowed:
                    print(f"unknown or mis-cased Prompt attribute {name!r}")
            prompt_for = child.attrib.get("for", "").strip()
            if not prompt_for:
                print("Prompt requires a non-empty for attribute")
            elif not dynamic(prompt_for) and prompt_for not in prompt_steps:
                print("Prompt for must name a supported payment collection step")
            card_type = child.attrib.get("cardType")
            if card_type is not None and not dynamic(card_type) and card_type not in valid_card_types:
                print("Prompt cardType must name a supported card type")
            prompt_children = list(child)
            if not prompt_children:
                print("Prompt requires at least one direct Say child")
            for grandchild in prompt_children:
                grandchild_name = local_name(grandchild.tag)
                if grandchild_name != "Say":
                    print(f"unsupported Prompt child <{grandchild_name}>; Prompt allows only Say")
                elif list(grandchild):
                    print("Prompt Say must not contain child elements")
            attempts = child.attrib.get("attempt")
            if attempts is not None and not dynamic(attempts):
                values = attempts.split()
                if not values or any(not re.fullmatch(r"[1-9]\d*", value) for value in values):
                    print("Prompt attempt must be a whitespace-delimited list of positive integers")
                elif element.attrib.get("maxAttempts", "1").isdigit() and any(
                    int(value) > int(element.attrib.get("maxAttempts", "1")) for value in values
                ):
                    print("Prompt attempt cannot exceed Pay maxAttempts")
PY
    ); then
      pay_validation_status=0
    else
      pay_validation_status=$?
    fi
    while IFS= read -r error; do
      [ -z "$error" ] && continue
      echo -e "${RED}[ERROR]${NC} <Pay> — $error"
      ERRORS=$((ERRORS + 1))
      pay_errors=$((pay_errors + 1))
    done <<< "$pay_validation_output"
    if [ "$pay_validation_status" -ne 0 ] && [ "$pay_errors" -eq "$pay_errors_before_parser" ]; then
      echo -e "${RED}[ERROR]${NC} <Pay> — XML parser failed without a diagnostic; refusing to certify Pay compatibility"
      ERRORS=$((ERRORS + 1))
      pay_errors=$((pay_errors + 1))
    fi
  fi
  if [ "$pay_errors" -eq 0 ]; then
    echo -e "${GREEN}[OK]${NC}    <Pay> — Supported"
    OK=$((OK + 1))
  fi
  echo -e "${BLUE}[INFO]${NC}  <Pay> — Configure a Telnyx Payment Connector in test mode before migrating this flow; never collect or log payment digits in call application code."
  INFO=$((INFO + 1))
fi

# --- Check for behavioral differences ---

# Recording channel default
if has_tag Record; then
  if ! grep -q 'channels=' "$FILE" 2>/dev/null; then
    echo -e "${YELLOW}[WARN]${NC}  <Record> — No 'channels' attribute set. Telnyx defaults to dual-channel (Twilio defaults to single). Add channels=\"single\" to match Twilio behavior."
    WARNINGS=$((WARNINGS + 1))
  fi
fi

# Polly voice compatibility — warn about non-Neural variants
if grep -qE 'voice="Polly\.' "$FILE"; then
  non_neural=$(grep -oE 'voice="Polly\.[^"]*"' "$FILE" | grep -v '\-Neural' || true)
  if [ -n "$non_neural" ]; then
    echo -e "${YELLOW}[WARN]${NC}  Non-Neural Polly voice(s) found: $non_neural — may fall back to default voice. Prefer Neural variants (e.g., Polly.Amy-Neural) or use voice=\"woman\" with language attribute."
    WARNINGS=$((WARNINGS + 1))
  fi
fi

# HMAC signature references in code-like content
if grep -qi 'X-Twilio-Signature\|RequestValidator\|validateRequest' "$FILE"; then
  echo -e "${YELLOW}[WARN]${NC}  File references Twilio webhook signature validation. Telnyx uses Ed25519 (telnyx-signature-ed25519 header)."
  WARNINGS=$((WARNINGS + 1))
fi

# Twilio-specific URL patterns
if grep -q 'api\.twilio\.com' "$FILE"; then
  echo -e "${YELLOW}[WARN]${NC}  File contains api.twilio.com URLs. Replace with api.telnyx.com/v2/texml endpoints."
  WARNINGS=$((WARNINGS + 1))
fi

# Check for Basic Auth patterns
if grep -qi 'AccountSid\|AC[a-f0-9]\{32\}' "$FILE"; then
  echo -e "${YELLOW}[WARN]${NC}  File references Twilio Account SID. Telnyx uses Bearer token authentication."
  WARNINGS=$((WARNINGS + 1))
fi

# --- Telnyx-only features they could adopt ---
echo ""
echo -e "${BOLD}Telnyx-Only Features Available${NC}"
echo "─────────────────────────────────────"

if has_tag Gather; then
  if ! grep -q 'transcriptionEngine=' "$FILE" 2>/dev/null; then
    echo -e "${BLUE}[INFO]${NC}  <Gather> supports multiple STT engines: Google, Telnyx, Deepgram, Azure. Add transcriptionEngine=\"Deepgram\" for enhanced speech recognition."
    INFO=$((INFO + 1))
  fi
fi

if has_tag Say; then
  echo -e "${BLUE}[INFO]${NC}  <Say> supports ElevenLabs voices: voice=\"ElevenLabs.{ModelId}.{VoiceId}\" for high-quality synthesis."
  INFO=$((INFO + 1))
fi

if has_tag Dial; then
  if ! has_tag Transcription; then
    echo -e "${BLUE}[INFO]${NC}  Add real-time transcription with <Start><Transcription .../></Start> before <Dial>. No TwiML equivalent."
    INFO=$((INFO + 1))
  fi
  if ! grep -q 'ringTone=' "$FILE" 2>/dev/null; then
    echo -e "${BLUE}[INFO]${NC}  <Dial> supports country-specific ringback tones via ringTone attribute (37+ countries)."
    INFO=$((INFO + 1))
  fi
fi

if has_tag Start || has_tag Stream; then
  if ! grep -q 'bidirectionalMode=' "$FILE" 2>/dev/null; then
    echo -e "${BLUE}[INFO]${NC}  <Stream> supports bidirectional audio via bidirectionalMode and bidirectionalCodec attributes."
    INFO=$((INFO + 1))
  fi
fi

if has_tag Connect; then
  echo -e "${BLUE}[INFO]${NC}  <Connect> is Telnyx-only — synchronous streaming that blocks until the service ends."
  INFO=$((INFO + 1))
fi

# --- Summary ---
echo ""
echo "─────────────────────────────────────"
echo -e "${BOLD}Summary${NC}"
echo -e "  ${GREEN}OK${NC}:       $OK supported elements"
echo -e "  ${RED}Errors${NC}:   $ERRORS unsupported verbs"
echo -e "  ${YELLOW}Warnings${NC}: $WARNINGS behavioral differences"
echo -e "  ${BLUE}Info${NC}:     $INFO Telnyx-only features available"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Migration blocked:${NC} $ERRORS unsupported verb(s) found. These must be removed or replaced before migrating."
  exit 1
else
  echo ""
  echo -e "${GREEN}${BOLD}Migration compatible.${NC} Address warnings before going to production."
  exit 0
fi
