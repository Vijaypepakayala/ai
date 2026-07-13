# Edge Compute

Use Telnyx Edge Compute when an AI workflow needs a low-latency HTTP/MCP boundary, webhook ingestion, durable coordination, or a small deterministic transform close to the runtime.

## Ownership and bridge

`team-telnyx/ai` provides orchestration guidance and thin handoff commands. It does **not** reimplement the Edge lifecycle.

- [`team-telnyx/edge-compute`](https://github.com/team-telnyx/edge-compute) owns examples and runtime documentation.
- `telnyx-edge` owns authentication, scaffolding, deployment, storage, secrets, bindings, revisions, and rollback.
- This repo's `edge-doctor`, `setup-edge-mcp`, and `setup-edge-webhook` commands detect the installed CLI surface and point to those tools.
- HTTP or MCP is the stable boundary back to the AI workflow.

## Prerequisites

- A Telnyx account and API key
- The dedicated `telnyx-edge` CLI
- Git for cloning the canonical examples
- A separate inbound shared secret for any protected HTTP or MCP endpoint

## Quick Start

Run the bridge check first:

```bash
telnyx-agent edge-doctor --json
```

The doctor probes command help rather than assuming that a version string guarantees a feature.

Use the current handoff helpers for the canonical examples:

```bash
telnyx-agent setup-edge-mcp --name my-mcp-server --json
telnyx-agent setup-edge-webhook --name my-webhook --json
```

Their JSON includes ordered `setup_commands`; review them, substitute credential values locally, and run them with `telnyx-edge`.

## Install and authenticate

Install `telnyx-edge` from the [Edge Compute releases](https://github.com/team-telnyx/edge-compute/releases), then authenticate:

```bash
# Preferred for non-interactive agent environments when supported
telnyx-edge auth api-key set <your-api-key>
telnyx-edge auth status
```

OAuth remains available with `telnyx-edge auth login`. Never commit API keys or print secret values into logs.

## API Reference

### Released v0.2.3 baseline

The released v0.2.3 command surface used by this bridge includes:

| Capability | Example |
|---|---|
| Failed-function recovery | `telnyx-edge reset-func broken-func` |
| KV namespace and key operations | `telnyx-edge storage kv ...` and `telnyx-edge storage kv key ...` |
| TOML bindings and TypeScript declarations | declare bindings, then run `telnyx-edge types` |
| Immutable deploy history | `telnyx-edge revisions list my-func` |
| Traffic rollback | `telnyx-edge rollback my-func <revision-id>` |
| Stateful Actor scaffolding/management | `new-func --actor` and `actors` |
| Secrets and Telnyx bindings | `secrets` and `bindings` |
| Function inspection | `telnyx-edge inspect <function-name>` |

#### Reset, revisions, and rollback

```bash
# Reset a function that is in a failed state, then ship the repaired source
telnyx-edge reset-func broken-func
telnyx-edge ship --from-dir=broken-func

# Review immutable deploy history and retarget traffic to a healthy revision
telnyx-edge revisions list my-func
telnyx-edge rollback my-func <revision-id>
```

#### KV and generated binding types

KV supports namespace `create`, `list`, `get`, and `delete`, plus key `list`, `get`, `put`, and `delete` operations. Key writes can also use `--path` and `--ttl`.

```bash
telnyx-edge storage kv create --name session-state
telnyx-edge storage kv list

telnyx-edge storage kv key put <namespace-id> sessions/demo '{"status":"active"}' --ttl 1h
telnyx-edge storage kv key get <namespace-id> sessions/demo
telnyx-edge storage kv key list <namespace-id> --prefix sessions/ --limit 100
# Continue a paginated listing with the returned cursor:
telnyx-edge storage kv key list <namespace-id> --cursor <cursor> --limit 100
```

Bind the namespace in `telnyx.toml` or `func.toml`, then generate TypeScript declarations:

```toml
[storage.kv.SESSIONS]
id = "<namespace-id>"
```

```bash
telnyx-edge types
```

`types` generates the environment declarations for supported TOML bindings, including KV, Telnyx, secrets, and actors.

#### Stateful Actors

Actors are useful for per-entity coordination such as sessions, carts, call legs, and workflow state. Probe `new-func --help` for `--actor`; do not infer actor availability from a hard-coded minimum version.

```bash
telnyx-edge new-func --actor --language ts --name session-actor
cd session-actor
telnyx-edge types
telnyx-edge ship

# Account-scoped actor type views
telnyx-edge actors list
```

### Feature-detected newer surface

Cloud Storage TOML/type support is **not** a v0.2.3 baseline capability. It is a current-main/upcoming v0.2.4 surface for the release line targeted by this guide and must be gated by the installed CLI. The published v0.2.3 binary already exposes `inspect`, even though `RELEASE_NOTES.md` groups that command under v0.2.4.

```bash
telnyx-edge inspect --help
telnyx-agent edge-doctor --json
```

`edge-doctor --json` reports `inspect_supported` from command help. Because early Cloud Storage builds do not consistently mention the binding in `types --help`, the doctor runs `types --from-dir` against an isolated temporary manifest and checks the generated declaration. It never modifies the current project. Only suggest or invoke Cloud Storage when `cloud_storage_supported` is true.

## MCP server on Edge

The source example lives in `docs/examples/ts/mcp-server` in `team-telnyx/edge-compute`. Clone the repository before using `--from-dir`:

```bash
git clone https://github.com/team-telnyx/edge-compute.git
cd edge-compute

telnyx-edge new-func \
  --from-dir=docs/examples/ts/mcp-server \
  --name=my-mcp-server
cd my-mcp-server
npm install
npm run build
```

Before deployment, configure both prerequisites as Edge secrets:

- `TELNYX_API_KEY`: used only for upstream Telnyx API calls.
- `SHARED_SECRET`: a separate random bearer secret used to authenticate inbound MCP requests. Do not reuse the Telnyx API key.

```bash
# Placeholders only: do not paste secret values into source, chat, or logs.
telnyx-edge secrets add TELNYX_API_KEY <telnyx-api-key>
telnyx-edge secrets add SHARED_SECRET <independent-random-secret>
telnyx-edge ship
```

Clients authenticate to the MCP endpoint with an `Authorization: Bearer` header containing the independently generated inbound token, never with `TELNYX_API_KEY`.

## Webhook receiver on Edge

The JavaScript example lives in `docs/examples/js/webhook-receiver`:

```bash
git clone https://github.com/team-telnyx/edge-compute.git
cd edge-compute

telnyx-edge new-func \
  --from-dir=docs/examples/js/webhook-receiver \
  --name=my-webhook
cd my-webhook

# Set an HMAC secret without committing or logging its value.
telnyx-edge secrets add WEBHOOK_SECRET <webhook-signing-secret>
telnyx-edge ship
```

`WEBHOOK_SECRET` enables HMAC verification. The example's recent-webhook buffer is process memory only; it is not durable across restarts. Use KV for durable key/value persistence or a Stateful Actor for serialized per-entity state.

## Calling a protected Edge endpoint

Protect your own AI-to-Edge endpoint with an independent `EDGE_SHARED_SECRET`. It is an inbound application credential and must not be the Telnyx API key used for upstream API calls.

```python
import os
import requests

response = requests.post(
    "https://<your-edge-endpoint>",
    headers={
        "content-type": "application/json",
        "authorization": f"Bearer {os.environ['EDGE_SHARED_SECRET']}",
    },
    json={"task": "redact_pii", "payload": {"text": "Call me at +1 555 123 4567"}},
    timeout=15,
)
response.raise_for_status()
print(response.json())
```

```typescript
const response = await fetch("https://<your-edge-endpoint>", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.EDGE_SHARED_SECRET}`,
  },
  body: JSON.stringify({
    task: "redact_pii",
    payload: { text: "Call me at +1 555 123 4567" },
  }),
});

if (!response.ok) throw new Error(`Edge request failed: ${response.status}`);
console.log(await response.json());
```

```bash
curl -X POST "https://<your-edge-endpoint>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${EDGE_SHARED_SECRET}" \
  -d '{
    "task": "redact_pii",
    "payload": {"text": "Call me at +1 555 123 4567"}
  }'
```

## Operational source of truth

Use `team-telnyx/ai` for agent workflows and integration patterns. Use `team-telnyx/edge-compute` and the installed `telnyx-edge --help` for deployment/runtime behavior. When the installed help and this bridge differ, the detected CLI surface wins.
