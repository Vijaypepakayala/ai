# Edge Compute

Use Telnyx Edge Compute when your AI workflow needs low-latency code execution, webhook handling, or an MCP/webhook endpoint that runs on Telnyx edge infrastructure.

## Important scope boundary

`team-telnyx/ai` does **not** manage Edge Compute lifecycle directly.

This repo helps you discover where Edge Compute fits into an AI workflow, but the actual function lifecycle is owned by:

- the `team-telnyx/edge-compute` repo
- the `telnyx-edge` CLI

That means:
- build/status/deploy/delete/secrets/bindings/storage live in `telnyx-edge`
- agent/orchestration logic can live in `team-telnyx/ai`
- `team-telnyx/ai` should not pretend to replace Edge Compute

A useful mental model:
- **`ai` = brain / orchestration layer**
- **Edge Compute = low-latency hands / execution layer**

## When to use Edge Compute with `ai`

Good bridge use cases:

1. **MCP server adapters at the edge**
   - expose AI-adjacent tools close to the runtime
2. **Webhook ingestion + AI routing**
   - receive webhook traffic, normalize it, then hand off to AI logic
3. **Typed Telnyx event routing**
   - route voice or messaging callbacks through a typed dispatcher before they fan into larger workflows
4. **AI-adjacent functions**
   - redaction, enrichment, scoring, post-processing, lightweight transforms

## Quick Start

```bash
# Authenticate with the dedicated Edge CLI
telnyx-edge auth login

# If your installed CLI exposes API-key auth, agents can use it non-interactively instead
# telnyx-edge auth api-key set <your-api-key>

# Start from the MCP server example
telnyx-edge new-func --from-dir=examples/ts/mcp-server --name=my-mcp-server
cd my-mcp-server

# Add required secrets and deploy
telnyx-edge secrets add TELNYX_API_KEY <your-api-key>
telnyx-edge secrets add SHARED_SECRET "$(openssl rand -hex 32)"
telnyx-edge ship
```

Once deployed, use `team-telnyx/ai` for orchestration and capability discovery, and use the deployed Edge endpoint for execution.

Other strong upstream starting points:

```bash
# Typed call-event / webhook routing
telnyx-edge new-func --from-dir=examples/ts/call-event-router --name=my-call-event-router

# Minimal JavaScript webhook ingress
telnyx-edge new-func --from-dir=examples/js/webhook-receiver --name=my-webhook-receiver
```

If you do not want to start from an upstream example, the current public Edge CLI also scaffolds fresh functions directly:

```bash
telnyx-edge new-func --language=js --name=my-js-function
telnyx-edge new-func --language=ts --name=my-ts-function
telnyx-edge new-func --language=python --name=my-python-function
telnyx-edge new-func --language=go --name=my-go-function
telnyx-edge new-func --language=quarkus --name=my-quarkus-function
```

## API Reference

Edge Compute lifecycle is owned by the separate `telnyx-edge` CLI rather than the `team-telnyx/ai` SDK surface.

Common lifecycle commands:

```bash
telnyx-edge auth status
telnyx-edge status
telnyx-edge list
telnyx-edge delete-func
telnyx-edge secrets list
telnyx-edge bindings create
telnyx-edge bindings update
telnyx-edge bindings delete
telnyx-edge bindings validate
telnyx-edge bindings get
telnyx-edge storage kv create --name session-cache
telnyx-edge storage kv key put <kv-id> prompt/system "edge-ready" --ttl 30m
telnyx-edge revisions list my-mcp-server
telnyx-edge rollback my-mcp-server <revision-id>
```

| Command | Purpose |
|---------|---------|
| `telnyx-edge auth login` | Authenticate the Edge CLI with the public upstream flow |
| `telnyx-edge auth status` | Show whether the CLI is authenticated and which auth mode it is using |
| `telnyx-edge status` | Check CLI configuration and connectivity before or after a deployment handoff |
| `telnyx-edge new-func` | Scaffold a new function or clone an example |
| `telnyx-edge ship` | Deploy the current function |
| `telnyx-edge list` | List deployed functions |
| `telnyx-edge delete-func` | Delete a deployed function by name |
| `telnyx-edge secrets` | Manage runtime secrets |
| `telnyx-edge bindings` | Manage Telnyx API bindings for Edge functions |
| `telnyx-edge storage` | Manage KV namespaces and keys via the dedicated Edge CLI |
| `telnyx-edge revisions` | Inspect deploy history for a function |
| `telnyx-edge rollback` | Switch traffic back to a previous successful revision |

### Binding handoff

When your function needs Telnyx API access, the upstream flow is:

```bash
telnyx-edge bindings create
telnyx-edge bindings update
telnyx-edge bindings delete
telnyx-edge bindings validate
telnyx-edge bindings get
```

