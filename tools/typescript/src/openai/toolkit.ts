/**
 * OpenAI function-calling adapter for the Telnyx Agent Toolkit.
 */

import { createHash } from "node:crypto";

import type { ToolDefinition } from "../shared/constants.js";
import type { ToolkitCore } from "../shared/toolkit-core.js";

export interface OpenAIToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIPromptCacheKeyOptions {
  namespace: string;
  model: string;
  workflow?: string;
  version?: string;
  toolNames?: string[];
}

export interface OpenAIOrchestrationTelemetry extends Record<string, unknown> {
  model?: string;
  response_id?: string;
  cache_key?: string;
  cache_key_hash?: string;
  input_tokens: number;
  cached_tokens: number;
  uncached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cache_hit_rate: number | null;
  latency_ms?: number;
}

export interface ReportOpenAIOrchestrationOptions {
  cacheKey?: string;
  latencyMs?: number;
  apiPath?: string;
  status?: "success" | "error";
  httpStatus?: number;
  errorMessage?: string;
}

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

type ResponseLike = {
  id?: string;
  model?: string;
  usage?: UsageLike;
};

function normalizeCacheKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashCacheKey(cacheKey: string): string {
  return createHash("sha256").update(cacheKey).digest("hex").slice(0, 16);
}

export class OpenAIToolkit {
  private readonly core: ToolkitCore;
  private readonly tools: ToolDefinition[];

  constructor(core: ToolkitCore, tools: ToolDefinition[]) {
    this.core = core;
    this.tools = tools;
  }

  /**
   * Get tool definitions formatted for OpenAI's `tools` parameter.
   */
  getTools(): Record<string, unknown>[] {
    return this.tools.map((toolDef) => {
      const properties = toolDef.parameters.properties;

      // Clean up properties for OpenAI (remove defaults from schema)
      const cleanProps: Record<string, Record<string, unknown>> = {};
      for (const [propName, propSchema] of Object.entries(properties)) {
        const cleanProp: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(propSchema)) {
          if (k !== "default") {
            cleanProp[k] = v;
          }
        }
        cleanProps[propName] = cleanProp;
      }

      return {
        type: "function",
        function: {
          name: toolDef.name,
          description: toolDef.description,
          parameters: {
            type: "object",
            properties: cleanProps,
            required: toolDef.parameters.required,
          },
        },
      };
    });
  }

  /**
   * Execute an OpenAI tool call and return the result as a string.
   */
  async execute(toolCall: OpenAIToolCall): Promise<string> {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments) as Record<
      string,
      unknown
    >;
    return this.core.runTool(name, args);
  }

  buildPromptCacheKey(options: OpenAIPromptCacheKeyOptions): string {
    const parts = [
      normalizeCacheKeyPart(options.namespace),
      normalizeCacheKeyPart(options.workflow ?? "chat-completions"),
      normalizeCacheKeyPart(options.model),
      normalizeCacheKeyPart(options.version ?? "v1"),
    ];

    if (options.toolNames && options.toolNames.length > 0) {
      const toolFingerprint = options.toolNames
        .map(normalizeCacheKeyPart)
        .sort()
        .join(",");
      parts.push(`tools=${toolFingerprint}`);
    }

    return parts.filter(Boolean).join(":");
  }

  extractOrchestrationTelemetry(
    response: ResponseLike,
    options: Pick<ReportOpenAIOrchestrationOptions, "cacheKey" | "latencyMs"> = {},
  ): OpenAIOrchestrationTelemetry {
    const usage = response.usage ?? {};
    const inputTokens = usage.prompt_tokens ?? 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;
    const reasoningTokens =
      usage.completion_tokens_details?.reasoning_tokens ?? 0;
    const totalTokens =
      usage.total_tokens ?? inputTokens + outputTokens;
    const uncachedInputTokens = Math.max(inputTokens - cachedTokens, 0);
    const cacheHitRate =
      inputTokens > 0 ? Number((cachedTokens / inputTokens).toFixed(4)) : null;

    return {
      model: response.model,
      response_id: response.id,
      cache_key: options.cacheKey,
      cache_key_hash: options.cacheKey ? hashCacheKey(options.cacheKey) : undefined,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      uncached_input_tokens: uncachedInputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: totalTokens,
      cache_hit_rate: cacheHitRate,
      latency_ms: options.latencyMs,
    };
  }

  reportOrchestrationTelemetry(
    response: ResponseLike,
    options: ReportOpenAIOrchestrationOptions = {},
  ): OpenAIOrchestrationTelemetry {
    const summary = this.extractOrchestrationTelemetry(response, options);
    this.core.reportTelemetryEvent({
      tool: "openai_orchestration",
      status: options.status ?? "success",
      duration_ms: options.latencyMs ?? 0,
      http_status: options.httpStatus ?? 200,
      http_method: "POST",
      api_path: options.apiPath ?? "/openai/chat.completions",
      ...(options.errorMessage ? { error_message: options.errorMessage } : {}),
      context: summary,
    });
    return summary;
  }
}
