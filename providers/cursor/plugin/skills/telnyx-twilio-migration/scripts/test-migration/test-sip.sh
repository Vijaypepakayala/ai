#!/usr/bin/env bash
#
# test-sip.sh — Validate SIP trunking connection setup via Telnyx API
#
# Usage: bash test-sip.sh [--confirm | --dry-run]
#
# Arguments:
#   --confirm    Required to proceed with SIP connection validation
#   --dry-run    Validate API key only, skip connection checks
#   --help       Show this help and exit
#
# Environment variables (required):
#   TELNYX_API_KEY           Your Telnyx API key
#
# Environment variables (optional — auto-detected/created if not set):
#   TELNYX_SIP_CONNECTION_ID   SIP connection ID (auto-detected/created if not set)
#
# Exit codes:
#   0 — SIP setup validation succeeded, or a help/read-only preview completed
#   1 — SIP validation, cleanup, or setup failed
#   2 — Invalid arguments or conflicting flags
#
# Cost: FREE — no paid API calls are made by this test.
#   This test only validates SIP connection configuration;
#   it does not send actual SIP traffic (that requires a PBX).

set -euo pipefail

RUN_NONCE_RANDOM=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || true)
[ -n "$RUN_NONCE_RANDOM" ] || RUN_NONCE_RANDOM="${RANDOM}${RANDOM}"
RUN_NONCE="$$-${RUN_NONCE_RANDOM}"

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

# --- Parse arguments ---
CONFIRMED=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRMED=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: bash test-sip.sh [--confirm | --dry-run]"
      echo ""
      echo "Validates SIP trunking connection setup via the Telnyx API."
      echo "No actual SIP traffic is sent (that requires a PBX)."
      echo ""
      echo "Flags:"
      echo "  --confirm    Required to proceed with connection validation"
      echo "  --dry-run    Validate API key only, skip connection checks"
      echo ""
      echo "Environment variables:"
      echo "  TELNYX_API_KEY           (required) Your Telnyx API key"
      echo "  TELNYX_SIP_CONNECTION_ID (optional) SIP connection ID (auto-detected/created)"
      echo ""
      echo "Cost: FREE — no paid API calls."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

if [ "$CONFIRMED" = true ] && [ "$DRY_RUN" = true ]; then
  echo "Error: --confirm and --dry-run are mutually exclusive." >&2
  exit 2
fi

echo -e "${BOLD}Telnyx SIP Trunking Test${NC}"
echo "========================"
echo ""
echo -e "${GREEN}${BOLD}COST: FREE — no paid API calls${NC}"
echo ""

# --- Validate hard prerequisites ---
ERRORS=0

if [ -z "${TELNYX_API_KEY:-}" ]; then
  echo -e "  ${RED}FAIL${NC}  TELNYX_API_KEY is not set"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}PASS${NC}  TELNYX_API_KEY is set"
fi

if ! command -v curl &>/dev/null; then
  echo -e "  ${RED}FAIL${NC}  curl is not installed"
  ERRORS=$((ERRORS + 1))
fi

HAS_JQ=false
if command -v jq &>/dev/null; then
  HAS_JQ=true
  echo -e "  ${GREEN}PASS${NC}  jq is available"
else
  echo -e "  ${YELLOW}WARN${NC}  jq not installed — required for auto-setup. Install with: brew install jq / apt install jq"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Setup validation failed. Fix the errors above.${NC}"
  exit 1
fi

# --- Step 1: Validate API key ---
echo ""
echo -e "${BOLD}Step 1: Validating API key...${NC}"

BALANCE_RESPONSE=$(curl -s -w $'\n%{http_code}' \
  -H "Authorization: Bearer ${TELNYX_API_KEY}" \
  "https://api.telnyx.com/v2/balance" 2>/dev/null || printf '\n000')