That keeps binding management owned by `telnyx-edge` instead of inventing a parallel `team-telnyx/ai` credential path.

### Revisions and rollback

Current upstream docs also expose immutable revisions and traffic rollback:

```bash
telnyx-edge revisions list my-function
telnyx-edge rollback my-function <revision-id>
```

This repo should mention that lifecycle surface so the bridge stays honest, but the actions themselves still belong to `telnyx-edge`.

## Storage / KV scope decision

Current upstream `telnyx-edge` CLI docs advertise storage/KV namespace and key operations as first-class commands.

The bridge decision in `team-telnyx/ai` today is:

- mention storage/KV explicitly so the command surface is honest
- keep storage/KV execution in the dedicated `telnyx-edge` CLI
- do **not** add `telnyx-agent` wrapper commands for storage/KV in this refresh

That preserves the architecture boundary: `ai` stays on orchestration and discoverability, while `telnyx-edge` owns the actual runtime resource lifecycle.

## Prerequisites

- Telnyx account
- Access to the dedicated `telnyx-edge` CLI
- A use case where AI workflows need a real deployed HTTP or MCP execution surface

## Prerequisite: install `telnyx-edge`

Edge Compute is managed through the separate CLI:

```sh
# Manual install from the upstream releases page
tar -xzf telnyx-edge-*.tar.gz
sudo mv telnyx-edge-*/telnyx-edge /usr/local/bin/

telnyx-edge auth login
telnyx-edge auth status
```

For a one-liner install, the current upstream README also publishes platform-specific `curl ... | tar -xz` commands from the latest GitHub release assets. If your installed CLI exposes `auth api-key set`, agents can use that non-interactive flow after install, but the current upstream `v0.2.0` docs still document `telnyx-edge auth login` as the default auth entrypoint.

Typical lifecycle commands live there:

```sh
telnyx-edge new-func
telnyx-edge ship
telnyx-edge list
telnyx-edge status
telnyx-edge delete-func
telnyx-edge secrets
telnyx-edge bindings
telnyx-edge storage
```

The current public quick-start documents direct scaffolding for `js`, `ts`, `python`, `go`, and `quarkus`; use those templates when you need a clean starting point instead of a prebuilt example.

Concrete KV operations stay upstream as well:

```sh
telnyx-edge storage kv create --name agent-session-cache
telnyx-edge storage kv list
telnyx-edge storage kv key put <kv-id> prompts/system "hello from edge" --ttl 30m
telnyx-edge storage kv key get <kv-id> prompts/system
telnyx-edge storage kv key delete <kv-id> prompts/system
```

## Reference architecture

A practical pattern looks like this:

1. Use `team-telnyx/ai` for:
   - agent workflows
   - prompts/orchestration
   - guides and capability discovery
   - Telnyx API integrations
2. Use `team-telnyx/edge-compute` for:
   - function scaffolding
   - status and connectivity checks
   - deployment
   - deletion
   - secrets and bindings
   - storage/KV lifecycle
   - running webhook/MCP edge endpoints
3. Connect them with a stable boundary:
   - HTTP webhook
   - MCP endpoint
   - function call into an edge-hosted adapter

## Endgame: what a good integration looks like

The end state is **not** "move Edge Compute into `team-telnyx/ai`".

The better endgame is a clear two-layer product:

### Layer 1 — `team-telnyx/ai`
This layer should:
- expose Edge Compute as a first-class capability in docs/manifests/help output
- provide AI-oriented patterns and recipes
- explain when an agent should reach for edge execution
- help users connect agent workflows to deployed edge endpoints

### Layer 2 — `team-telnyx/edge-compute`
This layer should continue to own:
- auth
- status / connectivity diagnostics
- function creation
- deployment
- deletion
- secrets
- bindings
- storage / KV
- runtime lifecycle and operational ergonomics

### Bridge between them
The bridge should be explicit and boring:
- `ai` produces orchestration guidance
- Edge Compute provides execution endpoints
- the contract between them is HTTP, MCP, or a documented function interface

That keeps ownership clear and avoids duplicating deployment tooling.

## Phased rollout

### Phase 1 — Discoverability (this repo, now)
- add Edge Compute capability visibility
- add guide-level handoff and examples
- make the README and capabilities output honest about scope

### Phase 2 — Guided integration
- add richer examples for webhook handlers, MCP adapters, and AI post-processing functions
- add copy-paste scaffolds for how an AI app should call a deployed edge endpoint
- document required secrets/bindings patterns

### Phase 3 — CLI bridge
Only if ownership stays clear:
- lightweight helper commands or docs-driven handoff from `telnyx-agent` to `telnyx-edge`
- examples: `edge doctor`, `setup-edge-mcp`, or explicit "next command" guidance
- these should shell out to `telnyx-edge`, not reimplement lifecycle management

