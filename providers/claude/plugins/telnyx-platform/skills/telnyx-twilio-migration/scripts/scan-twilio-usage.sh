#!/usr/bin/env bash
# scan-twilio-usage.sh — Grep-based Twilio codebase scanner
# Outputs structured JSON describing Twilio SDK usage, products, env vars,
# config files, TwiML templates, webhook handlers, and API URLs.
#
# Usage: ./scan-twilio-usage.sh <project-root>

set -euo pipefail

# Requires bash 4+ for associative arrays (declare -A)
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "Error: This script requires bash 4+. You have bash ${BASH_VERSION}." >&2
  echo "  macOS: brew install bash (then use /opt/homebrew/bin/bash or /usr/local/bin/bash)" >&2
  echo "  Linux: bash 4+ is standard" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
  echo "Usage: $0 <project-root>" >&2
  exit 1
}

log() {
  echo "[scan] $*" >&2
}

# Escape a string for safe embedding inside a JSON string value.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  usage
fi

PROJECT_ROOT="$1"

if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "Error: directory '$PROJECT_ROOT' does not exist." >&2
  exit 1
fi

# Resolve to absolute path
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

# ---------------------------------------------------------------------------
# Exclude directories (passed to grep via --exclude-dir)
# ---------------------------------------------------------------------------

EXCLUDE_DIRS=(
  node_modules .git vendor __pycache__ venv .venv
  dist build .next .nuxt coverage .tox
)

EXCLUDE_ARGS=()
for d in "${EXCLUDE_DIRS[@]}"; do
  EXCLUDE_ARGS+=(--exclude-dir="$d")
done
# Exclude minified/bundled files (can cause grep OOM and produce false positives)
EXCLUDE_ARGS+=(--exclude='*.min.js' --exclude='*.min.css' --exclude='*.bundle.js' --exclude='*.chunk.js')
# Exclude lock files (contain Twilio version strings but aren't source code)
EXCLUDE_ARGS+=(--exclude='package-lock.json' --exclude='yarn.lock' --exclude='pnpm-lock.yaml' --exclude='Gemfile.lock' --exclude='Pipfile.lock' --exclude='poetry.lock' --exclude='go.sum')

# ---------------------------------------------------------------------------
# State — associative arrays / arrays collected during the scan
# ---------------------------------------------------------------------------

# NOTE: associative arrays MUST be initialized with =() so that `${#ARR[@]}`
# is safe under `set -u` even when no entries are added (clean/empty scan).
declare -A LANG_SET=()       # languages_detected  (key=lang, value=1)
declare -A PRODUCT_SET=()    # products_used        (key=product, value=1)

# Per-file info stored as parallel indexed arrays
declare -a FILE_PATHS=()     # relative paths
declare -a FILE_LANGS=()     # language per file
declare -a FILE_PRODUCTS=()  # comma-separated products per file
declare -a FILE_PATTERNS=()  # comma-separated matched patterns per file

declare -a ENV_NAMES=()      # env var names
declare -a ENV_FILES=()      # comma-separated files per env var
declare -A ENV_MAP=()        # name -> comma-separated files

declare -a CFG_PATHS=()      # config file relative paths
declare -a CFG_TYPES=()      # config types (pip, npm, gem, ...)
declare -a CFG_LINES=()      # matching line content

declare -a TWIML_FILES=()    # TwiML template paths

declare -a WH_PATHS=()       # webhook handler file paths
declare -a WH_PATTERNS=()    # webhook matched pattern

declare -a API_URLS=()       # unique API URLs found
declare -a API_URL_FILES=()  # comma-separated files per URL
declare -A API_URL_MAP       # url -> comma-separated files

# ---------------------------------------------------------------------------
# Scanning helpers
# ---------------------------------------------------------------------------

# run_grep <label> <extra-grep-args...>
# Runs grep -rn inside PROJECT_ROOT with standard excludes and returns
# matching lines (path:lineno:content). Returns 0 even if nothing matched.
run_grep() {
  grep -rn "${EXCLUDE_ARGS[@]}" "$@" "$PROJECT_ROOT" 2>/dev/null || true
}

# Return success when the target line starts inside a C-style block comment.
# Quote-shaped substrings are removed before comment delimiters are inspected,
# so URLs or literal examples do not open a comment state.
line_starts_in_block_comment() {
  local filepath="$1"
  local target_line="$2"
  awk -v target="$target_line" '
    BEGIN {
      block = 0; quote = ""; target_block = 0
      sq = sprintf("%c", 39); dq = sprintf("%c", 34); bt = sprintf("%c", 96)
    }
    NR <= target {
      if (NR == target) target_block = block
      input = $0; i = 1
      while (i <= length(input)) {
        c = substr(input, i, 1)
        two = substr(input, i, 2)
        three = substr(input, i, 3)
        if (block) {
          if (two == "*/") { block = 0; i += 2 } else i++
          continue
        }
        if (quote != "") {
          if (quote == "td" && three == dq dq dq) { quote = ""; i += 3; continue }
          if (quote == "ts" && three == sq sq sq) { quote = ""; i += 3; continue }
          if (quote == "td" || quote == "ts") { i++; continue }
          if (c == "\\") { i += 2; continue }
          if (c == quote) quote = ""
          i++
          continue
        }
        if (two == "/*") { block = 1; i += 2; continue }
        if (two == "//" || c == "#") break
        if (three == dq dq dq) { quote = "td"; i += 3; continue }
        if (three == sq sq sq) { quote = "ts"; i += 3; continue }
        if (c == dq || c == sq || c == bt) { quote = c; i++; continue }
        i++
      }
    }
    END { exit(target_block ? 0 : 1) }
  ' "$filepath"
}

