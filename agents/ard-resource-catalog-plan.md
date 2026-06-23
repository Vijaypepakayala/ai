# ARD-Compatible Telnyx AI Resource Catalog Plan

Short design artifact for [TEL-482](/TEL/issues/TEL-482) defining the first repo-owned Telnyx surface that ARD-capable registries and external coding agents can discover without custom setup.

## Goal

Publish the smallest useful public catalog that helps an external agent answer three questions safely:

1. What Telnyx AI resource should I look at first?
2. Which surfaces are read-only discovery versus install or execution surfaces?
3. Which resources require explicit auth, install, or human approval before use?

The first implementation is intentionally a draft-level, repo-owned catalog at `https://telnyx.com/ai/catalog.json` with a public alias at `https://telnyx.com/.well-known/ai-catalog.json`.

## First Catalog Boundary

The initial catalog is a discovery surface, not an execution surface and not an installer.

Included in the first catalog:

| Resource class | In first catalog | Why |
| --- | --- | --- |
| Agent discovery entrypoints | Yes | They are stable, public, and the best first hop for external coding agents. |
| Auth and onboarding docs | Yes | Agents need a canonical path to understand bearer auth, signup, and first-run constraints. |
| Repo-owned AI workload catalog | Yes | It is the bounded machine-readable map that tells agents which Telnyx AI surface to choose. |
| Capability and pricing mirrors | Yes | They provide structured product and pricing context without forcing broad docs crawling. |
| MCP Apps registry and proof app docs | Yes | They are focused, public, and compatible with least-privilege discovery. |
| Skills index | Yes | It lets agents discover the curated skill package without advertising every generated file as a first-class runtime endpoint. |
| Safe no-auth evaluation path | Yes | `POST https://telnyx.com/api/inference` is safe to advertise as a guarded first-run evaluation route. |

Deferred or intentionally out of the first catalog:

| Resource class | Out for now | Why |
| --- | --- | --- |
| Generic Telnyx API MCP runtime (`/v2/mcp`) as an installable default | Yes | It is too broad for first-run registry ranking and should remain an authenticated expert surface. |
| Every individual skill file as its own catalog resource | Yes | The skills index is the stable discovery unit; publishing each file would add noise and version churn. |
| Mutable API operations such as direct messaging or number ordering | Yes | The first catalog is for finding safe starting points, not advertising live-write actions. |
| Account-specific resources or region-specific model inventory | Yes | They are volatile and must be resolved at runtime after auth. |
| Auto-install instructions for plugins, MCP servers, or write-capable tools | Yes | Discovery must not imply silent installation or execution approval. |

## Initial Resource Set

The first published set should rank these groups in this order:

1. `agents/start`
2. `guides/getting-started.md`
3. `auth.md`
4. `.well-known/agent-card.json`
5. `.well-known/agent-access.json`
6. `.well-known/agent-skills/index.json`
7. `ai/catalog.json`
8. `ai/capabilities.json`
9. `ai/pricing.json`
10. MCP Apps registry, catalog, and proof app pages
11. The no-auth inference evaluation path as a governed first-run route

Ranking guidance:

- Rank repo-owned read-first surfaces above install or execution surfaces.
- Rank guided onboarding above broad product catalogs.
- Rank focused MCP Apps above the generic MCP proxy for first-run discovery.
- Rank the no-auth inference path as an evaluation route, not as the default answer for every AI workload.
- Rank mutable or account-scoped surfaces below discovery surfaces even when they are more powerful.

Naming guidance:

- Use stable nouns that describe the resource, not the current campaign or launch framing.
- Prefer one user-facing title per resource family, for example `Agent entrypoint`, `AI catalog`, `MCP Apps registry`, or `Host-authenticated inference demo`.
- Keep IDs URL-safe and durable. Avoid model names, quarter names, or temporary launch labels in IDs.

## Required Metadata Fields

Each cataloged resource should expose at least:

