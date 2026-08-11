import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { AppMcpServer } from "./appToolMetadata.js";
import { analyzeBatchNumbers, analyzeNumber } from "./service.js";
import { sanitizeError, TelnyxReadOnlyClient } from "./telnyxClient.js";
import type { AnalyzeNumberDeps, NumberIntelligenceSourceId } from "./types.js";
import { NUMBER_INTELLIGENCE_UI_HTML } from "./ui.js";

const TOOL_NAME = "number_intelligence_analyze";
const BATCH_TOOL_NAME = "number_intelligence_batch_analyze";
const UI_RESOURCE_URI = "ui://number-intelligence/index.html";
const UI_RESOURCE_DOMAIN = "https://telnyx-developer-kit.telnyx.com";
const INTERNAL_HTTP_STATUS_META_KEY = "telnyx/internal-http-status";
const SOURCE_IDS = ["lookup", "owned", "portability", "messaging", "voice", "reputation"] as const;
const DEFAULT_SAFE_SOURCES: NumberIntelligenceSourceId[] = ["owned", "messaging", "voice"];
const MAX_BATCH_SIZE = 25;
const MAX_TOOL_RESULT_BYTES = 1024 * 1024;
const MAX_BATCH_TOOL_OUTPUT_BYTES = MAX_TOOL_RESULT_BYTES - 1024;
const TOOL_OUTPUT_LIMIT_ERROR =
  "Tool output exceeded the safe size limit. Narrow the request and try again.";
const UI_RESOURCE_CSP = {
  connectDomains: [],
  resourceDomains: [],
  frameDomains: []
};
const UI_RESOURCE_META = {
  ui: {
    domain: UI_RESOURCE_DOMAIN,
    csp: UI_RESOURCE_CSP
  }
};
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);
const numberIntelligenceSignalSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["info", "warning", "action_required"]),
  detail: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
});
const recommendedActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  rationale: z.string(),
  href: z.string().optional(),
  tool_hint: z.string().optional()
});
const numberIntelligenceSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["consulted", "unavailable", "error"]),
  detail: z.string().optional()
});
const numberIntelligenceResultSchema = z.object({
  input: z.object({ phone_number: z.string() }),
  normalized: z.object({
    e164: z.string(),
    e164_validated: z.boolean(),
    national_format: z.string().optional()
  }),
  display: z.object({
    redacted: z.string(),
    label: z.string()
  }),
  summary: z.object({
    type: z.string(),
    carrier: z.string(),
    country: z.string(),
    ownership: z.string(),
    portability: z.string(),
    messaging: z.string(),
    voice: z.string(),
    reputation: z.string()
  }),
  health: z.object({
    status: z.enum(["good", "warning", "bad", "unknown"]),
    score: z.number(),
    rationale: z.string()
  }),
  signals: z.array(numberIntelligenceSignalSchema),
  recommended_actions: z.array(recommendedActionSchema),
  sources: z.array(numberIntelligenceSourceSchema),
  raw: z
    .object({
      telnyx_number_lookup: z
        .object({
          data: z
            .object({
              phone_number: z.string().nullable().optional(),
              national_format: z.string().nullable().optional(),
              country_code: z.string().nullable().optional(),
              carrier: z
                .object({
                  name: z.string().nullable().optional(),
                  type: z.string().nullable().optional(),
                  mobile_country_code: z.string().nullable().optional(),
                  mobile_network_code: z.string().nullable().optional(),
                  error_code: z.string().nullable().optional()
                })
                .catchall(jsonValueSchema)
                .nullable()
                .optional(),
              caller_name: z
                .object({
                  caller_name: z.string().nullable().optional(),
                  error_code: z.string().nullable().optional()
                })
                .catchall(jsonValueSchema)
                .nullable()
                .optional()
            })
            .catchall(jsonValueSchema)
        })
        .catchall(jsonValueSchema)
    })
    .optional()
});
const numberIntelligenceBatchResultSchema = z.object({
  requested_total: z.number().int().nonnegative(),
  queried_total: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
  aggregate: z.object({
    health_status_counts: z.object({
      good: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      bad: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative()
    }),
    action_required_count: z.number().int().nonnegative()
  }),
  results: z.array(numberIntelligenceResultSchema)
});
const BILLABLE_LOOKUP_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
};
const SERVER_INSTRUCTIONS =
  "Use Streamable HTTP with Accept: application/json, text/event-stream and preserve Mcp-Session-Id. Discovery and UI resource reads do not require a user Telnyx credential; tools/call requires authenticated Telnyx access resolved by the hosting MCP service.";

