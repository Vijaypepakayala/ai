# Telnyx AI Model Governance Playbook

> A first-party operator playbook for keeping Telnyx AI assistants and voice workflows governable across model lifecycle changes, privileged access, budget pressure, and runtime security posture.

## What This Playbook Covers

Use this guide when the main question is not only "which model should I use?" but "what has to be true before this model is allowed to run in a production Telnyx workflow?"

The reference outcome is a Telnyx AI deployment that:

1. tracks which provider and surface each assistant version depends on
2. fails closed when a model, endpoint, or account entitlement is missing
3. keeps long-running voice and agent workloads inside an explicit spend envelope
4. blocks promotion when runtime evidence, security posture, or observability is incomplete

This guide complements, rather than replaces:

- [AI Voice Assistants](/guides/ai-assistants.md) for assistant creation and versioning
- [Telnyx AI Voice Production Playbook](/guides/voice-ai-production-playbook.md) for production rollout, handoff, and live verification
- [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) for the answer-webhook path
- [Webhooks](/guides/webhooks.md) for signature verification and delivery handling

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- One target Telnyx workflow such as a voice assistant, SMS assistant, or telecom operations agent
- A place to record release metadata such as a ticket, runbook, or change log
- Basic familiarity with [AI Voice Assistants](/guides/ai-assistants.md) and [Telnyx AI Voice Production Playbook](/guides/voice-ai-production-playbook.md)

## Governance Outcome

Treat the governed unit as one deployable assistant or agent workflow, not "AI" in the abstract.

The workflow is governance-ready when all of these are true:

- every production version names its model dependency, provider surface, and fallback behavior
- the runtime proves access before the first user turn and exits safely if the dependency is unavailable
- the owner has a daily, monthly, and per-session spend envelope with alert thresholds
- the release gate requires runtime evidence such as tests, live-call traces, and security findings review before promotion

## Quick Start

1. Inventory the exact model path for the candidate version: hosted Telnyx model, custom OpenAI-compatible endpoint, or another privileged surface.
2. Define the fail-closed rule before launch: what the workflow does when the model, entitlement, or account limit is missing.
3. Set the spend envelope for the workflow, including call minutes, speech, inference, and tool retries.
4. Require one promotion checklist that captures assistant tests, live verification evidence, webhook integrity, and incident observability.
5. Promote only a named version, not a mutable prompt or default model assumption.

## 1. Track Model Lifecycle As Part Of The Release

Do not treat a model ID in a prompt or curl snippet as a stable contract. Record which surface owns the dependency:

- Telnyx-hosted assistant model from `GET /v2/ai/models`
- custom external model routed through a tool, webhook, or OpenAI-compatible endpoint
- privileged provider surface that may need separate enablement, quota, or region approval

For every production candidate, record at minimum:

- `assistant_id`
- `version_id`
- `model`
- provider or endpoint owner
- expected lifecycle state such as preview, generally available, or deprecated
- explicit fallback or rollback target

Use assistant versions as the promotion boundary:

```bash
curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/assistants/{assistant_id}/versions" \
  -H "Authorization: Bearer $TELNYX_API_KEY"

curl "https://api.telnyx.com/v2/ai/models" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

Lifecycle rule:

- If the model catalog or provider contract changes, the fallback is another reviewed `version_id`, not an on-the-fly prompt edit.

## 2. Enforce Access Preflight And Fail Closed

Before the workflow takes a real call, sends a real message, or starts a long-running agent step, prove that the runtime can reach the required surface with the expected entitlement.

Minimum preflight checks:

- the target model appears in the live catalog or is otherwise resolvable by the runtime
- required bearer credentials or external provider secrets are present
- the workflow has access to every tool or webhook dependency it expects
- the release owner knows whether the path is first-party hosted or depends on an external privileged surface

Fail-closed examples:

- inbound voice assistant: answer with a short maintenance message or route directly to a human queue
- outbound telecom agent: do not start the campaign step; emit an operational alert instead
- internal assistant workflow: return a retriable "dependency unavailable" state rather than switching to an unreviewed default model

Preflight example:

```bash
MODEL_ID="openai/gpt-5.4"

curl -sS "https://api.telnyx.com/v2/ai/models" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  | jq -e --arg model "$MODEL_ID" '.data[] | select(.id == $model)' >/dev/null
```

If the preflight fails, do not continue into live traffic. Escalate to the fallback path you already documented.

Python example:

```python
import requests

MODEL_ID = "openai/gpt-5.4"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}"}

response = requests.get("https://api.telnyx.com/v2/ai/models", headers=headers, timeout=30)
response.raise_for_status()

models = response.json().get("data", [])
is_available = any(model.get("id") == MODEL_ID for model in models)

if not is_available:
    raise RuntimeError(f"Model {MODEL_ID} is not available; keep the fallback path active.")
```

TypeScript example:

```typescript
const modelId = "openai/gpt-5.4";

const response = await fetch("https://api.telnyx.com/v2/ai/models", {
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  },
});

if (!response.ok) {
  throw new Error(`Model preflight failed with ${response.status}`);
}

const body = await response.json();
const isAvailable = body.data?.some((model: { id: string }) => model.id === modelId);