| Field | Purpose |
| --- | --- |
| `id` | Stable machine identifier. |
| `name` | Human-readable title. |
| `summary` | One-sentence reason an agent would choose it. |
| `canonical_url` | Public fetch URL for the resource. |
| `resource_kind` | Such as `guide`, `manifest`, `registry`, `catalog`, `app`, or `evaluation_route`. |
| `access_level` | `public`, `public_read_auth_write`, or `authenticated`. |
| `auth_mode` | How the agent reaches the surface, for example `none`, `bearer`, or `host_authenticated`. |
| `governance` | The governed-execution shape for the surface. |
| `install_boundary` | Whether install is `not_applicable`, `explicit_user_action`, or `operator_managed`. |
| `approval_boundary` | Whether execution is `none_read_only`, `confirm_intent_then_mutate`, or `explicit_approval_then_execute`. |
| `freshness_source` | Where live validation must happen before automation. |
| `tags` | Search and ranking hints such as `voice`, `mcp`, `onboarding`, `skills`, or `pricing`. |

Recommended but optional:

- `related_resources`
- `deferred_reason`
- `audience`
- `last_reviewed_at`

## Trust, Auth, and Approval Mapping

The catalog should not invent a second trust model. It should reuse the repo's governed-execution contract and current auth discovery surfaces.

Rules:

- Read-only catalog entries should map to `risk_class=read_only`.
- Any first-run evaluation route that spends compute or creates usage should map to `guarded_write` and require intent confirmation before execution.
- Live account mutation surfaces stay discoverable by reference, but they should not be promoted as first-class starter resources in the initial catalog.
- Auth details should resolve through `auth.md`, the OAuth authorization server metadata, and protected-resource documents instead of duplicating low-level auth instructions in every entry.
- Installable resources such as plugins or MCP clients must remain explicit-install surfaces. The catalog can point to them, but it must not imply auto-install.

## GitHub Agent Finder And ARD Client Compatibility Notes

This plan aims for ARD-compatible discovery behavior without claiming more than the repo currently serves.

Compatibility expectations:

- The catalog must be publicly fetchable over HTTPS with absolute URLs.
- The payload must stay lightweight and readable without JavaScript execution.
- Read-first and low-risk resources should appear before authenticated or mutable resources.
- Each entry should make auth and approval boundaries obvious enough that a registry client does not mistake discovery for permission to execute.
- The `.well-known/ai-catalog.json` alias should mirror the canonical `ai/catalog.json` payload so registry clients have a conventional fetch path.

Known draft limitations:

- The current repo-owned catalog is workload-oriented first, not a full per-resource registry index.
- It links to live runtime sources for volatile model inventory instead of snapshotting that inventory into the repo.
- It is suitable as a starter ARD surface for discovery and ranking, but not yet as a complete install-and-execute registry for every Telnyx AI capability.

## Hosting And Update Workflow

- Canonical source: `ai/catalog.json`
- Public alias: `.well-known/ai-catalog.json`
- Human design reference: `agents/ard-resource-catalog-plan.md`
- Source-of-truth owner: repo discovery surfaces maintained alongside `agent.json`, `agents/start.md`, and the other repo-owned mirrors

Update workflow:

1. Update `ai/catalog.json` first.
2. Mirror the same payload to `.well-known/ai-catalog.json`.
3. If the boundary, ranking, or trust model changes, update this plan document in the same change.
4. Keep `README.md`, `AGENTS.md`, `agents/start.md`, and `agent.json` aligned with any new public catalog URL or ownership change.
5. Run `npm run test:discovery-assets` before review.

## Success Condition For TEL-482

`TEL-482` is satisfied when:

- the repo exposes a public AI catalog and `.well-known` alias
- the catalog clearly points agents toward the right first-run Telnyx AI surfaces
- the plan above documents what is intentionally in or out, how ranking works, and where approval boundaries apply