export interface NumberIntelligenceServerOptions {
  /** Expose the hosted connector OAuth contract. Stdio uses TELNYX_API_KEY instead. */
  hostedOAuthMetadata?: boolean;
}

export function createServer(
  options: NumberIntelligenceServerOptions = {}
): McpServer {
  const server = new AppMcpServer(
    {
      name: "telnyx-number-intelligence",
      version: "0.2.0"
    },
    { instructions: SERVER_INSTRUCTIONS },
    options.hostedOAuthMetadata === true
  );

  const envIncludeRawDefault = process.env.NUMBER_INTELLIGENCE_INCLUDE_RAW === "true";

  registerAppTool(
    server,
    TOOL_NAME,
    {
      title: "Analyze phone number",
      description:
        "Billable Number Intelligence summary. Each call requires confirm_billable_lookup=true, performs one Telnyx Number Lookup that can incur lookup charges and affect account balance, then adds safe owned-number, messaging, and voice enrichment by default. Selected enrichments can make additional Telnyx API requests. The tool does not create, change, or delete phone-number resources. Portability and cached reputation are opt-in; reputation is always fresh=false.",
      annotations: BILLABLE_LOOKUP_ANNOTATIONS,
      outputSchema: numberIntelligenceResultSchema,
      inputSchema: {
        confirm_billable_lookup: z
          .literal(true)
          .describe(
            "Required confirmation that the user understands this request performs one billable Telnyx Number Lookup."
          ),
        phone_number: z.string().min(1).describe("Phone number to analyze. E.164 is preferred."),
        include_raw: z
          .boolean()
          .optional()
          .describe("Include redacted raw Telnyx Number Lookup response. Overrides NUMBER_INTELLIGENCE_INCLUDE_RAW."),
        sources: z
          .array(z.enum(SOURCE_IDS))
          .optional()
          .describe(
            "Optional source selection. Omit for safe defaults: owned, messaging, voice. Add portability for eligibility POST or reputation for cached fresh=false reputation."
          )
      },
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI, visibility: ["app"] }
      }
    },
    async ({ phone_number, include_raw, sources }, extra) => {
      const deps = createLiveDeps(extra);
      if (!deps) {
        return missingApiKeyResult();
      }

      try {
        const result = await analyzeNumber(
          {
            phone_number,
            include_raw: include_raw ?? envIncludeRawDefault,
            sources
          },
          deps
        );

        return toolResult(result, numberIntelligenceResultSchema);
      } catch (error) {
        return safeToolError(error);
      }
    }
  );

  registerAppTool(
    server,
    BATCH_TOOL_NAME,
    {
      title: "Batch analyze phone numbers",
      description:
        "Billable batch Number Intelligence for pasted CSV/newline input. Each call requires confirm_billable_lookup=true; each unique accepted number performs one Telnyx Number Lookup that can incur lookup charges and affect account balance, and selected enrichments can make additional Telnyx API requests. Runs sequentially, caps the batch at 25 and output near 1 MiB, reports partial output explicitly, redacts outputs, and does not create, change, or delete phone-number resources.",
      annotations: BILLABLE_LOOKUP_ANNOTATIONS,
      outputSchema: numberIntelligenceBatchResultSchema,
      inputSchema: {
        confirm_billable_lookup: z
          .literal(true)
          .describe(
            "Required confirmation that the user approves up to one billable Telnyx Number Lookup per unique accepted number, capped at 25."
          ),
        numbers: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .describe("Phone numbers as pasted CSV/newline text or an array of strings. First CSV column is used."),
        include_raw: z
          .boolean()
          .optional()
          .describe("Include redacted raw Number Lookup responses for each result. Defaults to false/env setting."),
        sources: z
          .array(z.enum(SOURCE_IDS))
          .optional()
          .describe("Optional source selection. Omit for safe defaults: owned, messaging, voice.")
      },
      _meta: {
        ui: { resourceUri: UI_RESOURCE_URI, visibility: ["app"] }
      }
    },
    async ({ numbers, include_raw, sources }, extra) => {
      const deps = createLiveDeps(extra);
      if (!deps) {
        return missingApiKeyResult();
      }

      try {
        const result = await analyzeBatchNumbers(
          {
            numbers,
            include_raw: include_raw ?? envIncludeRawDefault,
            sources
          },
          deps,
          { maxBatchSize: MAX_BATCH_SIZE, maxOutputBytes: MAX_BATCH_TOOL_OUTPUT_BYTES }
        );

        return toolResult(result, numberIntelligenceBatchResultSchema);
      } catch (error) {
        return safeToolError(error);
      }
    }
  );

  registerAppResource(
    server,
    "Number Intelligence UI",
    UI_RESOURCE_URI,
    {
      description:
        "Interactive summary for phone-number analysis: carrier, line type, ownership/configuration readiness, cached reputation, batch aggregates, and recommended actions.",
      _meta: UI_RESOURCE_META
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: NUMBER_INTELLIGENCE_UI_HTML,
          _meta: UI_RESOURCE_META
        }
      ]
    })
  );

  return server;
}