if (!isAvailable) {
  throw new Error(`Model ${modelId} is unavailable; do not enter live traffic.`);
}
```

## 3. Put Budget And Quota Controls On The Whole Workflow

Model governance fails in practice when operators budget only the LLM call and ignore the rest of the Telnyx path. For voice and telecom agents, the spend unit is the full workflow:

- call minutes
- transcription
- synthesis
- assistant inference
- webhook retries
- tool invocations
- any external model or SaaS call behind the workflow

Set these controls before the first production rollout:

- daily budget for the workflow
- monthly approved envelope
- maximum tolerated single-call or single-session duration
- alert thresholds before the hard stop
- escalation owner for runaway usage

Practical thresholds for first release:

- alert at 50% of daily budget
- alert at 80% of monthly budget
- pause rollout or force human handoff at 100% of the approved envelope
- trigger investigation when call duration, retry count, or tool failure rate moves outside the expected band

Attribution keys to keep on every event:

- `assistant_id`
- `version_id`
- `phone_number` or campaign
- `connection_id`
- `call_control_id`
- `call_session_id`
- `conversation_id`
- environment or billing group

Use Telnyx billing groups, usage reports, and account balance controls as the account-level guardrail. Mirror the same thresholds in any external provider if part of the path is not Telnyx-hosted.

## 4. Require Runtime Posture Evidence Before Promotion

Do not promote a candidate only because the prompt sounds correct in a local test. The release gate should require evidence from the actual Telnyx runtime.

Minimum runtime posture checks:

- assistant tests exist for the risky scenarios you cannot afford to regress
- one real or staging-equivalent call path proves the intended answer webhook and handoff behavior
- webhook signature verification is enabled for every custom receiver
- correlation IDs are preserved for post-call debugging and incident review
- open security findings for the runtime, tools, or secret handling have been triaged before widening traffic

Evidence sources:

- `GET /v2/ai/assistants/{assistant_id}/versions`
- assistant test runs from `POST /v2/ai/assistants/tests/{test_id}/runs`
- `call.conversation.ended` webhook payloads
- `GET /v2/ai/conversations/{conversation_id}`
- `GET /v2/ai/conversations/{conversation_id}/messages`
- Voice Monitor diagnostics from [`tools/mcp-apps/apps/voice-monitor/README.md`](/tools/mcp-apps/apps/voice-monitor/README.md)

Promotion rule:

- no candidate reaches broader traffic unless the operator can name the tested `version_id`, the observed runtime IDs, and the fallback path if the next call fails

## 5. Telnyx-Specific Governance Patterns

### Hosted voice assistant

Use when you want the smallest governed surface:

- keep STT, LLM, TTS, and telephony on the Telnyx-managed path
- test and promote with assistant versions and canary rollout
- keep the first-turn answer path on `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`
- fail closed to human transfer or maintenance handling if model preflight fails

### External model inside a Telnyx workflow

Use when a hosted model does not meet a hard requirement:

- document the external provider as a first-class dependency
- prove entitlement and quota before the live step starts
- keep the same Telnyx correlation IDs on all tool and webhook logs
- require a rollback target that removes the external dependency, not just a prompt tweak

### Agentic telecom operations

Use when an assistant or workflow automates number, messaging, or account operations:

- separate read-only discovery from mutating actions
- require idempotency for side-effecting requests
- gate high-risk actions behind narrower tools or human review
- record who approved the spend and access envelope for the workflow

## 6. Smallest-Live Verification Loop

This is the smallest proof that the governance path is real rather than documented only in prose:

1. list the live model catalog and record the candidate `model`
2. capture the candidate `version_id`
3. run one assistant test for the happy path and one for the fail-closed or escalation path
4. place one real or staging-equivalent call through the answer webhook
5. verify the resulting `conversation_id`, call IDs, and webhook evidence
6. confirm the spend owner can attribute the run to the correct assistant version and billing context

If any of those fail, the release is not governance-ready. Roll back to the previously reviewed version or keep the workflow in a human-only path until the gap is fixed.

## API Reference

These are the minimum live surfaces this playbook expects operators to use:

- `GET /v2/ai/models` to verify model availability before rollout
- `GET /v2/ai/assistants/{assistant_id}` to inspect the current assistant contract
- `GET /v2/ai/assistants/{assistant_id}/versions` to identify the promotable rollback unit
- `POST /v2/ai/assistants/tests/{test_id}/runs` to execute the candidate verification path
- `GET /v2/ai/conversations/{conversation_id}` to review runtime output after a live or staged interaction
- `GET /v2/ai/conversations/{conversation_id}/messages` to inspect turn-level evidence

## Operator Checklist

Use this checklist before widening traffic:

- The model dependency and provider surface are recorded for the candidate version.
- A reviewed fallback `version_id` or human-handoff path exists.
- Access preflight is automated and fails closed.
- Daily, monthly, and per-session spend limits are documented.
- Correlation IDs are preserved across Telnyx and external logs.
- Assistant tests cover both the intended path and the unsafe-path exit.
- Runtime evidence was captured from real Telnyx surfaces, not only prompt inspection.
- Security findings and secret-handling posture were reviewed before promotion.

## Related Guides

- [AI Voice Assistants](/guides/ai-assistants.md)
- [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md)
- [Telnyx AI Voice Production Playbook](/guides/voice-ai-production-playbook.md)
- [Webhooks](/guides/webhooks.md)