# Return success only when PATTERN occurs in executable source on TARGET_LINE.
# This masks line/block comments and single, double, backtick, and triple-quoted
# strings while preserving state across lines. It keeps fixture/documentation
# strings such as `"response.pay()"` from becoming Pay migrations.
source_line_has_active_pattern() {
  local filepath="$1"
  local target_line="$2"
  local pattern="$3"
  TELNYX_ACTIVE_SOURCE_PATTERN="$pattern" awk -v target="$target_line" '
    BEGIN {
      block = 0; quote = ""; found = 0
      pattern = ENVIRON["TELNYX_ACTIVE_SOURCE_PATTERN"]
      sq = sprintf("%c", 39); dq = sprintf("%c", 34); bt = sprintf("%c", 96)
    }
    NR <= target {
      input = $0; active = ""; i = 1
      while (i <= length(input)) {
        c = substr(input, i, 1)
        two = substr(input, i, 2)
        three = substr(input, i, 3)
        if (block) {
          if (two == "*/") { block = 0; i += 2 } else i++
          continue
        }
        if (quote != "") {
          if (quote == "td" && three == dq dq dq) { quote = ""; i += 3; continue }
          if (quote == "ts" && three == sq sq sq) { quote = ""; i += 3; continue }
          if (quote == "td" || quote == "ts") { i++; continue }
          if (c == "\\") { i += 2; continue }
          if (c == quote) quote = ""
          i++
          continue
        }
        if (two == "/*") { block = 1; i += 2; continue }
        if (two == "//" || c == "#") break
        if (three == dq dq dq) { quote = "td"; i += 3; continue }
        if (three == sq sq sq) { quote = "ts"; i += 3; continue }
        if (c == dq || c == sq || c == bt) { quote = c; i++; continue }
        active = active c
        i++
      }
      if (NR == target && tolower(active) ~ tolower(pattern)) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$filepath"
}

# Return success when TARGET_LINE contains an active XML element matching the
# supplied ERE after XML comments have been removed across line boundaries.
xml_line_has_active_pattern() {
  local filepath="$1"
  local target_line="$2"
  local pattern="$3"
  awk -v target="$target_line" -v pattern="$pattern" '
    BEGIN { in_comment = 0; found = 0 }
    NR <= target {
      input = $0
      active = ""
      while (length(input)) {
        if (in_comment) {
          close_at = index(input, "-->")
          if (!close_at) { input = ""; continue }
          input = substr(input, close_at + 3)
          in_comment = 0
        } else {
          open_at = index(input, "<!--")
          if (!open_at) { active = active input; input = ""; continue }
          active = active substr(input, 1, open_at - 1)
          input = substr(input, open_at + 4)
          in_comment = 1
        }
      }
      if (NR == target && active ~ pattern) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$filepath"
}

xml_file_has_active_pattern() {
  local filepath="$1"
  local pattern="$2"
  awk -v pattern="$pattern" '
    BEGIN { in_comment = 0; found = 0 }
    {
      input = $0
      active = ""
      while (length(input)) {
        if (in_comment) {
          close_at = index(input, "-->")
          if (!close_at) { input = ""; continue }
          input = substr(input, close_at + 3)
          in_comment = 0
        } else {
          open_at = index(input, "<!--")
          if (!open_at) { active = active input; input = ""; continue }
          active = active substr(input, 1, open_at - 1)
          input = substr(input, open_at + 4)
          in_comment = 1
        }
      }
      if (active ~ pattern) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$filepath"
}

# Return success only when a receiver's VoiceResponse constructor is live
# source. Alias use must not borrow proof from a line or block comment.
has_active_voice_response_constructor() {
  local filepath="$1"
  local receiver_pattern="$2"
  local constructor_pattern
  local match
  local lineno
  local content
  local trimmed

  constructor_pattern="${receiver_pattern}([[:space:]]*:[[:space:]]*[^=;]+)?[[:space:]]*(=|:=)[[:space:]]*(new[[:space:]]+)?&?([[:alnum:]_:.]+[.:])?(New)?VoiceResponse"
  while IFS= read -r match; do
    [[ -n "$match" ]] || continue
    lineno="${match%%:*}"
    content="${match#*:}"
    trimmed="$(printf '%s\n' "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    line_starts_in_block_comment "$filepath" "$lineno" && continue
    source_line_has_active_pattern "$filepath" "$lineno" "$constructor_pattern" || continue
    return 0
  done < <(grep -nE -- "$constructor_pattern" "$filepath" 2>/dev/null || true)
  return 1
}

# Return success when RECEIVER is either constructed from VoiceResponse or is
# connected to one through a bounded chain of simple local assignments. Walk
# backwards from the Pay receiver so every supported assignment spelling gets
# the same semantic treatment without accepting arbitrary domain `.pay()` calls.
has_active_voice_response_alias_chain() {
  local filepath="$1"
  local receiver="$2"
  local -a queue=("$receiver")
  local -a visited=()
  local current escaped_current assignment_pattern match lineno content assignment source seen
  local cursor=0

  while [ "$cursor" -lt "${#queue[@]}" ] && [ "$cursor" -lt 32 ]; do
    current="${queue[$cursor]}"
    cursor=$((cursor + 1))
    seen=false
    for source in "${visited[@]}"; do
      if [ "$source" = "$current" ]; then seen=true; break; fi
    done
    [ "$seen" = true ] && continue
    visited+=("$current")

    escaped_current="$(printf '%s\n' "$current" | sed 's/[][(){}.^$*+?|\/]/\\&/g')"
    if has_active_voice_response_constructor "$filepath" "$escaped_current"; then
      return 0
    fi

    assignment_pattern="${escaped_current}([[:space:]]*:[[:space:]]*[^=;]+)?[[:space:]]*(=|:=)[[:space:]]*([$]?[[:alpha:]_][[:alnum:]_]*)"
    while IFS= read -r match; do
      [ -n "$match" ] || continue
      lineno="${match%%:*}"
      content="${match#*:}"
      source_line_has_active_pattern "$filepath" "$lineno" "$assignment_pattern" || continue
      assignment="$(printf '%s\n' "$content" | grep -oiE "$assignment_pattern" | head -1)"
      source="$(printf '%s\n' "$assignment" | sed -E 's/.*(=|:=)[[:space:]]*//; s/[^$[:alnum:]_].*$//')"
      [ -n "$source" ] && queue+=("$source")
    done <<< "$(grep -niE -- "$assignment_pattern" "$filepath" 2>/dev/null || true)"
  done
  return 1
}

# Return success only when the file actively imports or fully qualifies the
# Twilio Java/C# Pay node. This lets the scanner recognize `new Pay(...)`
# without treating an unrelated application's Pay class as Twilio Pay.
has_active_twilio_pay_type_context() {
  local filepath="$1"
  local match
  local lineno
  local content
  local trimmed

  while IFS= read -r match; do
    [[ -n "$match" ]] || continue
    lineno="${match%%:*}"
    content="${match#*:}"
    trimmed="$(printf '%s\n' "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    line_starts_in_block_comment "$filepath" "$lineno" && continue
    source_line_has_active_pattern "$filepath" "$lineno" 'import[[:space:]]+com\.twilio\.twiml\.voice\.Pay|using[[:space:]]+Twilio\.TwiML\.Voice|Twilio\.TwiML\.Voice\.Pay' || continue
    return 0
  done < <(grep -niE -- 'import[[:space:]]+com\.twilio\.twiml\.voice\.Pay|using[[:space:]]+Twilio\.TwiML\.Voice|Twilio\.TwiML\.Voice\.Pay' "$filepath" 2>/dev/null || true)
  return 1
}

# Detect language from file extension
detect_language() {
  local f="$1"
  case "$f" in
    *.py)                     echo "python" ;;
    *.js|*.jsx|*.mjs|*.cjs)  echo "javascript" ;;
    *.ts|*.tsx)               echo "typescript" ;;
    *.go)                     echo "go" ;;
    *.rb)                     echo "ruby" ;;
    *.java)                   echo "java" ;;
    *.php)                    echo "php" ;;
    *.cs)                     echo "csharp" ;;
    *.sh|*.bash|*.zsh)        echo "shell" ;;
    *.xml|*.twiml)            echo "xml" ;;
    *.json)                   echo "json" ;;
    *.yml|*.yaml)             echo "yaml" ;;
    *.env|*.env.*)            echo "env" ;;
    *.toml)                   echo "toml" ;;
    *.cfg)                    echo "config" ;;
    *.txt)                    echo "text" ;;
    *.swift)                  echo "swift" ;;
    *.kt|*.kts)               echo "kotlin" ;;
    *.scala)                  echo "scala" ;;
    *.dart)                   echo "dart" ;;
    *.gradle)                 echo "groovy" ;;
    *.csproj)                 echo "xml" ;;
    *)                        echo "unknown" ;;
  esac
}