function toolResult(
  result: object,
  outputSchema: z.ZodType
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const structuredContent = outputSchema.parse(result) as Record<string, unknown>;
  const compactText = JSON.stringify(structuredContent);
  const fullResult = {
    content: [{ type: "text" as const, text: compactText }],
    structuredContent
  };
  if (serializedBytes(fullResult) <= MAX_TOOL_RESULT_BYTES) return fullResult;

  const structuredOnlyResult = {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ notice: "The full result is available in structuredContent." })
      }
    ],
    structuredContent
  };
  if (serializedBytes(structuredOnlyResult) <= MAX_TOOL_RESULT_BYTES) return structuredOnlyResult;
  throw new Error(TOOL_OUTPUT_LIMIT_ERROR);
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

type AuthBearingExtra = { authInfo?: { token?: string }; signal?: AbortSignal };

function createLiveDeps(extra?: AuthBearingExtra): AnalyzeNumberDeps | undefined {
  const apiKey = extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const client = new TelnyxReadOnlyClient({
    apiKey,
    baseUrl: process.env.TELNYX_API_BASE_URL,
    signal: extra?.signal
  });

  return {
    lookupClient: client,
    sources: {
      owned: client,
      portability: client,
      messaging: client,
      voice: client,
      reputation: client
    },
    defaultSources: DEFAULT_SAFE_SOURCES
  };
}

function missingApiKeyResult(): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "TELNYX_API_KEY is not set. Provide a read-only Telnyx API key to run live Number Intelligence."
      }
    ]
  };
}

function safeToolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, number>;
} {
  const status = telnyxAuthStatus(error);
  const text =
    status === 401
      ? "Telnyx authentication failed. Reconnect or provide a valid Telnyx credential."
      : status === 403
        ? "The Telnyx credential does not have permission to perform this lookup."
        : sanitizeError(error).message;
  return {
    isError: true,
    content: [{ type: "text", text }],
    ...(status ? { _meta: { [INTERNAL_HTTP_STATUS_META_KEY]: status } } : {})
  };
}

function telnyxAuthStatus(error: unknown): 401 | 403 | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : undefined;
}

async function main(): Promise<void> {
  await import("dotenv/config");
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
