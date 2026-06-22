# @telnyx/agent-cli

Agent-friendly CLI for Telnyx API v2 — composite setup commands that reduce multi-step portal workflows to a single command.

## Quick Start

```bash
# Set your API key
export TELNYX_API_KEY="KEY_xxx"

# Check account status
npx tsx bin/telnyx-agent.ts status

# See all capabilities
npx tsx bin/telnyx-agent.ts capabilities
```

## Commands

### `telnyx-agent status`

Account health at a glance — balance, phone numbers, messaging profiles, voice connections, AI assistants.

```bash
telnyx-agent status          # Human-readable
telnyx-agent status --json   # Machine-readable
```

### `telnyx-agent capabilities`

Self-describing API surface — lists all available tools, composite commands, and the workload-oriented AI catalog.

```bash
telnyx-agent capabilities
telnyx-agent capabilities --json
```

The JSON output includes `ai_catalog`, which points back to the canonical repo-owned discovery surface at `https://telnyx.com/ai/catalog.json` and groups current Telnyx AI options by workload instead of a flat product list.

### `telnyx-agent setup-sms`

**One command: zero to sending SMS.**

Creates a messaging profile, searches for a number with SMS capability, buys it, and assigns it to the profile.

```bash
telnyx-agent setup-sms                    # Default: US number
telnyx-agent setup-sms --country GB       # UK number
telnyx-agent setup-sms --json             # JSON output
```

Output: `{ profile_id, phone_number, ready: true }`

### `telnyx-agent setup-voice`

**One command: zero to making/receiving calls.**

Creates a SIP credential connection, searches for a voice-capable number, buys it, and assigns it to the connection.

```bash
telnyx-agent setup-voice
telnyx-agent setup-voice --webhook https://example.com/calls
telnyx-agent setup-voice --country US --json
```

Output: `{ connection_id, phone_number, sip_username, sip_password }`

### `telnyx-agent setup-iot`

**One command: zero to connected SIM.**

Lists existing SIM cards, creates a SIM card group, activates the first available SIM, and assigns it to the group.

```bash
telnyx-agent setup-iot
telnyx-agent setup-iot --json
```

Output: `{ sim_id, group_id, status, apn_config }`

### `telnyx-agent setup-ai`

**One command: zero to AI assistant on a phone number.**

Creates an AI assistant, buys a voice-capable number, and wires them together.

```bash
telnyx-agent setup-ai
telnyx-agent setup-ai --preset appointment-reminders
telnyx-agent setup-ai --preset support-handoff --name "Tier 1 Support"
telnyx-agent setup-ai --preset lead-recovery
telnyx-agent setup-ai --instructions "You are a pizza ordering bot"
telnyx-agent setup-ai --name "Support Bot" --json
```

Starter presets:

- `appointment-reminders`: appointment scheduling and reminder capture
- `support-handoff`: FAQ deflection with clean human escalation
- `lead-recovery`: lead qualification and missed-call recovery

If you pass both `--preset` and `--instructions`, the custom instructions win and the preset only provides the default assistant name and metadata.

Output: `{ assistant_id, phone_number, test_command, preset_id, instructions_source }`

This command is intentionally bootstrap-first rather than model-marketing-first. It should pick a working assistant setup for the current account instead of assuming one specific hosted model is available everywhere.

After a successful run, `setup-ai` also emits a cost-governance preflight. Use that packet to set a daily or monthly spend envelope, retain the assistant and call correlation IDs needed for attribution, and place alerts around long calls, retry loops, and budget consumption before routing real traffic to the assistant.

This is guidance, not a billing-system mutation. For account-level billing controls and read-first cost operations, use the `Usage & Cost Explorer` MCP App (`tools/mcp-apps/apps/usage-cost-explorer`) or your existing finance and observability stack.