### Phase 4 — Deeper integration (optional, later)
Only if a stable contract exists:
- standardized templates
- stronger config generation
- possibly a shared library or interface contract

Not before.

## Example: AI app calling an Edge endpoint

A simple pattern is to let your AI app call a deployed edge function for specialized execution.

```python
import os
import requests

response = requests.post(
    "https://<your-edge-endpoint>",
    headers={
        "content-type": "application/json",
        "authorization": f"Bearer {os.environ['TELNYX_API_KEY']}",
    },
    json={
        "task": "redact_pii",
        "payload": {
            "text": "Call me at +1 555 123 4567",
        },
    },
)

print(response.json())
```

```typescript
const response = await fetch("https://<your-edge-endpoint>", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  },
  body: JSON.stringify({
    task: "redact_pii",
    payload: {
      text: "Call me at +1 555 123 4567",
    },
  }),
});

const result = await response.json();
console.log(result);
```

## Example patterns worth supporting

### 1. MCP server at the edge
Use Edge Compute to host a narrow MCP adapter close to runtime, while `team-telnyx/ai` handles the surrounding agent experience and capability discovery.

### 2. Webhook receiver + AI router
Use Edge Compute to receive inbound webhooks, normalize payloads, and forward structured requests into AI workflows.

### 3. Typed call-event router
Use the upstream `examples/ts/call-event-router` when you want a typed Telnyx event boundary before handing work to an agent or another service.

### 4. Post-processing function
Use Edge Compute for deterministic transforms such as:
- redaction
- enrichment
- scoring
- transcript cleanup
- lightweight policy checks

These are the sweet spot: small execution units attached to larger agent workflows.

## Fastest path to a real test

If you want to test the end product quickly, do **one** of these first:

### Option A — MCP server on Edge
Best when you want an AI-native demo.

```sh
telnyx-edge new-func --from-dir=examples/ts/mcp-server --name=my-mcp-server
cd my-mcp-server
telnyx-edge secrets add TELNYX_API_KEY <your-api-key>
telnyx-edge ship
```

Then point your MCP client or agent runtime at the deployed endpoint.

### Option B — Webhook receiver on Edge
Best when you want a simple integration seam.

```sh
telnyx-edge new-func --from-dir=examples/js/webhook-receiver --name=my-webhook
cd my-webhook
telnyx-edge ship
```

Then have your AI workflow call or route into that edge endpoint.

### Option C — Typed call-event router on Edge
Best when you want a compile-time checked Telnyx event boundary before AI routing.

```sh
telnyx-edge new-func --from-dir=examples/ts/call-event-router --name=my-call-event-router
cd my-call-event-router
npm run build
telnyx-edge ship
```

Then map the typed event handlers to your AI or webhook orchestration path.

### Option D — Post-processing function
Best when you want a narrow but real AI-adjacent utility.

Example use cases:
- redact PII before storage
- enrich messages before downstream routing
- score or classify inbound events
- clean transcripts before analysis

You can also smoke-test a deployed edge endpoint directly:

```bash
curl -X POST "https://<your-edge-endpoint>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{
    "task": "redact_pii",
    "payload": {
      "text": "Call me at +1 555 123 4567"
    }
  }'
```

## What this repo should and should not claim

This repo **can**:
- explain how Edge Compute fits into AI-agent workflows
- provide examples and bridge guidance
- point users to the right product surface

This repo **should not** claim that it:
- deploys edge functions directly
- manages rollbacks or lifecycle state
- replaces `telnyx-edge`
- provides complete native Edge Compute support

## Test recipe

Here is the most practical end-to-end test loop:

1. install `telnyx-edge` and authenticate with `telnyx-edge auth login`
2. verify readiness with `telnyx-edge auth status` and `telnyx-edge status`
3. start from a working example in `team-telnyx/edge-compute`
4. deploy it with `telnyx-edge ship`
5. expose a stable HTTP or MCP boundary
6. call that deployed endpoint from an AI workflow
7. iterate on the boundary, not on duplicated deployment logic

That gives you a real integration test without pretending `team-telnyx/ai` owns lifecycle management.

## Best next step

If you want to use Edge Compute from an AI workflow today:

1. install `telnyx-edge` and authenticate with `telnyx-edge auth login`
2. verify the CLI state with `telnyx-edge auth status` and `telnyx-edge status`
3. create/deploy your function in `team-telnyx/edge-compute`
4. expose a stable HTTP or MCP boundary
5. use `team-telnyx/ai` to orchestrate calls into that deployed endpoint

For deploy/runtime specifics, use the `edge-compute` repo as the source of truth.

## Source of truth

- AI workflow/orchestration guidance: `team-telnyx/ai`
- Edge lifecycle and deployment: `team-telnyx/edge-compute`
- Runtime deploy tool: `telnyx-edge`
