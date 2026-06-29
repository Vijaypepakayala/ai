# Telnyx AI FDE Harness Baseline

Short baseline for [TEL-577](https://telnyx.com) defining how Telnyx AI FDE work should handle delegated subagents, memory, and run observability before those patterns spread unevenly across repos.

## Outcome

Use this baseline when the question is not only "can an agent finish the task?" but "can Telnyx keep the run understandable, reviewable, and cost-bounded after the work becomes long-running or multi-agent."

The default outcome is:

- most work stays in one primary agent
- delegated subagents are used only for bounded side work with explicit ownership
- persisted memory is small, typed, and policy-scoped
- every material run can be reconstructed from cost, cache, tool, approval, and audit evidence

## 1. Architecture Baseline

### Default topology

Start with one foreground orchestrator agent per issue or workflow. That agent owns:

- user or task interaction
- execution policy and approval handling
- final synthesis
- durable status updates

Delegate to subagents only when the work is both parallelizable and bounded.

### Single agent by default

Stay with one agent when any of these are true:

- the next action depends on immediate local reasoning
- the task fits in one repo slice or one reviewable document
- the cost of handoff is larger than the cost of local execution
- the work touches sensitive state that should not be copied widely

### When to use delegated subagents

Use subagents only for sidecar tasks with a clear contract:

- focused repo exploration with a specific question
- a bounded code change in a disjoint write surface
- verification that can run in parallel with implementation
- evidence gathering for docs, telemetry, or audit support

Do not delegate the critical path if the parent agent is blocked on the answer before it can take the next step.

### Required subagent contract

Every delegated subagent should have:

- one owner and one task statement
- a narrow write scope or explicit read-only scope
- a bounded input packet instead of the whole conversation when possible
- an expected output shape such as findings, patch, or verification result
- a parent-run correlation ID so telemetry can tie child work back to the original issue

### Recommended execution shape

For Telnyx AI FDE work, the first implementation pattern should be:

1. Parent agent receives the issue and keeps the approval boundary.
2. Parent agent decides whether the task is single-agent or split.
3. Read-only explorer subagents gather narrow context in parallel.
4. Zero or more worker subagents make disjoint changes or produce bounded artifacts.
5. Parent agent integrates results, runs the smallest proving verification, and posts the final update.

This keeps policy, memory, and review ownership in one place while still allowing parallel work.

### Protocol boundary

When Telnyx needs both remote tool access and agent-to-agent delegation, use a split boundary by default:

- MCP or an equivalent typed tool protocol for data and tool access
- A2A-style delegation only for specialist-agent handoffs
- private connectivity or customer-hosted ingress for internal systems before any public exposure

This keeps tool permissions, network boundaries, and delegation semantics separate instead of collapsing them into one opaque runtime path.

## 2. Memory Baseline

### Memory tiers

Treat memory as three different classes, not one bucket:

| Tier | Purpose | Persistence | Examples |
| --- | --- | --- | --- |
| Working memory | Short-lived run context needed to finish the current task | Ephemeral, run-scoped | active plan, open files, tool outputs, temporary summaries |
| Operational memory | Small durable facts that improve the next run without replaying the whole thread | Persisted with TTL and owner | last successful verification command, known repo-specific guardrails, approved rollout decision |
| Audit memory | Evidence needed for traceability and review | Persisted under system retention rules | approval events, tool traces, cost totals, final artifact links |

### What may persist

Persist only compact, reusable facts that meet all of these rules:

- they are likely to help a later run
- they can be stated as a typed fact or small summary
- they do not require the full raw transcript to stay useful
- they pass the repo or company data-handling policy

Good candidates:

- repository-specific execution rules
- a verified command or workflow pattern
- stable environment facts
- approved design decisions and exceptions
- compact post-run summaries with clear provenance

### What should remain transient

Do not persist these by default:

- raw prompts or full conversation transcripts
- secrets, bearer tokens, API keys, cookies, or unredacted headers
- broad copies of tool output that mostly duplicate source-of-truth systems
- personal data unless the workflow explicitly requires it and retention is approved
- speculative reasoning or incomplete intermediate notes that could later be mistaken for facts

### Memory storage rule

The parent agent should be the only agent allowed to promote information from working memory into durable operational memory. Subagents can propose summaries, but they should not write durable memory directly without an explicit parent decision.

This avoids silent memory sprawl and prevents sidecar tasks from becoming unsupervised data-retention paths.

## 3. Observability Baseline

Every meaningful run should emit enough evidence to answer:

1. What work ran?
2. Which agent or subagent did it?
3. What did it cost?
4. What tools, cache paths, and approvals influenced the result?
5. How does an operator reproduce or review it later?

### Minimum run record

For parent and child runs, record at least:

- issue or workflow ID
- run ID
- parent run ID for subagents
- agent identity and role
- start time, end time, and terminal status
- repo or environment target

### Minimum cost and cache metrics

Record cost and model-usage fields per run and aggregate them at the parent:

- model name
- input tokens
- output tokens
- cached-input or cache-read tokens when the runtime exposes them
- estimated cost or billable units
- retry count

The baseline requirement is not perfect provider-normalized finance. It is enough consistent telemetry to spot regressions, prompt bloat, and cache misses.

### Minimum tool and execution trace

Capture:

- tool name
- tool start and end time
- success or failure
- high-level target such as file path, endpoint, or query
- error type and retry outcome when relevant

Keep tool payload bodies out of the default trace when they may contain secrets or large blobs. Store references or redacted summaries instead.

### Minimum approval and audit events

Capture:

- approval requested, approved, denied, or superseded
- execution-policy stage transitions
- review artifact creation
- deployment or mutation correlation IDs when a live surface is touched

These events should be queryable alongside cost and tool traces so a reviewer can reconstruct why a run stopped, waited, or escalated.

## 4. Security And Privacy Baseline

- Keep the approval boundary in the parent agent. Subagents should not independently perform live or approval-sensitive actions unless the workflow explicitly delegates that authority.
- Minimize context copies. Pass only the task packet a child needs, not the full thread by default.
- Prefer private ingress patterns for internal tools and diagnostics. Do not expose sensitive telco or account-state systems to the public internet merely to make them agent-accessible.
- Redact credentials, secrets, and high-risk identifiers before memory promotion or telemetry storage.
- Prefer typed summaries over raw transcript persistence.
- Put TTLs on operational memory so old assumptions decay instead of silently accumulating.
- Require provenance on durable facts: who wrote it, when, from which run, and from which source artifact.

## 5. Reliability Baseline

- Make the parent agent resumable from a compact heartbeat context rather than a full thread replay.
- Bound subagent work with clear ownership and terminal expectations so the parent never waits indefinitely.
- Treat comments, documents, and generated artifacts as evidence, not as liveness by themselves.
- Keep the smallest verification nearest the change instead of running broad test suites by default.
- When a child fails, the parent should either retry with a narrower brief, absorb the task locally, or mark the issue blocked with a named owner and action.

The main reliability rule is simple: long-running work should degrade toward smaller, reviewable units, not toward larger opaque runs.

## 6. Operational Cost Baseline

- Prefer one capable parent agent over a tree of children until parallelism produces a clear wall-clock or quality benefit.
- Use subagents for independent branches only; duplicated reading and duplicated planning are the fastest way to inflate token cost.
- Persist compact summaries so future runs can reuse them instead of reloading entire histories.
- Measure cache-read effectiveness. If a workflow pays to rehydrate the same large context but rarely hits cache, shrink the packet or move reusable facts into typed memory.
- Escalate when a workflow repeatedly needs more than one delegated layer. That usually indicates a missing product primitive, not merely a prompting issue.

## 7. Example Workflow

### Example: repo-level implementation with one parent and two bounded children

1. Parent agent receives a feature issue and checks the approval or execution policy.
2. Parent agent reads heartbeat context, identifies success criteria, and decides the task is partly parallelizable.
3. Explorer subagent answers one narrow question about the existing CLI code path.
4. Worker subagent drafts a docs artifact in a single target file.
5. Parent agent reviews both outputs, makes the final edits, runs the smallest relevant test, and posts the review packet.
6. Parent agent promotes only two durable memory facts:
   - the verified test command
   - the repo-specific rule that generated provider files must be synced after canonical skill edits
7. Telemetry links all three runs through the parent run ID, includes token and cache metrics, and stores the review artifact.

This is the baseline pattern Telnyx should prefer over a broad swarm of autonomous children.

## 8. Initial Implementation Path In Current Telnyx Workflows

The first implementation target should be the Paperclip-style issue heartbeat flow used for engineering execution:

- parent issue run is the orchestration boundary
- checkout, heartbeat context, approval, and final issue update remain parent-owned
- delegated subagents are limited to bounded research, disjoint implementation, or parallel verification
- durable memory promotion happens only in the parent flow
- review artifacts and issue comments become the first user-facing audit surface

Concretely, the first repo changes should focus on:

1. Standardizing a typed parent-run telemetry envelope across agent, subagent, tool, and approval events.
2. Adding a small durable-memory store for verified repo facts and workflow summaries with TTL and provenance.
3. Emitting cache-read and token-cost fields into the same run record used for issue review.
4. Surfacing a compact per-run review packet that combines changed files, verification, cost, and child-run summaries.

This path fits current Telnyx AI FDE workflows because it improves the execution harness already used for repo work instead of introducing a second orchestration system.

For later phases that need remote specialist services or internal tool access, prefer MCP for trusted tool surfaces and A2A-style boundaries for delegated specialists, with the private network boundary preserved by default.

## 9. Missing Primitives And Repo Changes

Telnyx should expect to need these primitives before the baseline is fully real:

- a typed run-event schema shared by parent and child agents
- first-class parent-run and child-run correlation IDs in telemetry
- durable-memory records with TTL, provenance, and policy labels
- cache-read metrics exposed consistently across supported model providers
- a compact review artifact format that can be attached to issue status changes
- redaction rules for traces and memory promotion

If these primitives do not exist yet, the initial fallback is still useful: parent-owned markdown review packets plus lightweight structured telemetry emitted beside them.

## Decision Summary

- Default to one parent agent.
- Add subagents only for bounded, parallelizable side work.
- Persist small typed facts, not raw transcripts.
- Keep approval, memory promotion, and final synthesis in the parent.
- Require token, cache, tool, approval, and audit visibility on every meaningful run.
