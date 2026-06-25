---
name: telnyx-ai-tts-provider-switching
description: >-
  Repeatable setup for choosing, testing, and switching Telnyx AI assistant
  text-to-speech providers. Covers when to stay on Telnyx-hosted voice,
  when to move to ElevenLabs or another provider, the verification loop after
  a voice change, and the operational fields to preserve from
  `call.conversation.ended`.
user_invocable: true
metadata:
  author: telnyx
  product: ai-assistants
  compatibility: "Pairs with guides/ai-assistants.md, guides/voice-agent-onboarding.md, and telnyx-ai-inference-* for provider-specific TTS calls."
---

# Telnyx AI TTS Provider Switching

Use this skill when the workflow is "pick a voice provider" or "change the assistant's speaking voice without breaking the live call path."

## Success Condition

The workflow is complete when:

1. the target provider and voice are configured on the assistant
2. one synthetic or live verification confirms the new voice path
3. you preserve the resulting `tts_provider` and `tts_voice_id` evidence from the call

## Provider Choice Rules

Stay on **Telnyx-hosted voice** when:

- you want the shortest first-party path
- you value fewer vendor hops and simpler operations
- your voice requirements are met by the current hosted catalog

Use **ElevenLabs** when:

- your product already depends on an ElevenLabs voice or style
- you are migrating an existing assistant and need voice continuity

Use another **text-to-speech provider through the TTS API** when:

- the workflow needs provider-specific synthesis outside assistant-managed voice
- you are testing voices before standardizing on one assistant configuration

## Assistant-Level Voice Update

When the assistant itself should speak with a new provider, update the assistant configuration and then run a test call through the same phone path.

The simplest hosted assistant pattern is:

- `voice.provider: "telnyx"` for Telnyx-hosted voices
- `voice.provider: "elevenlabs"` for ElevenLabs-backed assistant voices

Use [guides/ai-assistants.md](/guides/ai-assistants.md) for the assistant create and update shape.

## Direct TTS Evaluation Path

When you want to compare providers before changing the assistant, test with the text-to-speech API first:

```bash
curl -X POST "https://api.telnyx.com/v2/text-to-speech/speech" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "telnyx",
    "voice": "en-US-Neural2-F",
    "text": "Thanks for calling. How can I help today?"
  }'
```

Then compare the same phrase with the candidate provider and only update the assistant after the voice passes review.

## Verification Loop After A Voice Change

Run this exact loop after switching providers:

1. update the assistant voice configuration
2. place one real call or run one assistant test
3. inspect `call.conversation.ended`
4. confirm the expected `tts_provider` and `tts_voice_id`
5. listen for turn-taking regressions, latency changes, or disclosure issues

The key post-call evidence fields are:

- `assistant_id`
- `conversation_id`
- `call_control_id`
- `call_session_id`
- `tts_provider`
- `tts_voice_id`

## Decision Points During Migration

- Do not switch the model, tool surface, and voice provider in the same unreviewed change if you can avoid it.
- If the assistant already runs in production, version or canary the voice change instead of flipping all traffic at once.
- If the goal is migration from ElevenLabs, load `telnyx-import-elevenlabs` before rewriting the assistant by hand.

## What To Load Next

- [guides/ai-assistants.md](/guides/ai-assistants.md) for assistant create and update calls
- [guides/voice-agent-onboarding.md](/guides/voice-agent-onboarding.md) for the live-call verification path
- `telnyx-import-elevenlabs` when the provider switch is part of a larger migration
- `telnyx-ai-inference-*` when you need provider-level TTS API details rather than assistant-level voice configuration