# Map a matched pattern to zero or more products (space-separated)
pattern_to_products() {
  local pat="$1"
  local products=""
  # WebRTC (mobile + browser SDKs) — check before voice to avoid false categorization
  if echo "$pat" | grep -qiE 'TwilioVoiceSDK|import TwilioVoice|TVOCall|TVOCallInvite|TVOCallDelegate|com\.twilio\.voice|com\.twilio:voice-android|@twilio/voice-react-native|twilio_voice|Twilio\.Device|@twilio/voice-sdk|twilio-client|new Device\('; then
    products="$products webrtc"
  fi
  # Voice (server-side API/SDK — excludes mobile SDK patterns to avoid double-tagging)
  if echo "$pat" | grep -qiE 'twiml|VoiceResponse|CallResource|VoiceGrant|\.calls\.create|\.calls\.list'; then
    # Skip if already tagged as webrtc (mobile SDK patterns)
    if ! echo "$products" | grep -q 'webrtc'; then
      products="$products voice"
    fi
  fi
  # Messaging
  if echo "$pat" | grep -qiE 'Messages\.create|MessageResource|messaging'; then
    products="$products messaging"
  fi
  # Video
  if echo "$pat" | grep -qiE 'twilio-video|VideoGrant|Room'; then
    products="$products video"
  fi
  # Verify
  if echo "$pat" | grep -qiE 'twilio/rest/verify|VerificationResource|verify'; then
    products="$products verify"
  fi
  # Fax
  if echo "$pat" | grep -qiE 'twilio/rest/fax|FaxResource|fax'; then
    products="$products fax"
  fi
  # Lookup
  if echo "$pat" | grep -qiE 'twilio/rest/lookups|PhoneNumber|lookups'; then
    products="$products lookup"
  fi
  # TeXML (TwiML)
  if echo "$pat" | grep -qiE 'twilio/twiml|texml'; then
    products="$products texml"
  fi
  # Webhook validation
  if echo "$pat" | grep -qiE 'RequestValidator|validateRequest|X-Twilio-Signature'; then
    products="$products webhook-validation"
  fi
  # SIP trunking
  if echo "$pat" | grep -qiE 'trunking|TrunkingGrant|SipGrant'; then
    products="$products sip"
  fi
  # IoT / Wireless
  if echo "$pat" | grep -qiE 'wireless|supersim|SuperSim|SimResource|fleet\.create'; then
    products="$products iot"
  fi
  # Conversations
  if echo "$pat" | grep -qiE 'conversations\.v1|ConversationResource'; then
    products="$products conversations"
  fi
  # Notify
  if echo "$pat" | grep -qiE 'notify\.v1|NotificationResource'; then
    products="$products notify"
  fi
  # Proxy
  if echo "$pat" | grep -qiE 'proxy\.v1|ProxyService'; then
    products="$products proxy"
  fi
  # Autopilot
  if echo "$pat" | grep -qiE 'autopilot\.v1|AutopilotTask'; then
    products="$products autopilot"
  fi
  # TaskRouter
  if echo "$pat" | grep -qiE 'taskrouter|TaskRouterWorker|WorkflowResource'; then
    products="$products taskrouter"
  fi
  # Studio
  if echo "$pat" | grep -qiE 'studio\.v2|studio\.v1|flow\.create'; then
    products="$products studio"
  fi
  # Flex
  if echo "$pat" | grep -qiE 'flex\.v1|FlexFlow|@twilio/flex-ui|@twilio/flex-plugin|twilio-flex'; then
    products="$products flex"
  fi
  # Pay
  if echo "$pat" | grep -qiE '\.pay\b|PayResource|<Pay([[:space:]/>]|$)'; then
    products="$products pay"
  fi
  echo "$products"
}

# Register a file hit: record_file <rel_path> <language> <product> <pattern>
# Accumulates products and patterns for files already seen.
declare -A FILE_INDEX  # rel_path -> index into FILE_* arrays

