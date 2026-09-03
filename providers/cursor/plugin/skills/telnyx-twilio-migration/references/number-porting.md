# Number Porting: Move Numbers from Twilio to Telnyx

Programmatic guide for porting phone numbers from Twilio (or any carrier) to Telnyx, including FastPort for same-day activation.

## Table of Contents

- [Overview](#overview)
- [Before You Start](#before-you-start)
- [Step 1: Check Portability](#step-1-check-portability)
- [Step 2: Create a Porting Order](#step-2-create-a-porting-order)
- [Step 3: Fulfill Requirements](#step-3-fulfill-requirements)
- [Step 4: Submit the Order](#step-4-submit-the-order)
- [Step 5: Monitor and Activate](#step-5-monitor-and-activate)
- [FastPort: Same-Day Activation](#fastport-same-day-activation)
- [Bulk Porting](#bulk-porting)
- [Troubleshooting](#troubleshooting)

## Overview

Telnyx supports programmatic number porting via REST API. The flow:

1. **Portability check** — verify numbers can be ported and check FastPort eligibility
2. **Create porting order** — submit the list of numbers
3. **Fulfill requirements** — upload LOA, provide account holder info
4. **Submit** — initiate the port with the losing carrier
5. **Activate** — numbers go live on Telnyx (automatic or on-demand with FastPort)

No port-in fees for US and Canadian numbers.

## Before You Start

Gather this information from your Twilio account:

- **Account holder name** — the name on your Twilio account (must match exactly)
- **Service address** — the address associated with the numbers in Twilio
- **Account number or SID** — your Twilio Account SID
- **Recent invoice** — download from Twilio Console → Billing
- **PIN/password** — if you set a porting PIN in Twilio (Settings → General → Porting)
- **List of numbers** — in E.164 format (+1XXXXXXXXXX)

You will also need a **Letter of Authorization (LOA)** — Telnyx provides a template during the porting process.

## Step 1: Check Portability

```bash
curl -X POST https://api.telnyx.com/v2/portability_checks \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+15551234567", "+15559876543"]
  }'
```

Response includes per-number results:

```json
{
  "data": [
    {
      "record_type": "portability_check_result",
      "phone_number": "+15551234567",
      "portable": true,
      "fast_portable": true,
      "not_portable_reason": null
    },
    {
      "record_type": "portability_check_result",
      "phone_number": "+15559876543",
      "portable": true,
      "fast_portable": false,
      "not_portable_reason": null
    }
  ]
}
```

Key fields:
- `portable` — whether the number can be ported to Telnyx
- `fast_portable` — whether FastPort (same-day activation) is available
- `not_portable_reason` — reason the number cannot be ported (null when `portable` is true)
- `record_type` — the record type identifier

## Step 2: Create a Porting Order

```bash
curl -X POST https://api.telnyx.com/v2/porting_orders \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": [
      "+15551234567",
      "+15559876543"
    ]
  }'
```

The API may **auto-split** the order into multiple sub-orders based on:
- Country boundaries
- Number type (local, toll-free, mobile)
- Carrier/SPID variations
- FastPort eligibility

Each sub-order must be managed independently. Check the response for multiple order IDs.

## Step 3: Fulfill Requirements

Upload supporting documents and provide account holder information.

### Upload Documents

```bash
# Upload LOA
curl -X POST https://api.telnyx.com/v2/documents \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -F "file=@/path/to/loa.pdf"

# Response: {"data": {"id": "doc_uuid_1"}}

# Upload recent invoice
curl -X POST https://api.telnyx.com/v2/documents \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -F "file=@/path/to/invoice.pdf"

# Response: {"data": {"id": "doc_uuid_2"}}
```

### Update the Porting Order

```bash
curl -X PATCH "https://api.telnyx.com/v2/porting_orders/$ORDER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "end_user": {
      "admin": {
        "account_number": "YOUR_TWILIO_SID",
        "auth_person_name": "Jane Smith",
        "billing_phone_number": "+15551234567"
      },
      "location": {
        "street_address": "123 Main St",
        "locality": "Chicago",
        "administrative_area": "IL",
        "postal_code": "60601",
        "country_code": "US"
      }
    },
    "documents": {
      "loa": "doc_uuid_1",
      "invoice": "doc_uuid_2"
    },
    "activation_settings": {
      "activation_type": "on-demand"
    }
  }'
```

Set `activation_type` to `"on-demand"` for FastPort (choose when numbers go live) or omit for automatic activation on the FOC date.

## Step 4: Submit the Order

```bash
[[ "${ORDER_ID:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || {
  echo "ORDER_ID must be a nonempty UUID" >&2; exit 1;
}
ORDER_RESPONSE=$(curl -fsS -G \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "include_phone_numbers=true" \
  "https://api.telnyx.com/v2/porting_orders/$ORDER_ID") || exit 1
ORDER_SNAPSHOT=$(printf '%s' "$ORDER_RESPONSE" | jq -ceS --arg id "$ORDER_ID" '
  .data as $order
  | select(
      $order.id == $id and
      $order.status.value == "draft" and
      $order.requirements_met == true and
      (($order.additional_steps // []) | length) == 0 and
      ($order.updated_at | type) == "string" and
      ($order.activation_settings | type) == "object" and
      ($order.phone_number_configuration | type) == "object" and
      ($order.messaging | type) == "object"
    )
  | ($order.porting_phone_numbers_count // -1) as $count
  | [
      $order.phone_numbers[]?.phone_number
      | select(type == "string" and test("^[+]?[1-9][0-9]{7,14}$"))
    ] as $numbers
  | select(
      $count > 0 and $count <= 50 and
      ($numbers | length) == $count and
      ($numbers | unique | length) == $count
    )
  | ($order.phone_number_configuration.tags // []) as $tags
  | select(
      ($tags | type) == "array" and
      all($tags[]; type == "string")
    )
  | {
      id: $order.id,
      updated_at: $order.updated_at,
      status: $order.status,
      requirements_met: $order.requirements_met,
      additional_steps: ($order.additional_steps // []),
      phone_number_type: $order.phone_number_type,
      porting_phone_numbers_count: $count,
      phone_numbers: ($numbers | sort),
      activation_settings: $order.activation_settings,
      misc: $order.misc,
      phone_number_configuration: (
        $order.phone_number_configuration + {tags: ($tags | sort)}
      ),
      messaging: $order.messaging
    }
') || {
  echo "Order must be a ready draft with complete numbers and routing/messaging configuration" >&2
  exit 1
}
ORDER_SNAPSHOT_B64=$(printf '%s' "$ORDER_SNAPSHOT" | jq -Rr '@base64') || exit 1
APPROVAL_TOKEN="$ORDER_ID|confirm|$ORDER_SNAPSHOT_B64"
printf 'Port submission snapshot:\n'
printf '%s\n' "$ORDER_SNAPSHOT" | jq .
printf 'Approval token: %s\n' "$APPROVAL_TOKEN"
# After reviewing the complete displayed order, number, activation, routing, and
# messaging snapshot, set this variable to the displayed approval token.
test "${TELNYX_APPROVE_PORT_CONFIRM:-}" = "$APPROVAL_TOKEN" || {
  echo "Port submission not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.telnyx.com/v2/porting_orders/$ORDER_ID/actions/confirm" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

The order transitions from draft to in-process. Telnyx begins coordination with the losing carrier (Twilio's underlying carrier).

## Step 5: Monitor and Activate

### Poll for Status

```bash
curl "https://api.telnyx.com/v2/porting_orders/$ORDER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Order Status Flow

```
draft → in-process → foc-date-confirmed → ported (or) exception
```

| Status | Meaning |
|---|---|
| `draft` | Order created, requirements not yet fulfilled |
| `in-process` | Submitted, awaiting carrier response |
| `foc-date-confirmed` | Firm Order Commitment date set — numbers will port on this date |
| `ported` | Numbers are live on Telnyx |
| `exception` | Issue with the order — check comments for details |

### Webhooks

Configure webhook URL in the portal to receive:
- `porting_order.status_changed` — order status transitions
- `porting_order.new_comment` — messages from Telnyx Porting Operations

### Add Comments (if needed)

```bash
curl -X POST "https://api.telnyx.com/v2/porting_orders/$ORDER_ID/comments" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body": "Updated LOA with corrected address."}'
```

## FastPort: Same-Day Activation

FastPort is available for eligible US and Canadian numbers. It provides two key advantages:

### 1. Real-Time LOA Validation

Standard porting: submit LOA, wait days for carrier to accept or reject, resubmit if rejected.

FastPort: validates your LOA information **in real-time** against the losing carrier's records. Errors are caught immediately before submission, eliminating round-trip delays.

### 2. On-Demand Activation

Standard porting: numbers activate automatically whenever the losing carrier processes the FOC date. You have no control over the exact moment.

FastPort: once the FOC date is confirmed, you choose exactly when numbers go live:

**Activation Windows:**

| Country | Window | Hours (Central Time) |
|---|---|---|
| US | 14 hours | 6:00 AM – 8:00 PM |
| Canada | 7 hours | 8:00 AM – 3:00 PM |

### Trigger On-Demand Activation

Once the order reaches `foc-date-confirmed`, inspect the activation jobs to see the available window:

```bash
# Check activation window
curl "https://api.telnyx.com/v2/porting_orders/$ORDER_ID/activation_jobs" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**US FastPort only:** the `/actions/activate` endpoint is limited to US FastPort orders. For an eligible US order you can activate every number in the order on demand:

```bash
# Activate now (US FastPort orders only)
[[ "${ORDER_ID:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || {
  echo "ORDER_ID must be a nonempty UUID" >&2; exit 1;
}
ORDER_RESPONSE=$(curl -fsS -G \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "include_phone_numbers=true" \
  "https://api.telnyx.com/v2/porting_orders/$ORDER_ID") || exit 1
ORDER_SNAPSHOT=$(printf '%s' "$ORDER_RESPONSE" | jq -ceS --arg id "$ORDER_ID" '
  .data as $order
  | select(
      $order.id == $id and
      $order.status.value == "foc-date-confirmed" and
      $order.activation_settings.fast_port_eligible == true and
      ($order.updated_at | type) == "string" and
      ($order.phone_number_configuration | type) == "object" and
      ($order.messaging | type) == "object"
    )
  | ($order.porting_phone_numbers_count // -1) as $count
  | [
      $order.phone_numbers[]?.phone_number
      | select(type == "string" and test("^[+]?[1-9][0-9]{7,14}$"))
    ] as $numbers
  | select(
      $count > 0 and $count <= 50 and
      ($numbers | length) == $count and
      ($numbers | unique | length) == $count
    )
  | ($order.phone_number_configuration.tags // []) as $tags
  | select(
      ($tags | type) == "array" and
      all($tags[]; type == "string")
    )
  | {
      id: $order.id,
      updated_at: $order.updated_at,
      status: $order.status,
      requirements_met: $order.requirements_met,
      additional_steps: ($order.additional_steps // []),
      phone_number_type: $order.phone_number_type,
      porting_phone_numbers_count: $count,
      phone_numbers: ($numbers | sort),
      activation_settings: $order.activation_settings,
      misc: $order.misc,
      phone_number_configuration: (
        $order.phone_number_configuration + {tags: ($tags | sort)}
      ),
      messaging: $order.messaging
    }
') || {
  echo "Order must be an eligible US FastPort order with complete numbers and routing/messaging configuration" >&2
  exit 1
}
ACTIVATION_RESPONSE=$(curl -fsS -G \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode "page[size]=250" \
  --data-urlencode "page[number]=1" \
  "https://api.telnyx.com/v2/porting_orders/$ORDER_ID/activation_jobs") || exit 1
ACTIVATION_SNAPSHOT=$(printf '%s' "$ACTIVATION_RESPONSE" | jq -ceS \
  --argjson order "$ORDER_SNAPSHOT" '
  def parse_utc_timestamp:
    if type != "string" then
      error("activation window timestamp must be a string")
    else
      sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601
    end;

  (.data // []) as $jobs
  | (.meta // {}) as $meta
  | select(
      ($jobs | type) == "array" and ($jobs | length) > 0 and
      $meta.page_number == 1 and
      $meta.page_size == 250 and
      $meta.total_pages == 1 and
      $meta.total_results == ($jobs | length) and
      all($jobs[];
        (.id | type) == "string" and
        (.id | test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
        (.status == "created" or .status == "in-process" or .status == "completed" or .status == "failed") and
        (.activation_type == "scheduled" or .activation_type == "on-demand") and
        ((.activate_at | type) == "string" or .activate_at == null) and
        (.activation_windows | type) == "array" and
        all(.activation_windows[];
          (.start_at | type) == "string" and (.end_at | type) == "string"
        )
      ) and
      any($jobs[]; (.activation_windows | length) > 0)
    )
  | [
      $jobs[]
      | {
        id,
        status,
        activation_type,
        activate_at,
        activation_windows: (.activation_windows | sort_by([.start_at, .end_at]))
      }
    ] as $normalized_jobs
  | now as $now
  | [
      $normalized_jobs[]
      | select(.status == "created" and .activation_type == "on-demand")
      | . as $job
      | [
          $job.activation_windows[]
          | . as $window
          | ($window.start_at | parse_utc_timestamp) as $start_at
          | ($window.end_at | parse_utc_timestamp) as $end_at
          | select($start_at <= $now and $now <= $end_at)
          | $window
        ] as $current_windows
      | select(($current_windows | length) == 1)
      | {
          job_id: $job.id,
          current_window: $current_windows[0]
        }
    ] as $actionable_jobs
  | select(($actionable_jobs | length) == 1)
  | {
      order: $order,
      activation_jobs: ($normalized_jobs | sort_by(.id)),
      actionable_job: $actionable_jobs[0]
    }
') || {
  echo "Expected exactly one created on-demand job inside one current activation window" >&2
  exit 1
}
ACTIVATION_SNAPSHOT_B64=$(printf '%s' "$ACTIVATION_SNAPSHOT" | jq -Rr '@base64') || exit 1
APPROVAL_TOKEN="$ORDER_ID|activate|$ACTIVATION_SNAPSHOT_B64"
printf 'Port activation snapshot:\n'
printf '%s\n' "$ACTIVATION_SNAPSHOT" | jq .
printf 'Approval token: %s\n' "$APPROVAL_TOKEN"
# After reviewing the complete order/routing snapshot, all activation jobs, and
# the single current on-demand window, set this variable to the displayed token.
test "${TELNYX_APPROVE_PORT_ACTIVATE:-}" = "$APPROVAL_TOKEN" || {
  echo "Port activation not approved" >&2; exit 1;
}
curl -fsS -X POST "https://api.telnyx.com/v2/porting_orders/$ORDER_ID/actions/activate" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

If you do not manually activate within the window, numbers auto-activate at the end of the window (fail-safe).

The inline review gates above deliberately reject orders with more than 50 numbers because the order endpoint includes only the first 50 number objects. For a larger order, enumerate and validate every page of `/v2/porting_phone_numbers?filter[porting_order_id]=...` before confirming or activating; never approve a truncated set.

**Canada:** on-demand activation is not driven through the `/actions/activate` endpoint (that action is US-FastPort-only). Canadian numbers activate within their FOC/activation window rather than via an explicit activate API call. Poll the order status and the `activation_jobs` endpoint to track progress.

## Bulk Porting

For large number migrations, submit multiple numbers in a single porting order. The API auto-splits by carrier and type.

Tips for bulk ports from Twilio:
- Export your number list from Twilio Console → Phone Numbers → Active Numbers
- Format all numbers in E.164 (+1XXXXXXXXXX)
- Group by type if possible (local vs toll-free) to simplify document requirements
- Toll-free numbers may require separate LOA forms

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Order stuck in `exception` | LOA info doesn't match carrier records | Check comments, update LOA with exact name/address from Twilio account |
| `fast_portable: false` | Losing carrier doesn't support real-time validation | Use standard porting (still works, just slower) |
| Split into many sub-orders | Numbers on different underlying carriers | Normal behavior — manage each sub-order independently |
| Rejected by losing carrier | Account holder mismatch or missing PIN | Verify exact account name, check if Twilio has a porting PIN set |
| Numbers not receiving calls after port | Not assigned to a connection | Assign numbers to a SIP Connection or TeXML Application in Mission Control |
| SMS not working after port | Not assigned to a Messaging Profile | Assign numbers to a Messaging Profile in Mission Control |
