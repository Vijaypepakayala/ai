import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { DEFAULT_ENABLED_MODELS, loadEnabledModels, persistEnabledModels } from "./models-config"
import { isTelnyxHostedModel, modelConfig, knownUnsafeModelReason } from "./model-filter"

const PROVIDER_ID = "telnyx"
const API_BASE = "https://api.telnyx.com/v2/ai"
const OPENAI_BASE = `${API_BASE}/openai`
const MODELS_URL = `${API_BASE}/models`

const sessionVariants = new Map<string, string>()

type JsonObject = Record<string, unknown>

type ModelSelectionPreset = "recommended" | "all" | "existing"

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null
}

function authFilePath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

function storedApiKey(): string | undefined {
  try {
    const auth = JSON.parse(readFileSync(authFilePath(), "utf8")) as unknown
    if (!isObject(auth)) return undefined
    const telnyx = auth[PROVIDER_ID]
    if (!isObject(telnyx) || telnyx.type !== "api") return undefined
    return typeof telnyx.key === "string" && telnyx.key.length > 0 ? telnyx.key : undefined
  } catch {
    return undefined
  }
}

function apiKey(): string | undefined {
  return process.env.TELNYX_API_KEY ?? storedApiKey()
}

async function fetchModels(key: string | undefined, enabledModelIDs: readonly string[]): Promise<Record<string, JsonObject>> {
  if (!key) return {}

  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return {}

    const payload = (await response.json()) as unknown
    const data = isObject(payload) && Array.isArray(payload.data) ? payload.data : []
    const availableModels = new Map<string, JsonObject>()

    for (const item of data) {
      if (!isObject(item)) continue
      const parsed = modelConfig(item, process.env)
      if (!parsed) continue
      availableModels.set(parsed[0], parsed[1])
    }

    return Object.fromEntries(enabledModelIDs.flatMap((modelID) => {
      const config = availableModels.get(modelID)
      return config ? [[modelID, config] as const] : []
    }))
  } catch {
    return {}
  }
}

async function fetchAllHostedModelIDs(key: string | undefined): Promise<string[]> {
  if (!key) return []

  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return []

    const payload = (await response.json()) as unknown
    const data = isObject(payload) && Array.isArray(payload.data) ? payload.data : []
    const modelIDs: string[] = []

    for (const item of data) {
      if (!isObject(item)) continue
      const parsed = modelConfig(item, process.env)
      if (!parsed) continue
      modelIDs.push(parsed[0])
    }

    return modelIDs
  } catch {
    return []
  }
}

async function resolveEnabledModelsForPreset(key: string, preset: ModelSelectionPreset): Promise<string[]> {
  if (preset === "recommended") return [...DEFAULT_ENABLED_MODELS]
  if (preset === "existing") return loadEnabledModels()

  const allHostedModels = await fetchAllHostedModelIDs(key)
  return allHostedModels.length > 0 ? allHostedModels : loadEnabledModels()
}

const TelnyxAuthPlugin: Plugin = async () => {
  const key = apiKey()
  const enabledModels = loadEnabledModels()
  const models = await fetchModels(key, enabledModels)

  return {
    auth: {
      provider: PROVIDER_ID,
      methods: [{
        type: "api",
        label: "API Key",
        prompts: [
          {
            type: "text",
            key: "apiKey",
            message: "Enter your Telnyx API key",
            placeholder: "KEY_...",
            validate: (value) => value.trim().length === 0 ? "API key is required" : undefined,
          },
          {
            type: "select",
            key: "modelPreset",
            message: "Which Telnyx models should be enabled?",
            options: [
              {
                label: "Recommended 5 (default)",
                value: "recommended",
                hint: "Kimi-K2.6, GLM-5.2, GLM-5.1-FP8, MiniMax-M3-MXFP8, MiniMax-M2.7",
              },
              {
                label: "All hosted Telnyx models",
                value: "all",
                hint: "Enable every currently available Telnyx-hosted text model",
              },
              {
                label: "Keep existing config",
                value: "existing",
                hint: "Leave ~/.config/opencode/telnyx-models.json unchanged",
              },
            ],
          },
        ],
        authorize: async (inputs) => {
          const providedKey = inputs?.apiKey?.trim()
          if (!providedKey) return { type: "failed" as const }

          const preset = inputs?.modelPreset === "all" || inputs?.modelPreset === "existing"
            ? inputs.modelPreset
            : "recommended"
          const nextEnabledModels = await resolveEnabledModelsForPreset(providedKey, preset)
          persistEnabledModels(nextEnabledModels)

          return {
            type: "success" as const,
            key: providedKey,
          }
        },
      }],
      loader: async (auth) => {
        const stored = await auth()
        return isObject(stored) && stored.type === "api" && typeof stored.key === "string"
          ? { apiKey: stored.key }
          : {}
      },
    },

    config: async (config: { provider?: Record<string, unknown> }) => {
      config.provider ??= {}
      config.provider[PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Telnyx",
        options: {
          baseURL: OPENAI_BASE,
          ...(key ? { apiKey: key } : {}),
        },
        models,
      }
    },

    "chat.message": async (input: { sessionID: string; model?: { providerID?: string; modelID?: string }; variant?: string }) => {
      if (input.model?.providerID !== PROVIDER_ID) return
      if (input.variant) sessionVariants.set(input.sessionID, input.variant)
      else sessionVariants.delete(input.sessionID)
    },

    "chat.params": async (
      input: { model?: { providerID?: string; modelID?: string; id?: string; options?: { enable_thinking?: boolean } }; sessionID: string },
      output: { maxOutputTokens?: number; options?: Record<string, unknown> },
    ) => {
      if (input.model?.providerID !== PROVIDER_ID) return
      output.maxOutputTokens = undefined
      const variant = sessionVariants.get(input.sessionID)
      if (variant === "no-thinking") {
        output.options ??= {}
        output.options.enable_thinking = false
      }

      const modelId = input.model?.modelID ?? input.model?.id
      const rawModelId = modelId?.startsWith(`${PROVIDER_ID}/`)
        ? modelId.slice(PROVIDER_ID.length + 1)
        : modelId
      if (rawModelId) {
        const issue = knownUnsafeModelReason(rawModelId)
        if (issue) {
          console.warn(
            `[telnyx] ⚠ Known issue with ${rawModelId}: ${issue}. ` +
            `If you encounter corrupted tool-call output while streaming, this is likely the cause.`,
          )
        }
      }
    },
  }
}

export default TelnyxAuthPlugin
