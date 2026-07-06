import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { knownUnsafeModelReason, modelConfig, unsafeModelsOverrideEnvVar } from "../src/model-filter.ts"

describe("model-filter", () => {
  const envVar = unsafeModelsOverrideEnvVar()
  const originalUnsafeOverride = process.env[envVar]

  afterEach(() => {
    if (originalUnsafeOverride === undefined) delete process.env[envVar]
    else process.env[envVar] = originalUnsafeOverride
  })

  it("registers GLM-5.2 normally (it is not withheld from modelConfig)", () => {
    const glmModel = {
      id: "zai-org/GLM-5.2",
      owned_by: "telnyx",
      task: "text-generation",
      context_length: 1_000_000,
      max_output_length: 16_384,
    }

    // modelConfig returns a full config — GLM-5.2 is registered and visible
    assert.deepEqual(modelConfig(glmModel), [
      "zai-org/GLM-5.2",
      {
        name: "GLM-5.2",
        limit: {
          context: 1_000_000,
          output: 16_384,
        },
        reasoning: true,
        options: { enable_thinking: true },
        variants: {
          thinking: { enable_thinking: true },
          "no-thinking": { enable_thinking: false },
          max: { disabled: true },
          high: { disabled: true },
          medium: { disabled: true },
          low: { disabled: true },
          fast: { disabled: true },
          none: { disabled: true },
        },
      },
    ])
  })

  it("reports the known streaming issue for GLM-5.2 (for runtime warnings)", () => {
    const reason = knownUnsafeModelReason("zai-org/GLM-5.2")
    assert.match(reason ?? "", /streamed tool-call arguments/i)
  })

  it("suppresses the known-issue warning when the opt-in env is set", () => {
    process.env[envVar] = "1"
    assert.equal(knownUnsafeModelReason("zai-org/GLM-5.2"), undefined)
  })

  it("returns undefined for models with no known issues", () => {
    assert.equal(knownUnsafeModelReason("zai-org/GLM-5.1-FP8"), undefined)
    assert.equal(knownUnsafeModelReason("moonshotai/Kimi-K2.6"), undefined)
  })
})
