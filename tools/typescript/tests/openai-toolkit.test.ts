import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpenAIToolkit } from "../src/openai/toolkit.js";
import { TelnyxAPIClient } from "../src/shared/api-client.js";
import { ToolkitCore } from "../src/shared/toolkit-core.js";

describe("OpenAIToolkit prompt-cache helpers", () => {
  it("builds a stable prompt cache key", () => {
    const core = new ToolkitCore(new TelnyxAPIClient("test-key"));
    const toolkit = new OpenAIToolkit(core, []);

    const cacheKey = toolkit.buildPromptCacheKey({
      namespace: "Telnyx Account Assistant",
      workflow: "Balance Check",
      model: "gpt-4o",
      version: "v2",
      toolNames: ["list_phone_numbers", "get_balance"],
    });

    assert.equal(
      cacheKey,
      "telnyx-account-assistant:balance-check:gpt-4o:v2:tools=get_balance,list_phone_numbers",
    );
  });

  it("extracts cached-token telemetry from an OpenAI response", () => {
    const core = new ToolkitCore(new TelnyxAPIClient("test-key"));
    const toolkit = new OpenAIToolkit(core, []);

    const telemetry = toolkit.extractOrchestrationTelemetry(
      {
        id: "resp_123",
        model: "gpt-4o",
        usage: {
          prompt_tokens: 400,
          completion_tokens: 120,
          total_tokens: 520,
          prompt_tokens_details: { cached_tokens: 250 },
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      },
      {
        cacheKey: "acct:balance:gpt-4o:v1",
        latencyMs: 840,
      },
    );

    assert.equal(telemetry.cached_tokens, 250);
    assert.equal(telemetry.uncached_input_tokens, 150);
    assert.equal(telemetry.cache_hit_rate, 0.625);
    assert.equal(telemetry.reasoning_tokens, 12);
    assert.equal(telemetry.latency_ms, 840);
    assert.equal(telemetry.cache_key_hash?.length, 16);
  });

  it("reports orchestration telemetry through the shared reporter", () => {
    const calls: unknown[] = [];
    const core = new ToolkitCore(new TelnyxAPIClient("test-key"));
    core.reportTelemetryEvent = (event) => {
      calls.push(event);
    };
    const toolkit = new OpenAIToolkit(core, []);

    const summary = toolkit.reportOrchestrationTelemetry(
      {
        id: "resp_456",
        model: "gpt-4o",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          total_tokens: 140,
          prompt_tokens_details: { cached_tokens: 60 },
          completion_tokens_details: { reasoning_tokens: 4 },
        },
      },
      {
        cacheKey: "acct:balance:gpt-4o:v1",
        latencyMs: 320,
      },
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      tool: "openai_orchestration",
      status: "success",
      duration_ms: 320,
      http_status: 200,
      http_method: "POST",
      api_path: "/openai/chat.completions",
      context: summary,
    });
  });
});