record_file() {
  local rel="$1" lang="$2" product="$3" pattern="$4"
  if [[ -n "$lang" && "$lang" != "unknown" ]]; then
    LANG_SET["$lang"]=1
  fi
  if [[ -n "$product" ]]; then
    PRODUCT_SET["$product"]=1
  fi

  if [[ -v FILE_INDEX["$rel"] ]]; then
    local idx="${FILE_INDEX[$rel]}"
    # Append product if not already listed
    if [[ -n "$product" ]] && ! echo ",${FILE_PRODUCTS[$idx]}," | grep -q ",$product,"; then
      FILE_PRODUCTS[$idx]="${FILE_PRODUCTS[$idx]},$product"
    fi
    # Append pattern if not already listed
    local escaped_pattern
    escaped_pattern="$(json_escape "$pattern")"
    if ! echo "||${FILE_PATTERNS[$idx]}||" | grep -qF "||$escaped_pattern||"; then
      FILE_PATTERNS[$idx]="${FILE_PATTERNS[$idx]}||$escaped_pattern"
    fi
  else
    local idx=${#FILE_PATHS[@]}
    FILE_INDEX["$rel"]=$idx
    FILE_PATHS+=("$rel")
    FILE_LANGS+=("$lang")
    FILE_PRODUCTS+=("$product")
    FILE_PATTERNS+=("$(json_escape "$pattern")")
  fi
}

# ---------------------------------------------------------------------------
# 1. SDK imports
# ---------------------------------------------------------------------------

log "Scanning SDK imports..."

SDK_PATTERNS=(
  # Python
  'from twilio'
  'import twilio'
  # JavaScript / TypeScript
  "require('twilio')"
  'require("twilio")'
  "from 'twilio'"
  'from "twilio"'
  # Go
  'github.com/twilio/twilio-go'
  # Ruby
  "require 'twilio-ruby'"
  'require "twilio-ruby"'
  "gem 'twilio-ruby'"
  # Java
  'import com.twilio'
  'com.twilio.'
  # PHP
  'use Twilio\\'
  'Twilio\\'
  # C# / .NET
  'using Twilio'
  'Twilio.'
  # curl
  'api.twilio.com'
  # iOS (Swift)
  'TwilioVoiceSDK'
  'import TwilioVoice'
  # Android (Kotlin/Java)
  'com.twilio.voice'
  'com.twilio:voice-android'
  # React Native
  '@twilio/voice-react-native'
  # Flutter (Dart)
  'twilio_voice'
  # Browser WebRTC
  'Twilio.Device'
  '@twilio/voice-sdk'
  'twilio-client'
)

# Also catch JS/TS `import ... twilio` via regex
SDK_REGEX_PATTERNS=(
  'import.*twilio'
)

for pat in "${SDK_PATTERNS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    lang="$(detect_language "$rel")"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    products="$(pattern_to_products "$trimmed")"
    if [[ -z "$products" ]]; then
      # Generic SDK import — no specific product
      record_file "$rel" "$lang" "" "$trimmed"
    else
      for p in $products; do
        record_file "$rel" "$lang" "$p" "$trimmed"
      done
    fi
  done < <(run_grep -F "$pat")
done

for pat in "${SDK_REGEX_PATTERNS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    lang="$(detect_language "$rel")"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    products="$(pattern_to_products "$trimmed")"
    if [[ -z "$products" ]]; then
      record_file "$rel" "$lang" "" "$trimmed"
    else
      for p in $products; do
        record_file "$rel" "$lang" "$p" "$trimmed"
      done
    fi
  done < <(run_grep -E "$pat")
done

# ---------------------------------------------------------------------------
# 2. Product-specific patterns (deeper detection)
# ---------------------------------------------------------------------------

log "Scanning product-specific patterns..."

PRODUCT_PATTERNS_FIXED=(
  'VoiceResponse:voice'
  'CallResource:voice'
  'MessageResource:messaging'
  'VideoGrant:video'
  'twilio-video:video'
  'VerificationResource:verify'
  'FaxResource:fax'
  'RequestValidator:webhook-validation'
  'validateRequest:webhook-validation'
  # Mobile WebRTC SDKs
  'TwilioVoiceSDK:webrtc'
  'TVOCall:webrtc'
  'TVOCallInvite:webrtc'
  'TVOCallDelegate:webrtc'
  # Browser WebRTC
  'Twilio.Device:webrtc'
  '@twilio/voice-sdk:webrtc'
  'twilio-client:webrtc'
  # SIP trunking
  'TrunkingGrant:sip'
  'SipGrant:sip'
  # IoT / Wireless
  'SuperSim:iot'
  'SimResource:iot'
  # Conversations
  'ConversationResource:conversations'
  # Notify
  'NotificationResource:notify'
  # Proxy
  'ProxyService:proxy'
  # Autopilot
  'AutopilotTask:autopilot'
  # TaskRouter
  'TaskRouterWorker:taskrouter'
  'WorkflowResource:taskrouter'
)

for entry in "${PRODUCT_PATTERNS_FIXED[@]}"; do
  pat="${entry%:*}"
  product="${entry##*:}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    lang="$(detect_language "$rel")"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    line_starts_in_block_comment "$filepath" "$lineno" && continue
    if [[ "$product" = "pay" ]] && ! source_line_has_active_pattern "$filepath" "$lineno" "$pat"; then
      continue
    fi
    record_file "$rel" "$lang" "$product" "$trimmed"
  done < <(run_grep -F "$pat")
done

# Case-insensitive regex patterns for common method calls
PRODUCT_PATTERNS_REGEX=(
  'messages\.create:messaging'
  'messages\.list:messaging'
  '\.calls\.create:voice'
  '\.calls\.list:voice'
  'verify\.v2:verify'
  'verifications\.create:verify'
  'verification_checks:verify'
  '\.fax\.:fax'
  'faxes\.create:fax'
  'lookups\.v1:lookup'
  'lookups\.v2:lookup'
  'phone_numbers\.fetch:lookup'
  'twiml\.voice:voice'
  'twiml\.messaging:messaging'
  'VoiceGrant:voice'
  'SipGrant:voice'
  # SIP trunking
  'twilio\.rest\.trunking:sip'
  'trunking\.v1:sip'
  'trunk\.create:sip'
  # IoT / Wireless / Super SIM
  'twilio\.rest\.wireless:iot'
  'twilio\.rest\.supersim:iot'
  'wireless\.v1:iot'
  'supersim\.v1:iot'
  'sim\.create:iot'
  'fleet\.create:iot'
  # Conversations
  'twilio\.rest\.conversations:conversations'
  'conversations\.v1:conversations'
  'conversation\.create:conversations'
  # Sync
  'twilio\.rest\.sync:sync'
  'sync\.v1:sync'
  # Notify
  'twilio\.rest\.notify:notify'
  'notify\.v1:notify'
  # Proxy
  'twilio\.rest\.proxy:proxy'
  'proxy\.v1:proxy'
  # Autopilot
  'twilio\.rest\.autopilot:autopilot'
  'autopilot\.v1:autopilot'
  # TaskRouter
  'twilio\.rest\.taskrouter:taskrouter'
  'taskrouter\.v1:taskrouter'
  # Studio
  'twilio\.rest\.studio:studio'
  'studio\.v2:studio'
  'flow\.create:studio'
  # Flex
  'twilio\.rest\.flex:flex'
  'flex\.v1:flex'
  'FlexFlow:flex'
  '@twilio/flex-ui:flex'
  '@twilio/flex-plugin:flex'
  # Pay
  'twilio\.rest\.pay:pay'
  '(^|[^[:alnum:]_$])\$?(voice_?response|response|twiml)[[:alnum:]_]*[[:space:]]*(\.|->)[[:space:]]*pay[[:space:]]*\(:pay'
  'VoiceResponse[[:space:]]*\.[[:space:]]*Builder[[:space:]]*\([^;]*\)[[:space:]]*\.[[:space:]]*pay[[:space:]]*\(:pay'
  'VoiceResponse[[:space:]]*\([^;]*\)[[:space:]]*\)?[[:space:]]*(\.|->)[[:space:]]*pay[[:space:]]*\(:pay'
  'VoiceResponse[[:space:]]*\.[[:space:]]*new([[:space:]]*\([^;]*\))?[[:space:]]*\.[[:space:]]*pay[[:space:]]*\(:pay'
  'PayResource:pay'
  # Mobile WebRTC SDKs
  'com\.twilio\.voice\.:webrtc'
  'com\.twilio:voice-android:webrtc'
  '@twilio/voice-react-native:webrtc'
  'twilio_voice:webrtc'
  'import TwilioVoice:webrtc'
  # Browser WebRTC SDKs
  'new Device\(:webrtc'
  'Twilio\.Device:webrtc'
  '@twilio/voice-sdk:webrtc'
  'twilio-client:webrtc'
)

for entry in "${PRODUCT_PATTERNS_REGEX[@]}"; do
  # Split on the final colon so POSIX classes such as [[:space:]] remain
  # intact inside the pattern.
  pat="${entry%:*}"
  product="${entry##*:}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    lang="$(detect_language "$rel")"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    case "$trimmed" in
      '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
    esac
    line_starts_in_block_comment "$filepath" "$lineno" && continue
    if [[ "$product" = "pay" ]] && ! source_line_has_active_pattern "$filepath" "$lineno" "$pat"; then
      continue
    fi
    record_file "$rel" "$lang" "$product" "$trimmed"
  done < <(run_grep -iE "$pat")
done

# Resolve arbitrary local aliases only when the same receiver is constructed
# from a Twilio VoiceResponse. This catches `ivr = VoiceResponse(); ivr.pay()`
# without turning an unrelated `invoice.pay()` in a Twilio-using file into Pay.
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  filepath="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  case "$trimmed" in
    '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
  esac
  line_starts_in_block_comment "$filepath" "$lineno" && continue
  source_line_has_active_pattern "$filepath" "$lineno" '(\$?[[:alpha:]_][[:alnum:]_]*)[[:space:]]*(\.|->)[[:space:]]*pay[[:space:]]*\(' || continue
  receiver="$(printf '%s\n' "$content" \
    | grep -oiE '(\$?[[:alpha:]_][[:alnum:]_]*)[[:space:]]*(\.|->)[[:space:]]*pay[[:space:]]*\(' \
    | head -1 \
    | sed -E 's/[[:space:]]*(\.|->).*//')"
  [[ -n "$receiver" ]] || continue
  if ! has_active_voice_response_alias_chain "$filepath" "$receiver"; then
    continue
  fi
  rel="${filepath#"$PROJECT_ROOT"/}"
  lang="$(detect_language "$rel")"
  record_file "$rel" "$lang" "pay" "$trimmed"
done < <(run_grep -iE '(\$?[[:alpha:]_][[:alnum:]_]*)[[:space:]]*(\.|->)[[:space:]]*pay[[:space:]]*\(')

# Java's Pay.Builder and C#'s Pay node can be created separately and then
# attached to a VoiceResponse. Require an active Twilio Pay type context so a
# same-named domain model does not become a false positive.
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  filepath="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  case "$trimmed" in
    '//'*|'#'*|'/*'*|'*'*|'<!--'*) continue ;;
  esac
  line_starts_in_block_comment "$filepath" "$lineno" && continue
  source_line_has_active_pattern "$filepath" "$lineno" '(^|[^[:alnum:]_])(new[[:space:]]+)?(Twilio\.TwiML\.Voice\.)?Pay[[:space:]]*(\.[[:space:]]*Builder)?[[:space:]]*\(' || continue
  has_active_twilio_pay_type_context "$filepath" || continue
  rel="${filepath#"$PROJECT_ROOT"/}"
  lang="$(detect_language "$rel")"
  record_file "$rel" "$lang" "pay" "$trimmed"
