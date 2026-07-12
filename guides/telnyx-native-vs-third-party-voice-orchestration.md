# Telnyx-Native Assistants Vs Third-Party Voice Orchestration

> A decision guide for choosing between the Telnyx-native voice-assistant path and an external orchestration layer such as Vapi or Retell on top of Telnyx telephony.

## What This Guide Answers

Use this guide when the main question is not "can Telnyx do voice AI?" but "where should the application boundary live?"

The two common shapes are:

- **Telnyx-native assistant path:** Telnyx telephony, STT/TTS, assistant runtime, answer webhook, and post-call inspection stay on the Telnyx-managed path.
- **Third-party orchestration path:** Telnyx remains the telephony and network layer while an external runtime owns more of the prompt, agent, workflow, or channel experience.

The right answer depends on which layer you need to optimize first: telecom control or application-layer orchestration.

## Prerequisites

- Telnyx API key ([get one free](https://telnyx.com/agent-signup.md))
- Familiarity with [AI Voice Assistants](/guides/ai-assistants.md), [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md), and [voice call control](/guides/voice-call-control.md)
- A clear success condition for the first production milestone: live answered call, broader channel packaging, migration off another runtime, or deeper telecom observability

## Short Recommendation

Start **Telnyx-native** when your first success condition is a reliable voice agent on Telnyx numbers with clear telecom ownership, low-latency answer flow, and first-party debugging.

Add a **third-party orchestration layer** when you have a hard requirement for an application experience that the native assistant path does not yet cover well enough, especially broader channel packaging, vendor-specific builder UX, or a pre-existing agent stack outside Telnyx.

If you are unsure, use this default:

1. Prove the first live voice call with the Telnyx-native answer-webhook path.
2. Keep Telnyx as the telecom system of record.
3. Add external orchestration only for the parts that actually need it.

## Quick Start

Run this decision flow before you commit to a runtime boundary:

1. Confirm that the Telnyx-native assistant catalog and answer-webhook path satisfy the first live-call milestone.
2. Write down the external requirement that would force another orchestration layer.
3. If that requirement is not concrete, start native and preserve Telnyx-side IDs from the first call.

```bash
# Check the assistant model catalog that is available to your account
curl "https://api.telnyx.com/v2/ai/models" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

```bash
# Create the smallest possible native evaluation assistant
curl -X POST "https://api.telnyx.com/v2/ai/assistants" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Decision Guide Eval Assistant",
    "instructions": "Answer inbound calls briefly and clearly.",
    "model": "openai/gpt-5.4",
    "voice": {
      "provider": "telnyx",
      "settings": {
        "voice_id": "en-US-Neural2-F"
      }
    }
  }'
```

```python
import requests

API_KEY = "KEY..."
BASE_URL = "https://api.telnyx.com/v2"

models = requests.get(
    f"{BASE_URL}/ai/models",
    headers={"Authorization": f"Bearer {API_KEY}"},
    timeout=30,
).json()

print([model["id"] for model in models.get("data", [])[:5]])
```

```typescript
const response = await fetch("https://api.telnyx.com/v2/ai/models", {
  headers: {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY!}`,
  },
});

const models = await response.json();
console.log(models.data?.slice(0, 5).map((model: { id: string }) => model.id));
```

## Decision Matrix

| Decision area | Choose Telnyx-native first when... | Choose third-party orchestration when... |
| --- | --- | --- |
| Telecom control | You want one platform to own numbers, call routing, call-control actions, speech path, and assistant execution. | You are comfortable splitting telecom from agent runtime and operating the handoff between them. |
| Observability | You need first-party call IDs, webhook evidence, `conversation_id`, and Voice Monitor debugging without stitching several vendors together. | You already have an external observability layer and can tolerate correlation work across platforms. |
| Channel scope | Voice is the primary workload, or SMS follow-up is narrow and can stay in Telnyx primitives. | The agent must ship as a broader app experience across web, app, CRM, or non-Telnyx channels and that external layer is already your center of gravity. |
| Rollout control | You want answer-webhook bootstrap, assistant versioning, and telecom changes to move together on one platform. | Your rollout process is already organized around an external agent builder, prompt IDE, or provider-specific release workflow. |
| Ecosystem constraints | You want fewer vendors, simpler billing, and less failure-surface expansion in the live voice path. | You have a firm dependency on a third-party feature, SDK, or internal team workflow that is not practical to rebuild right now on Telnyx-native surfaces. |

## API Reference

These are the native Telnyx surfaces that usually matter most in the decision:

- `GET /v2/ai/models` to verify the live hosted assistant catalog
- `POST /v2/ai/assistants` to prove the native assistant path
- `POST /v2/connections` to wire the assistant answer webhook
- `GET /v2/ai/conversations/{conversation_id}` to inspect the resulting call after a native bootstrap run

```bash
# Inspect the post-call conversation after a native bootstrap test
curl "https://api.telnyx.com/v2/ai/conversations/{conversation_id}" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

```python
import requests

API_KEY = "KEY..."
CONVERSATION_ID = "conversation-id"

conversation = requests.get(
    f"https://api.telnyx.com/v2/ai/conversations/{CONVERSATION_ID}",
    headers={"Authorization": f"Bearer {API_KEY}"},
    timeout=30,
).json()

print(conversation)
```

```typescript
const conversationId = "conversation-id";

const conversationRes = await fetch(
  `https://api.telnyx.com/v2/ai/conversations/${conversationId}`,
  {
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY!}`,
    },
  },
);

console.log(await conversationRes.json());
```

## When Telnyx-Native Is Usually Better

Choose the native Telnyx assistant path first when these matter most:

- **Telecom is the product risk.** If the hard part is numbers, routing, call state, webhook reliability, transfers, recordings, or fraud-sensitive call behavior, keep the assistant on the same platform as the telephony.
- **You need low-friction first-call validation.** The answer-webhook path in [AI Voice Assistants](/guides/ai-assistants.md) and [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) is the shortest route to "did the agent answer a real call correctly?"
- **You care about first-party debugging.** Telnyx-native flows preserve `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id` on the same operational path.
- **You want fewer moving parts in production.** Keeping STT, LLM, TTS, telephony, and webhook evidence closer together reduces the number of vendors in the real-time path.
- **Your fallback behavior is telecom-centric.** Escalation to a human, transfer, voicemail handling, and post-call SMS confirmation are easier to reason about when Telnyx stays the source of truth.

Good native-first examples:

- inbound support or receptionist agents on Telnyx numbers
- appointment reminders and callback capture
- voice agents where transfers, call outcomes, and webhook evidence matter more than a visual builder
- first production pilots where the team needs one paved road before introducing more vendors

## When Third-Party Orchestration Is Usually Better

Choose an external orchestration layer on top of Telnyx telephony when these matter most:

- **The application layer is the product.** If the team already builds around an external voice-agent platform and Telnyx is mainly the telecom substrate, forcing everything into the native assistant path may slow delivery.
- **You need broader channel packaging now.** Some teams want a single vendor-defined builder experience across voice plus adjacent channels, internal tools, or CRM-centered workflows.
- **You depend on external ecosystem features.** If your organization already standardized on a vendor-specific prompt workflow, analytics package, simulator, or agent-management model, replacing that dependency may not be the fastest path.
- **Your team can absorb cross-vendor operations.** The cost of correlation, incident triage, and release coordination is acceptable because the external runtime gives you a capability you genuinely need.

Good third-party-led examples:

- a company with an established external voice-agent stack that wants to swap telephony providers without rewriting the app layer immediately
- teams that need a vendor-specific builder or runtime workflow for non-Telnyx channels right now
- phased migrations where Telnyx telephony lands first and assistant logic moves later

## Known Gaps And Honest Tradeoffs

Telnyx is stronger when the problem is:

- telecom ownership
- PSTN and call-control primitives
- answer-webhook bootstrap
- first-party voice diagnostics and webhook evidence
- keeping real-time voice dependencies tighter

Third parties are often stronger when the problem is:

- opinionated agent-builder UX
- broader application-layer packaging across more than one runtime surface
- teams already committed to a specific external orchestration ecosystem

Known implementation gaps that can push a team toward external orchestration today:

- you may want a richer out-of-the-box application-layer builder than the Telnyx-native assistant flow currently provides
- you may want a broader prepackaged multi-channel or app-layer orchestration model than the native voice guides cover today
- your team may already rely on external runtime-specific analytics, simulations, or agent-management conventions that Telnyx does not try to replace directly

Those are real tradeoffs. The goal is not to hide them. The goal is to keep Telnyx as the primary telecom platform even when another layer is justified.

## Model Routing And Provider Failover Defaults

If the unresolved question is "how should we package routing policy?" use this default posture:

- Route production voice traffic to one approved primary assistant model at a time. Confirm the live candidate set with `GET /v2/ai/models`, then pin the chosen model or assistant version in your deployment config instead of making ad hoc runtime choices.
- Keep the first fallback on the Telnyx-managed path when possible. The cleanest rollback is usually "revert to the last-known-good hosted model or assistant version" rather than introducing another vendor into the real-time path during an incident.
- Add an external runtime or model provider only when the requirement is concrete: missing hosted capability, mandated provider policy, or an existing external orchestration stack that already owns the application layer.
- Treat provider failover as a between-calls or release-level decision unless you have explicitly validated state handoff, latency, and ownership across vendors. In many production voice flows, human handoff, voicemail capture, or SMS follow-up is the safer degraded path than hot-swapping runtimes mid-call.
- Preserve Telnyx identifiers even when you route outside the managed path. At minimum keep `assistant_id`, `connection_id`, `call_control_id`, `call_session_id`, and `conversation_id` alongside the external provider request IDs so the telecom and model paths can be debugged together.

This is the policy that [AI Voice Assistants](/guides/ai-assistants.md) now surfaces at the setup entrypoint. Use this guide when the team needs the fuller boundary decision and failover tradeoffs behind that shorter rule set.

## Recommended Fallback Patterns

If you need external orchestration, do not give away the entire stack by default. Use one of these shapes:

### 1. Telnyx-native first, external later

Start with:

- assistant created in Telnyx
- answer webhook at `https://api.telnyx.com/v2/ai/assistants/{assistant_id}/answer`
- first-call verification with `call.conversation.ended`

Then add external orchestration only after you can prove the baseline voice path works.

This is the default recommendation for most new evaluations.

### 2. Telnyx telephony plus external runtime

Keep Telnyx as the system of record for:

- phone numbers
- call-control application and routing
- webhook delivery
- call identifiers and telephony-side evidence

Let the third party own only the agent runtime that actually needs to sit outside Telnyx.

This is the right migration posture when Telnyx must remain visible as the telecom platform instead of disappearing behind an orchestration vendor.

### 3. Native bootstrap, custom Call Control later

Use the native answer-webhook path for the first live call, then move selective flows into Call Control actions such as `ai_assistant_start` or `gather_using_ai` when you need tighter custom control.

Use this when the issue is not "Telnyx native vs third-party" but "no-code bootstrap vs more custom Telnyx control."

## Operational Rules If You Choose Third-Party Orchestration

If you add an external layer, preserve these Telnyx IDs in your own orchestration state:

- `assistant_id`
- `connection_id`
- `call_control_id`
- `call_session_id`
- `conversation_id`

Do not let the external layer become the only operational record for a live call. You still need Telnyx-side evidence for:

- webhook delivery debugging
- call routing verification
- transfer and hangup investigation
- speech-model confirmation on the actual voice path

When an incident happens, start from the Telnyx call and webhook identifiers first, then branch into the external runtime.

## Practical Recommendation By Team Stage

| Team stage | Default choice | Why |
| --- | --- | --- |
| First evaluation on Telnyx | Telnyx-native | Fastest route to a real answered call and first-party debugging |
| Telecom-heavy production workflow | Telnyx-native | Routing, transfers, evidence, and voice operations dominate |
| Existing external agent stack migrating telephony | Third-party orchestration on Telnyx telephony | Lowest-friction way to adopt Telnyx without rewriting the whole app layer |
| Multi-vendor transition | Hybrid | Keep Telnyx visible and authoritative for telephony while narrowing the external layer to the features you still need |

## Start Here

- Use [AI Voice Assistants](/guides/ai-assistants.md) for the native assistant surface.
- Use [Production Voice-Agent Onboarding](/guides/voice-agent-onboarding.md) for the first live answer-webhook call.
- Use [Read-Only Voice Diagnostics For External Runtimes](/guides/voice-diagnostics-external-runtime.md) when an external runtime needs safe post-call inspection without write access.

If the question is "which path should I try first?", the answer is usually: start native, validate one live call, then add orchestration only where it earns its complexity.