HTTP_CODE=$(printf '%s\n' "$BALANCE_RESPONSE" | tail -1)
HTTP_BODY=$(printf '%s\n' "$BALANCE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ] || ! echo "$HTTP_BODY" | jq -e \
  'type == "object" and ((.errors? // []) | length == 0) and (.data | type == "object") and (.data.balance | (type == "number" or type == "string")) and ((.data.balance | tonumber?) != null)' \
  >/dev/null 2>&1; then
  echo -e "  ${RED}FAIL${NC}  API key/account validation failed (HTTP $HTTP_CODE or malformed balance response)"
  exit 1
fi
echo -e "  ${GREEN}PASS${NC}  API key is valid"

# --- Dry run exits here ---
if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${BOLD}Dry run complete.${NC} API key is valid."
  echo "  Run with --confirm to validate SIP connection setup."
  exit 0
fi

# --- Require --confirm ---
if [ "$CONFIRMED" = false ]; then
  echo ""
  echo -e "${BOLD}What this test will do:${NC}"
  echo "  1. Validate your Telnyx API key"
  echo "  2. Detect an existing SIP connection, or CREATE a new credential"
  echo "     connection named 'migration-test-sip' if none exists"
  echo "  3. Verify the connection is active"
  echo "  4. If (and only if) this run created the connection, also CREATE a"
  echo "     dedicated Outbound Voice Profile ('migration-test-ovp') and attach"
  echo "     it to that new connection"
  echo "  5. Delete both temporary resources and report the validation result"
  echo ""
  echo -e "${BOLD}What this test will NOT do without explicit opt-in:${NC}"
  echo "  Modify an existing connection. If your existing connection has no"
  echo "  Outbound Voice Profile, the test FAILS with instructions instead of"
  echo "  changing it. To attach a chosen profile to a chosen existing"
  echo "  connection, bind approval to both exact IDs:"
  echo "    TELNYX_SIP_CONNECTION_ID=<connection-uuid> TELNYX_OVP_ID=<profile-uuid> \\"
  echo "    TELNYX_APPROVE_TRUNK_MODIFY='<connection-uuid>|<profile-uuid>' bash test-sip.sh --confirm"
  echo ""
  echo "  Cost: FREE (created test resources carry no charge)"
  echo ""
  echo "Run with --confirm to proceed."
  exit 0
fi

# Track and remove only resources created by this test. A generated credential
# connection uses a random password that is intentionally never exposed, so
# leaving it behind would create unusable account clutter.
CREATED_CONNECTION_ID=""
CREATED_OVP_ID=""
SIP_CLEANUP_LEAKS=""

cleanup_sip_resources() {
  local failed=0 code=""
  if [ -n "$CREATED_CONNECTION_ID" ]; then
    if ! code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      "https://api.telnyx.com/v2/credential_connections/${CREATED_CONNECTION_ID}" 2>/dev/null); then code="000"; fi
    case "$code" in
      200|202|204|404) echo -e "  ${GREEN}PASS${NC}  Removed temporary credential connection ${CREATED_CONNECTION_ID}"; CREATED_CONNECTION_ID="" ;;
      *) echo -e "  ${RED}FAIL${NC}  Temporary credential connection may remain: ${CREATED_CONNECTION_ID} (HTTP ${code})"; SIP_CLEANUP_LEAKS="connection=${CREATED_CONNECTION_ID}"; failed=1 ;;
    esac
  fi
  if [ -n "$CREATED_OVP_ID" ]; then
    if ! code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      "https://api.telnyx.com/v2/outbound_voice_profiles/${CREATED_OVP_ID}" 2>/dev/null); then code="000"; fi
    case "$code" in
      200|202|204|404) echo -e "  ${GREEN}PASS${NC}  Removed temporary Outbound Voice Profile ${CREATED_OVP_ID}"; CREATED_OVP_ID="" ;;
      *) echo -e "  ${RED}FAIL${NC}  Temporary Outbound Voice Profile may remain: ${CREATED_OVP_ID} (HTTP ${code})"; SIP_CLEANUP_LEAKS="${SIP_CLEANUP_LEAKS}${SIP_CLEANUP_LEAKS:+, }ovp=${CREATED_OVP_ID}"; failed=1 ;;
    esac
  fi
  return "$failed"
}