done < <(run_grep -iE '(^|[^[:alnum:]_])(new[[:space:]]+)?(Twilio\.TwiML\.Voice\.)?Pay[[:space:]]*(\.[[:space:]]*Builder)?[[:space:]]*\(')

# ---------------------------------------------------------------------------
# 3. Environment variables
# ---------------------------------------------------------------------------

log "Scanning environment variables..."

ENV_VAR_NAMES=(
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_API_KEY
  TWILIO_API_KEY_SECRET
  TWILIO_API_KEY_SID
  TWILIO_PHONE_NUMBER
  TWILIO_FROM_NUMBER
  TWILIO_NUMBER
  TWILIO_TWIML_APP_SID
  TWILIO_MESSAGING_SERVICE_SID
  TWILIO_VERIFY_SERVICE_SID
)

for varname in "${ENV_VAR_NAMES[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    if [[ -v ENV_MAP["$varname"] ]]; then
      if ! echo ",${ENV_MAP[$varname]}," | grep -q ",$rel,"; then
        ENV_MAP["$varname"]="${ENV_MAP[$varname]},$rel"
      fi
    else
      ENV_MAP["$varname"]="$rel"
    fi
  done < <(run_grep -F "$varname")
done

for varname in "${!ENV_MAP[@]}"; do
  ENV_NAMES+=("$varname")
  ENV_FILES+=("${ENV_MAP[$varname]}")
done

# ---------------------------------------------------------------------------
# 4. API URLs
# ---------------------------------------------------------------------------

log "Scanning API URLs..."

