import { THINKING_CAPABLE_MODELS } from "./models-config.ts"

const TEXT_TASKS = new Set(["text-generation", "text generation"])
const UNSAFE_MODELS_ENV = "OPENCODE_TELNYX_INCLUDE_UNSAFE_MODELS"

export type JsonObject = Record<string, unknown>

const KNOWN_UNSAFE_MODEL_REASONS: Record<string, string> = {
  "zai-org/GLM-5.2":
    "streamed tool-call arguments may be corrupted by duplicated or overlapped substrings",
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

export function unsafeModelsOptInEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env[UNSAFE_MODELS_ENV])
}

export function knownUnsafeModelReason(modelId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (unsafeModelsOptInEnabled(env)) return undefined
  return KNOWN_UNSAFE_MODEL_REASONS[modelId]
}

export function unsafeModelsOverrideEnvVar(): string {
  return UNSAFE_MODELS_ENV
}

export function isTelnyxHostedModel(model: JsonObject): boolean {
  return typeof model.owned_by === "string" && model.owned_by.toLowerCase() === "telnyx"
}

export function modelConfig(
  model: JsonObject,
  env: NodeJS.ProcessEnv = process.env,
): [string, JsonObject] | undefined {
  const id = typeof model.id === "string" ? model.id : undefined
  const task = typeof model.task === "string" ? model.task : undefined
  const context = typeof model.context_length === "number" ? model.context_length : undefined
  if (!id || !task || context === undefined) return undefined
  if (!TEXT_TASKS.has(task)) return undefined
  if (!isTelnyxHostedModel(model)) return undefined

  const shortId = id.includes("/") ? id.split("/").pop() ?? id : id
  const vision = model.is_vision_supported === true
  const output = typeof model.max_output_length === "number" ? model.max_output_length : 16384
  const thinking = THINKING_CAPABLE_MODELS.has(id)

  const base: JsonObject = {
    name: shortId,
    limit: { context, output },
    ...(vision
      ? {
          attachment: true,
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
        }
      : {}),
  }

  if (thinking) {
    base.reasoning = true
    base.options = { enable_thinking: true }
    base.variants = {
      thinking: { enable_thinking: true },
      "no-thinking": { enable_thinking: false },
      max: { disabled: true },
      high: { disabled: true },
      medium: { disabled: true },
      low: { disabled: true },
      fast: { disabled: true },
      none: { disabled: true },
    }
  }

  return [id, base]
}

export function describeModelCompatibility(
  model: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { id: string; reason: string } | undefined {
  if (!isObject(model)) return undefined
  const id = typeof model.id === "string" ? model.id : undefined
  if (!id) return undefined
  const reason = knownUnsafeModelReason(id, env)
  if (!reason) return undefined
  return { id, reason }
}