If you want the current Telnyx-hosted OpenAI assistant example path, use [`/guides/ai-assistants.md`](/guides/ai-assistants.md) and [`/guides/voice-agent-onboarding.md`](/guides/voice-agent-onboarding.md). Those assistant docs currently use `openai/gpt-5.4` in the first-run hosted examples; verify the live assistant catalog before scripting around that exact model ID.

### Edge Compute handoff commands

These are **thin executable bridges**, not native Edge lifecycle support.
They make Edge Compute usable from `telnyx-agent` while keeping real deploy/auth/secrets/bindings/revisions ownership in `telnyx-edge`. They only suggest API-key auth when the installed Edge CLI actually exposes it; the current public upstream release is `v0.2.0`, and the docs still lead with `telnyx-edge auth login`.

```bash
telnyx-agent edge-doctor --json
telnyx-agent setup-edge-mcp --name my-mcp-server --json
telnyx-agent setup-edge-webhook --name my-webhook --json
```

What they do:
- validate that `telnyx-edge` is available
- check whether Edge auth is already configured
- use `telnyx-edge auth login` as the safe default when capability detection is unavailable
- prefer `telnyx-edge auth api-key set <your-api-key>` for agents only when the installed CLI supports it
- point you at a real Edge example or the upstream `new-func --language=js|ts|python|go|quarkus` scaffold paths
- surface readiness and discovery commands such as `telnyx-edge status`, zero-arg `telnyx-edge bindings create`, `telnyx-edge bindings get`, and `telnyx-edge revisions list`
- give you the concrete next deploy command
- preserve an honest handoff instead of pretending `telnyx-agent` owns Edge lifecycle

The binding handoff follows the current upstream behavior: `telnyx-edge bindings create` takes no API-key argument and lets the Edge CLI mint the temporary token/material it needs.

### `telnyx-agent fund-account`

**Fund your Telnyx account with USDC on Base via x402 protocol.**

Requests a payment quote, signs EIP-712 typed data (transferWithAuthorization / EIP-3009), and submits the payment. Without a wallet key, outputs payment requirements for external signing.

```bash
telnyx-agent fund-account --amount 50.00                      # Get quote + payment requirements
telnyx-agent fund-account --amount 50.00 --wallet-key 0x...   # Sign and submit automatically
telnyx-agent fund-account --amount 50.00 --json              # JSON output
```

**Flags:**
| Flag | Description |
|------|-------------|
| `--amount <usd>` | Amount to fund in USD (required) |
| `--wallet-key <0x>` | Private key for EIP-712 signing (optional) |

**Output (with --wallet-key):**
```json
{
  "previous_balance": "-1.59",
  "funded_amount": "50.00",
  "quote_id": "quote_abc123",
  "transaction_id": "txn_xxx",
  "status": "settled",
  "new_balance": "48.41",
  "tx_hash": "0x..."
}
```

**Output (without --wallet-key):**
Returns `payment_requirements` JSON for external signing by agents or wallets.

## Authentication

The CLI looks for an API key in this order:

1. `TELNYX_API_KEY` environment variable
2. `~/.config/telnyx/config.json` (same as `@telnyx/api-cli`)

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output structured JSON instead of human-readable text |
| `--country <code>` | ISO country code for number search (default: US) |

## Architecture

- **Hybrid execution** — wraps `telnyx-cli` where available, falls back to native `fetch()` for operations without CLI support
- **No CLI framework** — simple `process.argv` parsing for 13 commands
- **TypeScript + tsx** — direct execution, no build step
- **Error handling** — composite commands report what succeeded and what failed

## Development

```bash
cd cli
npm install

# Run directly
npx tsx bin/telnyx-agent.ts status

# Run tests
npm test

# Type check
npm run typecheck
```

## Testing

Integration tests cover read-only commands (`status`, `capabilities`) against the real API. Setup commands are tested for argument parsing but don't make real purchases.

```bash
TELNYX_API_KEY="KEY_xxx" npm test
```