API_URL_LIST=(
  api.twilio.com
  verify.twilio.com
  messaging.twilio.com
  video.twilio.com
  trunking.twilio.com
  lookups.twilio.com
  fax.twilio.com
)

for url in "${API_URL_LIST[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    if [[ -v API_URL_MAP["$url"] ]]; then
      if ! echo ",${API_URL_MAP[$url]}," | grep -q ",$rel,"; then
        API_URL_MAP["$url"]="${API_URL_MAP[$url]},$rel"
      fi
    else
      API_URL_MAP["$url"]="$rel"
    fi
  done < <(run_grep -F "$url")
done

for url in "${!API_URL_MAP[@]}"; do
  API_URLS+=("$url")
  API_URL_FILES+=("${API_URL_MAP[$url]}")
done

# ---------------------------------------------------------------------------
# 5. Config / dependency files
# ---------------------------------------------------------------------------

log "Scanning config files..."

CONFIG_FILES=(
  "requirements.txt:pip"
  "package.json:npm"
  "Gemfile:gem"
  "go.mod:gomod"
  "pom.xml:maven"
  "build.gradle:gradle"
  "composer.json:composer"
  "Pipfile:pipenv"
  "setup.py:setuptools"
  "setup.cfg:setuptools"
  "pyproject.toml:pyproject"
  "requirements-to-freeze.txt:pip"
  "Podfile:cocoapods"
  "pubspec.yaml:pub"
)

# shellcheck disable=SC2034  # reserved for future C#/.NET dependency scanning
CSPROJ_PATTERN="*.csproj:nuget"