cleanup_sip_on_exit() {
  local status=$?
  trap - EXIT
  trap '' INT TERM
  set +e
  if ! cleanup_sip_resources; then
    echo -e "  ${RED}FAIL${NC}  Manual cleanup required: ${SIP_CLEANUP_LEAKS}"
    status=1
  fi
  trap - INT TERM
  exit "$status"
}
trap cleanup_sip_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Merge every page from a Telnyx list endpoint. Pagination metadata must stay
# stable across the bounded scan so auto-detection never creates or selects a
# resource from a partial account view.
fetch_all_pages() {
  local endpoint="$1" page=1 total_pages=1 reported_total page_response page_data all_data='[]'
  while [ "$page" -le "$total_pages" ]; do
    page_response=$(curl -s -g -G \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      --data-urlencode "page[number]=${page}" \
      --data-urlencode "page[size]=100" \
      "$endpoint" 2>/dev/null || echo "")
    if ! echo "$page_response" | jq -e --argjson page "$page" '
      type == "object" and
      (.data | type == "array") and
      ((.errors? // []) | length == 0) and
      ((.meta.page_number? == null) or .meta.page_number == $page) and
      ((.meta.total_pages? == null) or
        ((.meta.total_pages | type) == "number" and
         .meta.total_pages >= 0 and .meta.total_pages <= 100 and
         (.meta.total_pages | floor) == .meta.total_pages))
    ' >/dev/null 2>&1; then
      return 1
    fi
    reported_total=$(echo "$page_response" | jq -r '.meta.total_pages // 1')
    if [ "$page" -eq 1 ]; then
      total_pages="$reported_total"
    elif [ "$reported_total" != "$total_pages" ]; then
      return 1
    fi
    page_data=$(echo "$page_response" | jq -c '.data')
    all_data=$(jq -cn --argjson existing "$all_data" --argjson current "$page_data" '$existing + $current') || return 1
    page=$((page + 1))
  done
  jq -cn --argjson data "$all_data" '{data: $data}'
}

# --- Step 2: Auto-detect or create SIP connection ---
echo ""
echo -e "${BOLD}Step 2: Detecting SIP connection...${NC}"

CONNECTION_ID="${TELNYX_SIP_CONNECTION_ID:-}"
CONNECTION_TYPE=""
CONNECTION_NAME=""
# True only when THIS RUN created the connection. Mutation policy hinges on it:
# resources this run created may be configured freely; pre-existing resources
# are never modified without the explicit TELNYX_OVP_ID +
# TELNYX_ALLOW_TRUNK_MODIFY=yes opt-in.
CONNECTION_CREATED=false

if [ -n "$CONNECTION_ID" ]; then
  echo -e "  ${GREEN}PASS${NC}  TELNYX_SIP_CONNECTION_ID provided: ${CONNECTION_ID}"
else
  echo -e "  ${BLUE}INFO${NC}  TELNYX_SIP_CONNECTION_ID not set — auto-detecting..."

  # Search existing connections
  CONN_RESPONSE=$(fetch_all_pages "https://api.telnyx.com/v2/connections" || echo "")

  if ! echo "$CONN_RESPONSE" | jq -e 'type == "object" and (.data | type == "array") and ((.errors? // []) | length == 0)' >/dev/null 2>&1; then
    echo -e "  ${RED}FAIL${NC}  Could not read SIP connections; refusing to create one from an ambiguous response."
    exit 1
  fi

  if [ "$HAS_JQ" = true ]; then
    # Prefer a connection that ALREADY has an Outbound Voice Profile attached:
    # it is immediately usable and needs no mutation. Picking the first
    # connection blindly can hard-fail later (or demand an opt-in modification)
    # while a perfectly good connection sits further down the list.
    _fallback_ip_id=""
    _fallback_credential_id=""
    _unreadable_candidate_details=0
    for _cand in $(echo "$CONN_RESPONSE" | jq -r '
      [.data[] | select(.record_type == "ip_connection" or .record_type == "credential_connection")]
      | .[] | "\(.record_type)|\(.id)"' 2>/dev/null); do
      _ctype="${_cand%%|*}"; _cid="${_cand#*|}"
      _ep="credential_connections"; [ "$_ctype" = "ip_connection" ] && _ep="ip_connections"
      _candidate_detail=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
        "https://api.telnyx.com/v2/${_ep}/${_cid}" 2>/dev/null || echo "")
      if ! echo "$_candidate_detail" | jq -e --arg id "$_cid" --arg rt "$_ctype" \
        'type == "object" and .data.id == $id and .data.record_type == $rt and (.data.active | type == "boolean") and ((.errors? // []) | length == 0)' >/dev/null 2>&1; then
        _unreadable_candidate_details=$((_unreadable_candidate_details + 1))
        continue
      fi
      if [ "$(echo "$_candidate_detail" | jq -r '.data.active')" != "true" ]; then
        continue
      fi
      if [ "$_ctype" = "ip_connection" ] && [ -z "$_fallback_ip_id" ]; then
        _fallback_ip_id="$_cid"
      elif [ "$_ctype" = "credential_connection" ] && [ -z "$_fallback_credential_id" ]; then
        _fallback_credential_id="$_cid"
      fi
      _has_ovp=$(echo "$_candidate_detail" | jq -r '.data.outbound.outbound_voice_profile_id // empty' 2>/dev/null)
      if [ -n "$_has_ovp" ]; then
        _ovp_detail=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
          "https://api.telnyx.com/v2/outbound_voice_profiles/${_has_ovp}" 2>/dev/null || echo "")
        if ! echo "$_ovp_detail" | jq -e --arg id "$_has_ovp" \
          'type == "object" and .data.id == $id and .data.enabled == true and ((.errors? // []) | length == 0)' >/dev/null 2>&1; then
          continue
        fi
        CONNECTION_ID="$_cid"
        CONNECTION_TYPE="credential"; [ "$_ctype" = "ip_connection" ] && CONNECTION_TYPE="ip"
        CONNECTION_NAME=$(echo "$CONN_RESPONSE" | jq -r --arg id "$_cid" '
          [.data[] | select(.id == $id)] | .[0].connection_name // empty' 2>/dev/null)
        echo -e "  ${GREEN}PASS${NC}  Found ${CONNECTION_TYPE} connection with an Outbound Voice Profile attached: ${CONNECTION_ID} (${CONNECTION_NAME})"
        break
      fi
    done

    # Fall back to the first detail-validated active connection (IP, then
    # credential) only if no already-configured connection exists.
    if [ -z "$CONNECTION_ID" ]; then
      if [ -n "$_fallback_ip_id" ]; then
        CONNECTION_ID="$_fallback_ip_id"
        CONNECTION_TYPE="ip"
      elif [ -n "$_fallback_credential_id" ]; then
        CONNECTION_ID="$_fallback_credential_id"
        CONNECTION_TYPE="credential"
      fi
      if [ -n "$CONNECTION_ID" ]; then
        CONNECTION_NAME=$(echo "$CONN_RESPONSE" | jq -r --arg id "$CONNECTION_ID" '
          [.data[] | select(.id == $id)] | .[0].connection_name // empty
        ' 2>/dev/null)
        echo -e "  ${GREEN}PASS${NC}  Found active ${CONNECTION_TYPE} connection: ${CONNECTION_ID} (${CONNECTION_NAME})"
      fi
    fi

    if [ -z "$CONNECTION_ID" ] && [ "$_unreadable_candidate_details" -gt 0 ]; then
      echo -e "  ${RED}FAIL${NC}  Listed SIP connection details were unreadable; refusing to create a connection from an ambiguous account view."
      exit 1
    fi
  fi

  # If no SIP connection found, create a credential connection
  if [ -z "$CONNECTION_ID" ]; then
    echo -e "  ${BLUE}INFO${NC}  No SIP connection found — creating credential connection..."

    # POST /v2/credential_connections REQUIRES user_name and password (verified
    # live: omitting them returns 422). Without these the auto-setup path could
    # never succeed, so the test always failed on accounts with no SIP connection.
    SIP_TEST_USER="mt${RUN_NONCE//-/}"
    SIP_TEST_USER="${SIP_TEST_USER:0:32}"
    SIP_CONNECTION_NAME="migration-test-sip-${SIP_TEST_USER}"
    # tr always dies on SIGPIPE once head has its 32 bytes, so under pipefail
    # an inline `|| echo fallback` CONCATENATES onto the generated password.
    # Generate first, validate after.
    SIP_TEST_PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 32 || true)"
    if [ "${#SIP_TEST_PASS}" -ne 32 ]; then
      echo -e "  ${RED}FAIL${NC}  Could not generate a cryptographically secure SIP test password"
      exit 1
    fi

    CREATE_RESPONSE=$(curl -s -X POST \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"connection_name\": \"${SIP_CONNECTION_NAME}\",
        \"user_name\": \"${SIP_TEST_USER}\",
        \"password\": \"${SIP_TEST_PASS}\",
        \"active\": true,
        \"anchorsite_override\": \"Latency\"
      }" \
      "https://api.telnyx.com/v2/credential_connections" 2>/dev/null || echo "")

    if [ -z "$CREATE_RESPONSE" ]; then
      echo -e "  ${RED}FAIL${NC}  No response from API when creating connection"
      exit 1
    fi

    if [ "$HAS_JQ" = true ]; then
      CREATE_ERROR=$(echo "$CREATE_RESPONSE" | jq -r '.errors[0].detail // empty' 2>/dev/null)
      if [ -n "$CREATE_ERROR" ]; then
        echo -e "  ${RED}FAIL${NC}  Could not create credential connection: $CREATE_ERROR"
        exit 1
      fi
      CANDIDATE_CONNECTION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id // empty' 2>/dev/null)
    fi

    if [ -z "${CANDIDATE_CONNECTION_ID:-}" ] || ! echo "$CREATE_RESPONSE" | jq -e \
      --arg id "$CANDIDATE_CONNECTION_ID" --arg name "$SIP_CONNECTION_NAME" \
      'type == "object" and .data.id == $id and .data.record_type == "credential_connection" and .data.connection_name == $name and .data.active == true and ((.errors? // []) | length == 0)' \
      >/dev/null 2>&1; then
      echo -e "  ${RED}FAIL${NC}  Create response did not prove ownership of the uniquely named connection ${SIP_CONNECTION_NAME}; refusing cleanup or further mutation."
      exit 1
    fi

    CONNECTION_ID="$CANDIDATE_CONNECTION_ID"
    CONNECTION_NAME="$SIP_CONNECTION_NAME"
    CONNECTION_TYPE="credential"
    CONNECTION_CREATED=true
    CREATED_CONNECTION_ID="$CONNECTION_ID"
    echo -e "  ${GREEN}PASS${NC}  Created credential connection: ${CONNECTION_ID} (${CONNECTION_NAME})"
  fi
fi

# --- Step 3: Verify connection is active ---
echo ""
echo -e "${BOLD}Step 3: Verifying connection is active...${NC}"

# Determine connection type if not already known (when ID was provided via env var)
if [ -z "$CONNECTION_TYPE" ]; then
  # Try credential connection first
  VERIFY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${TELNYX_API_KEY}" \
    "https://api.telnyx.com/v2/credential_connections/${CONNECTION_ID}" 2>/dev/null || echo "000")
  if [ "$VERIFY_RESPONSE" = "200" ]; then
    CONNECTION_TYPE="credential"
  else
    VERIFY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      "https://api.telnyx.com/v2/ip_connections/${CONNECTION_ID}" 2>/dev/null || echo "000")
    if [ "$VERIFY_RESPONSE" = "200" ]; then
      CONNECTION_TYPE="ip"
    else
      echo -e "  ${RED}FAIL${NC}  Connection ${CONNECTION_ID} not found as credential or IP connection"
      exit 1
    fi
  fi
fi

# Fetch connection details
if [ "$CONNECTION_TYPE" = "credential" ]; then
  CONN_DETAIL_RESPONSE=$(curl -s -g \
    -H "Authorization: Bearer ${TELNYX_API_KEY}" \
    "https://api.telnyx.com/v2/credential_connections/${CONNECTION_ID}" 2>/dev/null || echo "")
elif [ "$CONNECTION_TYPE" = "ip" ]; then
  CONN_DETAIL_RESPONSE=$(curl -s -g \
    -H "Authorization: Bearer ${TELNYX_API_KEY}" \
    "https://api.telnyx.com/v2/ip_connections/${CONNECTION_ID}" 2>/dev/null || echo "")
fi

if [ -z "$CONN_DETAIL_RESPONSE" ]; then
  echo -e "  ${RED}FAIL${NC}  No response when fetching connection details"
  exit 1
fi

CONN_ACTIVE=""
EXPECTED_RECORD_TYPE="${CONNECTION_TYPE}_connection"
if [ "$HAS_JQ" = true ]; then
  if ! echo "$CONN_DETAIL_RESPONSE" | jq -e --arg id "$CONNECTION_ID" --arg rt "$EXPECTED_RECORD_TYPE" \
    'type == "object" and .data.id == $id and .data.record_type == $rt and .data.active == true and ((.errors? // []) | length == 0)' \
    >/dev/null 2>&1; then
    echo -e "  ${RED}FAIL${NC}  Connection detail was missing, inactive, unreadable, or did not match ${CONNECTION_ID}."
    exit 1
  fi
  CONN_ACTIVE=$(echo "$CONN_DETAIL_RESPONSE" | jq -r '.data.active // empty' 2>/dev/null)
  if [ -z "$CONNECTION_NAME" ]; then
    CONNECTION_NAME=$(echo "$CONN_DETAIL_RESPONSE" | jq -r '.data.connection_name // empty' 2>/dev/null)
  fi
  CONN_ERROR=$(echo "$CONN_DETAIL_RESPONSE" | jq -r '.errors[0].detail // empty' 2>/dev/null)
  if [ -n "$CONN_ERROR" ]; then
    echo -e "  ${RED}FAIL${NC}  Error fetching connection: $CONN_ERROR"
    exit 1
  fi
fi

if [ "$CONN_ACTIVE" = "true" ]; then
  echo -e "  ${GREEN}PASS${NC}  Connection is active"
else
  echo -e "  ${RED}FAIL${NC}  Connection active status: ${CONN_ACTIVE:-unknown}"
  echo -e "         Activate the connection in the Telnyx portal before testing SIP traffic."
  exit 1
fi

# --- Step 4: Outbound Voice Profile (consent-safe) ---
# Mutation policy (do not weaken):
#   * Connection created THIS RUN  -> create a dedicated OVP and attach it.
#     Both resources belong to this run, so configuring them is safe.
#   * Pre-existing connection WITH an OVP -> report and touch nothing.
#   * Pre-existing connection WITHOUT an OVP -> NEVER auto-attach. Attaching
#     an arbitrary account profile silently rewires a live trunk. Require an
#     explicit TELNYX_OVP_ID plus TELNYX_ALLOW_TRUNK_MODIFY=yes, otherwise
#     FAIL with remediation instructions.
echo ""
echo -e "${BOLD}Step 4: Outbound Voice Profile...${NC}"

OVP_ID=""
OVP_NAME=""
OVP_ATTACHED="unknown"

# jq is mandatory (the prerequisite gate exits without it), so no jq-less
# fallback is needed here.
{
  # Resolve the connection endpoint (credential vs ip). Step 3 normally
  # resolves CONNECTION_TYPE or exits; the probe below is defensive only.
  CONN_ENDPOINT=""
  case "$CONNECTION_TYPE" in
    credential) CONN_ENDPOINT="credential_connections" ;;
    ip)         CONN_ENDPOINT="ip_connections" ;;
    *)
      for ep in credential_connections ip_connections; do
        PROBE=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
          "https://api.telnyx.com/v2/${ep}/${CONNECTION_ID}" 2>/dev/null || echo "")
        if [ -n "$(echo "$PROBE" | jq -r '.data.id // empty' 2>/dev/null)" ]; then
          CONN_ENDPOINT="$ep"
          break
        fi
      done
      ;;
  esac

  if [ -z "$CONN_ENDPOINT" ]; then
    echo -e "  ${RED}FAIL${NC}  Could not determine connection type for ${CONNECTION_ID} (tried credential_connections and ip_connections)"
    exit 1
  fi

  CONN_DETAIL=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
    "https://api.telnyx.com/v2/${CONN_ENDPOINT}/${CONNECTION_ID}" 2>/dev/null || echo "")
  if ! echo "$CONN_DETAIL" | jq -e --arg id "$CONNECTION_ID" --arg rt "$EXPECTED_RECORD_TYPE" \
    'type == "object" and .data.id == $id and .data.record_type == $rt and .data.active == true and ((.errors? // []) | length == 0)' \
    >/dev/null 2>&1; then
    echo -e "  ${RED}FAIL${NC}  Could not read authoritative details for ${CONNECTION_ID}."
    exit 1
  fi
  CURRENT_OVP=$(echo "$CONN_DETAIL" | jq -r '.data.outbound.outbound_voice_profile_id // empty' 2>/dev/null)

  attach_profile() {
    # attach_profile <profile_id> — PATCH the connection and verify the echo
    local pid="$1"
    local resp err got verify
    resp=$(curl -s -X PATCH \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"outbound\": {\"outbound_voice_profile_id\": \"${pid}\"}}" \
      "https://api.telnyx.com/v2/${CONN_ENDPOINT}/${CONNECTION_ID}" 2>/dev/null || echo "")
    err=$(echo "$resp" | jq -r '.errors[0].detail // empty' 2>/dev/null)
    got=$(echo "$resp" | jq -r --arg id "$CONNECTION_ID" \
      'select(type == "object" and .data.id == $id and ((.errors? // []) | length == 0)) | .data.outbound.outbound_voice_profile_id // empty' 2>/dev/null)
    if [ -z "$err" ] && [ "$got" != "$pid" ]; then
      verify=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
        "https://api.telnyx.com/v2/${CONN_ENDPOINT}/${CONNECTION_ID}" 2>/dev/null || echo "")
      got=$(echo "$verify" | jq -r --arg id "$CONNECTION_ID" \
        'select(type == "object" and .data.id == $id and ((.errors? // []) | length == 0)) | .data.outbound.outbound_voice_profile_id // empty' 2>/dev/null)
    fi
    if [ -n "$err" ]; then
      echo -e "  ${RED}FAIL${NC}  Could not attach Outbound Voice Profile: $err"
      exit 1
    elif [ "$got" != "$pid" ]; then
      echo -e "  ${RED}FAIL${NC}  PATCH accepted but the connection does not report the profile (got: '${got:-none}')"
      exit 1
    fi
  }

  if [ -n "$CURRENT_OVP" ]; then
    CURRENT_OVP_RESPONSE=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      "https://api.telnyx.com/v2/outbound_voice_profiles/${CURRENT_OVP}" 2>/dev/null || echo "")
    if ! echo "$CURRENT_OVP_RESPONSE" | jq -e --arg id "$CURRENT_OVP" \
      'type == "object" and .data.id == $id and .data.enabled == true and ((.errors? // []) | length == 0)' >/dev/null 2>&1; then
      echo -e "  ${RED}FAIL${NC}  Attached Outbound Voice Profile ${CURRENT_OVP} is missing, disabled, or unreadable."
      exit 1
    fi
    OVP_ID="$CURRENT_OVP"
    OVP_ATTACHED="yes (pre-existing)"
    OVP_NAME=$(echo "$CURRENT_OVP_RESPONSE" | jq -r '.data.name // empty' 2>/dev/null)
    echo -e "  ${GREEN}PASS${NC}  Connection already has an Outbound Voice Profile attached: ${CURRENT_OVP}${OVP_NAME:+ (${OVP_NAME})}"

  elif [ "$CONNECTION_CREATED" = true ]; then
    # This run created the connection — create a dedicated profile for it.
    echo -e "  ${BLUE}INFO${NC}  New connection from this run — creating a dedicated Outbound Voice Profile..."
    SIP_OVP_NAME="migration-test-ovp-${SIP_TEST_USER}"
    OVP_CREATE_PAYLOAD=$(jq -cn --arg name "$SIP_OVP_NAME" '{name: $name, enabled: true}')
    OVP_CREATE_RESPONSE=$(curl -s -X POST \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$OVP_CREATE_PAYLOAD" \
      "https://api.telnyx.com/v2/outbound_voice_profiles" 2>/dev/null || echo "")
    OVP_CREATE_ERROR=$(echo "$OVP_CREATE_RESPONSE" | jq -r '.errors[0].detail // empty' 2>/dev/null)
    if [ -n "$OVP_CREATE_ERROR" ] || [ -z "$OVP_CREATE_RESPONSE" ]; then
      echo -e "  ${RED}FAIL${NC}  Could not create Outbound Voice Profile: ${OVP_CREATE_ERROR:-no response}"
      exit 1
    fi
    CANDIDATE_OVP_ID=$(echo "$OVP_CREATE_RESPONSE" | jq -r '.data.id // empty' 2>/dev/null)
    if [ -z "$CANDIDATE_OVP_ID" ] || ! echo "$OVP_CREATE_RESPONSE" | jq -e \
      --arg id "$CANDIDATE_OVP_ID" --arg name "$SIP_OVP_NAME" \
      'type == "object" and .data.id == $id and .data.record_type == "outbound_voice_profile" and .data.name == $name and .data.enabled == true and ((.errors? // []) | length == 0)' \
      >/dev/null 2>&1; then
      echo -e "  ${RED}FAIL${NC}  Create response did not prove ownership of OVP ${SIP_OVP_NAME}; refusing to attach or delete it."
      exit 1
    fi
    OVP_ID="$CANDIDATE_OVP_ID"
    OVP_NAME="$SIP_OVP_NAME"
    CREATED_OVP_ID="$OVP_ID"
    echo -e "  ${GREEN}PASS${NC}  Created Outbound Voice Profile: ${OVP_ID} (${OVP_NAME})"
    attach_profile "$OVP_ID"
    OVP_ATTACHED="yes (created and attached this run)"
    echo -e "  ${GREEN}PASS${NC}  Attached ${OVP_ID} to the connection this run created (${CONNECTION_ID})"

  elif [ -n "${TELNYX_OVP_ID:-}" ] \
    && [ -n "${TELNYX_SIP_CONNECTION_ID:-}" ] \
    && [ "$CONNECTION_ID" = "$TELNYX_SIP_CONNECTION_ID" ] \
    && [ "${TELNYX_APPROVE_TRUNK_MODIFY:-}" = "$CONNECTION_ID|$TELNYX_OVP_ID" ]; then
    # Target-bound opt-in: both resources and their exact relationship are
    # named before this script may PATCH an existing live connection.
    VERIFY_OVP=$(curl -s -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      "https://api.telnyx.com/v2/outbound_voice_profiles/${TELNYX_OVP_ID}" 2>/dev/null || echo "")
    if ! echo "$VERIFY_OVP" | jq -e --arg id "$TELNYX_OVP_ID" \
      'type == "object" and .data.id == $id and .data.enabled == true and ((.errors? // []) | length == 0)' >/dev/null 2>&1; then
      echo -e "  ${RED}FAIL${NC}  TELNYX_OVP_ID '${TELNYX_OVP_ID}' is missing, disabled, or unreadable."
      exit 1
    fi
    OVP_NAME=$(echo "$VERIFY_OVP" | jq -r '.data.name // empty' 2>/dev/null)
    if [ -z "$OVP_NAME" ]; then
      echo -e "  ${RED}FAIL${NC}  TELNYX_OVP_ID '${TELNYX_OVP_ID}' does not resolve to an Outbound Voice Profile on this account"
      exit 1
    fi
    echo -e "  ${YELLOW}WARN${NC}  Target-bound opt-in received: attaching YOUR chosen profile ${TELNYX_OVP_ID} (${OVP_NAME})"
    echo -e "         to EXISTING connection ${CONNECTION_ID}. This modifies a live trunk."
    attach_profile "$TELNYX_OVP_ID"
    OVP_ID="$TELNYX_OVP_ID"
    OVP_ATTACHED="yes (explicit opt-in attach)"
    echo -e "  ${GREEN}PASS${NC}  Attached ${TELNYX_OVP_ID} to ${CONNECTION_ID}"

  else
    echo -e "  ${RED}FAIL${NC}  Existing connection ${CONNECTION_ID} has no Outbound Voice Profile attached."
    echo ""
    echo "  This test will NOT modify an existing connection on its own."
    echo "  Outbound calls from this connection will fail until a profile is attached."
    echo ""
    echo "  To fix, either:"
    echo "    a) Attach a profile yourself in the portal: SIP > Connections >"
    echo "       ${CONNECTION_ID} > Outbound > Outbound Voice Profile, then re-run; or"
    echo "    b) Re-run with an approval naming both exact resources:"
    echo "         TELNYX_SIP_CONNECTION_ID=${CONNECTION_ID} TELNYX_OVP_ID=<profile-uuid> \\"
    echo "         TELNYX_APPROVE_TRUNK_MODIFY='${CONNECTION_ID}|<profile-uuid>' bash test-sip.sh --confirm"
    exit 1
  fi
}

