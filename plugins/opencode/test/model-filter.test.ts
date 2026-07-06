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

  it("filters GLM-5.2 by default because streamed tool-call arguments are known unsafe", () => {
    const glmModel = {
      id: "zai-org/GLM-5.2",
      owned_by: "telnyx",
      task: "text-generation",
      context_length: 1_000_000,
      max_output_length: 16_384,
    }

    const reason = knownUnsafeModelReason(glmModel.id)
    assert.match(reason ?? "", /streamed tool-call arguments/i)
    assert.equal(modelConfig(glmModel), undefined)
  })

  it("allows GLM-5.2 when the explicit unsafe-model override is enabled", () => {
    process.env[envVar] = "1"
    const glmModel = {
      id: "zai-org/GLM-5.2",
      owned_by: "telnyx",
      task: "text-generation",
      context_length: 1_000_000,
      max_output_length: 16_384,
    }

    assert.equal(knownUnsafeModelReason(glmModel.id), undefined)
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
})