# Scan known config filenames
for entry in "${CONFIG_FILES[@]}"; do
  filename="${entry%%:*}"
  cfgtype="${entry#*:}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rest="${line#*:}"
    content="${rest#*:}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    CFG_PATHS+=("$rel")
    CFG_TYPES+=("$cfgtype")
    CFG_LINES+=("$(json_escape "$trimmed")")
  done < <(run_grep -F "twilio" --include="$filename")
done

# Scan *.csproj files
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  filepath="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  rel="${filepath#"$PROJECT_ROOT"/}"
  trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  CFG_PATHS+=("$rel")
  CFG_TYPES+=("nuget")
  CFG_LINES+=("$(json_escape "$trimmed")")
done < <(run_grep -F "Twilio" --include="*.csproj")

# ---------------------------------------------------------------------------
# 6. TwiML files — XML files containing <Response> with voice verbs
# ---------------------------------------------------------------------------

log "Scanning TwiML files..."

TWIML_VERBS='<(Say|Play|Dial|Gather|Record|Hangup|Redirect|Pause|Enqueue|Pay)([[:space:]/>]|$)'

contains_inline_texml_pay_literal() {
  awk '
    function strip_xml_comments(s, start, tail, finish) {
      while ((start = index(s, "<!--")) > 0) {
        tail = substr(s, start + 4)
        finish = index(tail, "-->")
        if (!finish) return substr(s, 1, start - 1)
        s = substr(s, 1, start - 1) substr(tail, finish + 3)
      }
      return s
    }
    function tags(s) {
      s = strip_xml_comments(s)
      return s ~ /<Response([[:space:]\/>]|$)/ && s ~ /<Pay([[:space:]\/>]|$)/
    }
    function close_literal() {
      if (tags(literal)) found = 1
      literal = ""
      state = ""
    }
    {
      line = $0
      if (state == "heredoc") {
        candidate = line
        sub(/^[[:space:]]*/, "", candidate)
        sub(/[[:space:]]*;?[[:space:]]*$/, "", candidate)
        if (candidate == heredoc_label) {
          close_literal()
          next
        }
      }
      if (state != "") literal = literal "\n"
      i = 1
      while (i <= length(line)) {
        rest = substr(line, i)
        c = substr(line, i, 1)
        if (state == "") {
          if (block_comment) {
            end_comment = index(rest, "*/")
            if (!end_comment) break
            block_comment = 0
            i += end_comment + 1
          } else if (substr(rest, 1, 2) == "//" || c == "#") {
            break
          } else if (substr(rest, 1, 2) == "/*") {
            block_comment = 1
            i += 2
          } else if (substr(rest, 1, 3) == "\"\"\"") {
            state = "triple-double"
            literal = ""
            i += 3
          } else if (substr(rest, 1, 3) == "\047\047\047") {
            state = "triple-single"
            literal = ""
            i += 3
          } else if (substr(rest, 1, 3) == "%q{") {
            state = "percent-q"
            literal = ""
            i += 3
          } else if (match(rest, /^<<[-~]?[[:space:]]*["\047]?[[:alpha:]_][[:alnum:]_]*["\047]?/)) {
            opener = substr(rest, RSTART, RLENGTH)
            sub(/^<<[-~]?[[:space:]]*/, "", opener)
            gsub(/["\047]/, "", opener)
            heredoc_label = opener
            state = "heredoc"
            literal = ""
            break
          } else if (c == "`") {
            state = "backtick"
            literal = ""
            i++
          } else if (c == "\"") {
            state = "double"
            literal = ""
            i++
          } else if (c == "\047") {
            state = "single"
            literal = ""
            i++
          } else {
            i++
          }
        } else if (state == "triple-double" && substr(rest, 1, 3) == "\"\"\"") {
          close_literal()
          i += 3
        } else if (state == "triple-single" && substr(rest, 1, 3) == "\047\047\047") {
          close_literal()
          i += 3
        } else if (state == "percent-q" && c == "}") {
          close_literal()
          i++
        } else if (state == "backtick" && c == "`") {
          close_literal()
          i++
        } else if (state == "double" && c == "\"") {
          close_literal()
          i++
        } else if (state == "single" && c == "\047") {
          close_literal()
          i++
        } else if ((state == "double" || state == "single" || state == "backtick") && c == "\\") {
          literal = literal c substr(line, i + 1, 1)
          i += 2
        } else {
          literal = literal c
          i++
        }
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  filepath="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  rel="${filepath#"$PROJECT_ROOT"/}"
  # Verify the file also contains <Response>
  if xml_file_has_active_pattern "$filepath" '<Response([[:space:]/>]|$)'; then
    # Deduplicate
    local_found=0
    for existing in "${TWIML_FILES[@]+"${TWIML_FILES[@]}"}"; do
      if [[ "$existing" == "$rel" ]]; then
        local_found=1
        break
      fi
    done
    if [[ $local_found -eq 0 ]]; then
      TWIML_FILES+=("$rel")
    fi
    if xml_line_has_active_pattern "$filepath" "$lineno" '<[Pp][Aa][Yy]([[:space:]/>]|$)'; then
      lang="$(detect_language "$rel")"
      trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
      record_file "$rel" "$lang" "pay" "$trimmed"
    fi
  fi
done < <(run_grep -E "$TWIML_VERBS" --include="*.xml" --include="*.twiml")

# Inline TeXML documents can live in source strings rather than standalone
# XML files. Apply the same Response + Pay semantic contract to every source
# language the migration scanner advertises.
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  filepath="${line%%:*}"
  rest="${line#*:}"
  content="${rest#*:}"
  if contains_inline_texml_pay_literal "$filepath"; then
    rel="${filepath#"$PROJECT_ROOT"/}"
    lang="$(detect_language "$rel")"
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    record_file "$rel" "$lang" "pay" "$trimmed"
  fi
done < <(run_grep -E '<Pay([[:space:]/>]|$)' \
  --include="*.py" --include="*.js" --include="*.ts" --include="*.jsx" \
  --include="*.tsx" --include="*.mjs" --include="*.cjs" --include="*.rb" \
  --include="*.php" --include="*.go" --include="*.java" --include="*.kt" --include="*.kts" \
  --include="*.scala" --include="*.cs" --include="*.sh" --include="*.bash" \
  --include="*.zsh")

# ---------------------------------------------------------------------------
# 7. Webhook validation handlers
# ---------------------------------------------------------------------------

log "Scanning webhook handlers..."

WH_TERMS=(
  "RequestValidator"             # Python/Node/Ruby/PHP SDK validator class
  "validateRequest"              # method call on RequestValidator
  "X-Twilio-Signature"           # header name (any casing)
  "twilio.webhook"               # Express middleware (Node)
  "Twilio.webhook"               # same, capitalised import
  "Twilio::Security"             # Ruby namespace housing RequestValidator
  "validate_twilio_request"      # common Rails before_action / Flask decorator name
)

for term in "${WH_TERMS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    # Deduplicate by rel+term
    dup=0
    for i in "${!WH_PATHS[@]}"; do
      if [[ "${WH_PATHS[$i]}" == "$rel" && "${WH_PATTERNS[$i]}" == "$term" ]]; then
        dup=1
        break
      fi
    done
    if [[ $dup -eq 0 ]]; then
      WH_PATHS+=("$rel")
      WH_PATTERNS+=("$term")
    fi
  done < <(run_grep -F "$term")
done

# ---------------------------------------------------------------------------
# 8. Config/deployment files with TWILIO_ references
# ---------------------------------------------------------------------------

log "Scanning config and deployment files for TWILIO_ references..."

declare -a DEPLOY_PATHS=()
declare -a DEPLOY_TYPES=()

DEPLOY_PATTERNS=(
  ".env:env"
  ".env.example:env"
  ".env.local:env"
  ".env.production:env"
  ".env.development:env"
  "docker-compose.yml:docker"
  "docker-compose.yaml:docker"
  "Dockerfile:docker"
  "app.json:heroku"
  "app.yaml:gae"
  "serverless.yml:serverless"
  "serverless.yaml:serverless"
  "terraform.tfvars:terraform"
  "variables.tf:terraform"
  "*.tf:terraform"
  ".github/workflows/*.yml:ci"
  ".github/workflows/*.yaml:ci"
  ".circleci/config.yml:ci"
  ".gitlab-ci.yml:ci"
  "Procfile:procfile"
  "render.yaml:render"
  "fly.toml:fly"
  "vercel.json:vercel"
  "netlify.toml:netlify"
)

for entry in "${DEPLOY_PATTERNS[@]}"; do
  filename="${entry%%:*}"
  dtype="${entry#*:}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    # Deduplicate
    dup=0
    for existing in "${DEPLOY_PATHS[@]+"${DEPLOY_PATHS[@]}"}"; do
      if [[ "$existing" == "$rel" ]]; then
        dup=1
        break
      fi
    done
    if [[ $dup -eq 0 ]]; then
      DEPLOY_PATHS+=("$rel")
      DEPLOY_TYPES+=("$dtype")
    fi
  done < <(run_grep -iE "TWILIO_|twilio" --include="$filename")
done

# ---------------------------------------------------------------------------
# 9. Test mocks (detect test files mocking Twilio)
# ---------------------------------------------------------------------------

log "Scanning for test mocks..."

declare -a MOCK_PATHS=()

MOCK_PATTERNS_REGEX=(
  'mock.*twilio'
  '@patch.*twilio'
  'jest\.mock.*twilio'
  'stub.*twilio'
  'fake.*twilio'
  'nock.*twilio'
  'sinon.*twilio'
  'WebMock.*twilio'
  'VCR.*twilio'
)

for pat in "${MOCK_PATTERNS_REGEX[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    filepath="${line%%:*}"
    rel="${filepath#"$PROJECT_ROOT"/}"
    # Deduplicate
    dup=0
    for existing in "${MOCK_PATHS[@]+"${MOCK_PATHS[@]}"}"; do
      if [[ "$existing" == "$rel" ]]; then
        dup=1
        break
      fi
    done
    if [[ $dup -eq 0 ]]; then
      MOCK_PATHS+=("$rel")
    fi
  done < <(run_grep -iE "$pat")
done

# ---------------------------------------------------------------------------
# Build JSON output
# ---------------------------------------------------------------------------

log "Building JSON output..."

SCAN_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# --- languages_detected ---
lang_json=""
for lang in "${!LANG_SET[@]}"; do
  [[ -n "$lang_json" ]] && lang_json="$lang_json, "
  lang_json="$lang_json\"$lang\""
done

# --- products_used ---
prod_json=""
for prod in "${!PRODUCT_SET[@]}"; do
  [[ -n "$prod_json" ]] && prod_json="$prod_json, "
  prod_json="$prod_json\"$prod\""
done

# --- files array ---
files_json=""
for i in "${!FILE_PATHS[@]}"; do
  [[ -n "$files_json" ]] && files_json="$files_json,"
  rel="$(json_escape "${FILE_PATHS[$i]}")"
  lang="${FILE_LANGS[$i]}"
  # Build products array from comma-separated
  prods_arr=""
  IFS=',' read -ra plist <<< "${FILE_PRODUCTS[$i]}"
  for p in "${plist[@]}"; do
    p="$(echo "$p" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    [[ -z "$p" ]] && continue
    [[ -n "$prods_arr" ]] && prods_arr="$prods_arr, "
    prods_arr="$prods_arr\"$p\""
  done
  # Build patterns array from ||-separated
  pats_arr=""
  IFS=$'\x1f' read -ra patlist <<< "${FILE_PATTERNS[$i]//'||'/$'\x1f'}"
  for pt in "${patlist[@]}"; do
    [[ -z "$pt" ]] && continue
    [[ -n "$pats_arr" ]] && pats_arr="$pats_arr, "
    pats_arr="$pats_arr\"$pt\""
  done
  files_json="$files_json
    {
      \"path\": \"$rel\",
      \"language\": \"$lang\",
      \"products\": [$prods_arr],
      \"patterns_matched\": [$pats_arr]
    }"
done

# --- env_vars array ---
env_json=""
for i in "${!ENV_NAMES[@]}"; do
  [[ -n "$env_json" ]] && env_json="$env_json,"
  name="${ENV_NAMES[$i]}"
  files_list=""
  IFS=',' read -ra elist <<< "${ENV_FILES[$i]}"
  for ef in "${elist[@]}"; do
    ef="$(echo "$ef" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    [[ -z "$ef" ]] && continue
    [[ -n "$files_list" ]] && files_list="$files_list, "
    files_list="$files_list\"$(json_escape "$ef")\""
  done
  env_json="$env_json
    {
      \"name\": \"$name\",
      \"files\": [$files_list]
    }"
done

# --- config_files array ---
cfg_json=""
for i in "${!CFG_PATHS[@]}"; do
  [[ -n "$cfg_json" ]] && cfg_json="$cfg_json,"
  cfg_json="$cfg_json
    {
      \"path\": \"$(json_escape "${CFG_PATHS[$i]}")\",
      \"type\": \"${CFG_TYPES[$i]}\",
      \"line\": \"${CFG_LINES[$i]}\"
    }"
done

# --- twiml_files array ---
twiml_json=""
for tf in "${TWIML_FILES[@]+"${TWIML_FILES[@]}"}"; do
  [[ -n "$twiml_json" ]] && twiml_json="$twiml_json, "
  twiml_json="$twiml_json\"$(json_escape "$tf")\""
done

# --- webhook_handlers array ---
wh_json=""
for i in "${!WH_PATHS[@]}"; do
  [[ -n "$wh_json" ]] && wh_json="$wh_json,"
  wh_json="$wh_json
    {
      \"path\": \"$(json_escape "${WH_PATHS[$i]}")\",
      \"pattern\": \"$(json_escape "${WH_PATTERNS[$i]}")\"
    }"
done

# --- api_urls array ---
api_json=""
for i in "${!API_URLS[@]}"; do
  [[ -n "$api_json" ]] && api_json="$api_json,"
  url="${API_URLS[$i]}"
  files_list=""
  IFS=',' read -ra alist <<< "${API_URL_FILES[$i]}"
  for af in "${alist[@]}"; do
    af="$(echo "$af" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    [[ -z "$af" ]] && continue
    [[ -n "$files_list" ]] && files_list="$files_list, "
    files_list="$files_list\"$(json_escape "$af")\""
  done
  api_json="$api_json
    {
      \"url\": \"$url\",
      \"files\": [$files_list]
    }"
done

# --- summary ---
# Use (( ${#ARR[@]} > 0 )) for "array has elements" — safe under `set -u` for
# declared arrays and avoids shellcheck SC2199 (array concatenation in [[ ]]).
total_files=${#FILE_PATHS[@]}
total_products=${#PRODUCT_SET[@]}
total_languages=${#LANG_SET[@]}
has_webhook="false"
(( ${#WH_PATHS[@]} > 0 )) && has_webhook="true"
has_twiml="false"
(( ${#TWIML_FILES[@]} > 0 )) && has_twiml="true"
has_env="false"
(( ${#ENV_NAMES[@]} > 0 )) && has_env="true"
has_deploy="false"
(( ${#DEPLOY_PATHS[@]} > 0 )) && has_deploy="true"
has_mocks="false"
(( ${#MOCK_PATHS[@]} > 0 )) && has_mocks="true"

# --- deploy_files array ---
deploy_json=""
for i in "${!DEPLOY_PATHS[@]}"; do
  [[ -n "$deploy_json" ]] && deploy_json="$deploy_json,"
  deploy_json="$deploy_json
    {
      \"path\": \"$(json_escape "${DEPLOY_PATHS[$i]}")\",
      \"type\": \"${DEPLOY_TYPES[$i]}\"
    }"
done

# --- test_mocks array ---
mock_json=""
for mf in "${MOCK_PATHS[@]+"${MOCK_PATHS[@]}"}"; do
  [[ -n "$mock_json" ]] && mock_json="$mock_json, "
  mock_json="$mock_json\"$(json_escape "$mf")\""
done

# ---------------------------------------------------------------------------
# Print final JSON to stdout
# ---------------------------------------------------------------------------

cat <<ENDJSON
{
  "scan_version": "1.0.0",
  "project_root": "$(json_escape "$PROJECT_ROOT")",
  "scan_time": "$SCAN_TIME",
  "languages_detected": [$lang_json],
  "products_used": [$prod_json],
  "files": [${files_json}
  ],
  "env_vars": [${env_json}
  ],
  "config_files": [${cfg_json}
  ],
  "twiml_files": [${twiml_json}],
  "webhook_handlers": [${wh_json}
  ],
  "api_urls": [${api_json}
  ],
  "deploy_files": [${deploy_json}
  ],
  "test_mocks": [${mock_json}],
  "summary": {
    "total_files": $total_files,
    "total_products": $total_products,
    "total_languages": $total_languages,
    "has_webhook_validation": $has_webhook,
    "has_twiml": $has_twiml,
    "has_env_vars": $has_env,
    "has_deploy_config": $has_deploy,
    "has_test_mocks": $has_mocks
  },
  "notes": [
    "Standard TWILIO_* env vars are scanned above. Also search for non-standard names that may contain Twilio SIDs or phone numbers (e.g., ACCOUNT_SID, SMS_FROM, PHONE_NUMBER)."
  ]
}
ENDJSON

log "Scan complete. Found $total_files files, $total_products products, $total_languages languages."