TEMP_RESOURCES_REMOVED=false
if [ "$CONNECTION_CREATED" = true ]; then
  echo ""
  echo -e "${BOLD}Cleaning up temporary SIP resources...${NC}"
  cleanup_status=0
  cleanup_sip_resources || cleanup_status=$?
  trap - EXIT INT TERM
  if [ "$cleanup_status" -ne 0 ]; then
    echo -e "  ${RED}FAIL${NC}  Manual cleanup required: ${SIP_CLEANUP_LEAKS}"
    exit 1
  fi
  TEMP_RESOURCES_REMOVED=true
fi
trap - EXIT INT TERM

# --- Step 5: Report results ---
echo ""
echo "========================"
echo -e "${BOLD}Results${NC}"
echo "  Connection Type: ${CONNECTION_TYPE}"
echo "  Connection ID:   ${CONNECTION_ID}"
echo "  Connection Name: ${CONNECTION_NAME:-N/A}"
echo "  Active:          ${CONN_ACTIVE:-unknown}"
echo "  OVP ID:          ${OVP_ID:-N/A}"
echo "  OVP Name:        ${OVP_NAME:-N/A}"
echo "  OVP Attached:    ${OVP_ATTACHED:-unknown}"
echo "  Temporary Setup: $([ "$TEMP_RESOURCES_REMOVED" = true ] && echo "validated and removed" || echo "not created")"
echo ""
if [ "$TEMP_RESOURCES_REMOVED" = true ]; then
  echo -e "  ${GREEN}${BOLD}PASS${NC}  SIP connection creation and OVP attachment validated; temporary resources removed"
else
  echo -e "  ${GREEN}${BOLD}PASS${NC}  Existing SIP connection is active and has an Outbound Voice Profile attached"
fi
echo ""
echo "  Note: This test validates connection structure only; it does not validate"
echo "  profile destination policy, registration, authentication, or SIP media."
echo "  Actual traffic requires a PBX or SIP client pointed at sip.telnyx.com."
exit 0
