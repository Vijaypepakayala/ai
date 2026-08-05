import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { AppMcpServer } from "./appToolMetadata.js";
import {
  createVoiceMonitorService,
  DEFAULT_MAX_AGGREGATE_OUTPUT_BYTES,
  DEFAULT_MAX_DISCOVERY_CONNECTIONS,
  DEFAULT_MAX_PAGE_SIZE,
  DEFAULT_MAX_RECORDING_WINDOW_HOURS,
  DEFAULT_MAX_TIMELINE_WINDOW_HOURS
} from "./service.js";
import { TelnyxVoiceMonitorClient, sanitizeError, sanitizeVoiceMonitorValue } from "./telnyxClient.js";
import type { VoiceMonitorService } from "./service.js";
import { VOICE_MONITOR_UI_HTML } from "./ui.js";

const UI_RESOURCE_URI = "ui://voice-monitor/index.html";
const UI_RESOURCE_DOMAIN = "https://telnyx-developer-kit.telnyx.com";
const INTERNAL_HTTP_STATUS_META_KEY = "telnyx/internal-http-status";
const MAX_TOOL_RESULT_BYTES = DEFAULT_MAX_AGGREGATE_OUTPUT_BYTES;
const MAX_ACTIVE_CALL_TOOL_OUTPUT_BYTES = MAX_TOOL_RESULT_BYTES - 1024;
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
const responseMetaSchema = z
  .object({
    page_number: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
    total_pages: z.number().int().nonnegative().optional(),
    total_results: z.number().int().nonnegative().optional(),
    next_page_url: z.string().nullable().optional(),
    previous_page_url: z.string().nullable().optional()
  })
  .catchall(jsonValueSchema);
const optionalScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
const voiceRecordSchema = z
  .object({
    id: z.string().optional(),
    record_type: z.string().optional(),
    connection_id: z.string().optional(),
    call_control_id: z.string().optional(),
    call_leg_id: z.string().optional(),
    call_session_id: z.string().optional(),
    application_session_id: z.string().optional(),
    leg_id: z.string().optional(),
    conference_id: z.string().optional(),
    queue_name: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    direction: z.string().optional(),
    status: z.string().optional(),
    state: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    product: z.string().optional(),
    failed: z.boolean().optional(),
    occurred_at: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
    duration_millis: z.number().optional(),
    hangup_cause: z.string().optional(),
    hangup_source: z.string().optional(),
    sip_hangup_cause: z.string().optional(),
    recording_url: z.string().optional(),
    download_url: z.string().optional(),
    transcript: z.string().optional(),
    metadata: z.string().optional(),
    authorization: z.string().optional(),
    value: optionalScalarSchema
  })
  .catchall(jsonValueSchema);
const appliedFiltersSchema = z.object({
  call_control_id: z.string().optional(),
  call_leg_id: z.string().optional(),
  call_session_id: z.string().optional(),
  application_session_id: z.string().optional(),
  connection_id: z.string().optional(),
  product: z.string().optional(),
  failed: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  occurred_at_eq: z.string().optional(),
  occurred_at_gt: z.string().optional(),
  occurred_at_gte: z.string().optional(),
  occurred_at_lt: z.string().optional(),
  occurred_at_lte: z.string().optional(),
  created_at_gte: z.string().optional(),
  created_at_lte: z.string().optional(),
  page_number: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional()
});
const warningSchema = z.object({
  source: z.string(),
  message: z.string()
});
const discoveryOptionSchema = z.object({
  kind: z.enum(["connection", "call_control_application", "voice_number"]),
  label: z.string(),
  value: z.string(),
  description: z.string().optional(),
  active: z.boolean().optional(),
  connection_id: z.string().optional(),
  associated_number_count: z.number().int().nonnegative().optional()
});
const listOptionsResultSchema = z.object({
  options: z.object({
    connections: z.array(discoveryOptionSchema),
    call_control_applications: z.array(discoveryOptionSchema),
    active_call_targets: z.array(discoveryOptionSchema),
    voice_numbers: z.array(discoveryOptionSchema)
  }),
  summary: z.object({
    connection_count: z.number().int().nonnegative(),
    call_control_application_count: z.number().int().nonnegative(),
    voice_number_count: z.number().int().nonnegative()
  }),
  warnings: z.array(warningSchema),
  limits: z.object({
    page_size: z.number().int().positive(),
    max_discovery_connections: z.number().int().positive()
  })
});
const activeCallSchema = voiceRecordSchema;
const activeCallsResultSchema = z.object({
  connections_consulted: z.array(z.string()),
  truncated_connections: z.boolean(),
  truncated_output: z.boolean(),
  total_active_calls: z.number().int().nonnegative(),
  active_calls: z.array(activeCallSchema),
  per_connection: z.array(
    z.object({
      connection_id: z.string(),
      active_call_count: z.number().int().nonnegative()
    })
  ),
  warnings: z.array(warningSchema),
  limits: z.object({
    page_size: z.number().int().positive(),
    max_connections: z.number().int().positive(),
    max_output_bytes: z.number().int().positive()
  })
});
const dashboardResultSchema = z.object({
  options: listOptionsResultSchema,
  active_calls: activeCallsResultSchema
});
const callTimelineResultSchema = z.object({
  data: z.array(voiceRecordSchema).optional(),
  meta: responseMetaSchema.optional(),
  filters_notice: z.string().optional(),
  applied_filters: appliedFiltersSchema
});
const callStatusResultSchema = z.object({
  data: voiceRecordSchema.optional(),
  meta: responseMetaSchema.optional()
});
const recordingsResultSchema = z.object({
  data: z.array(voiceRecordSchema).optional(),
  meta: responseMetaSchema.optional(),
  applied_filters: appliedFiltersSchema
});
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const SERVER_INSTRUCTIONS =
  "Use Streamable HTTP with Accept: application/json, text/event-stream and preserve Mcp-Session-Id. Discovery and UI resource reads do not require a user Telnyx credential; tools/call requires authenticated Telnyx access resolved by the hosting MCP service.";

const pagingSchema = {
  page_number: z.number().int().positive().optional().describe("1-based page number. Defaults to 1."),
  page_size: z.number().int().positive().optional().describe(`Page size. Defaults conservatively and is capped at ${DEFAULT_MAX_PAGE_SIZE}.`)
};
const optionalString = z.string().trim().min(1).optional();
const timeFilterSchema = {
  occurred_at_gte: optionalString.describe("Optional ISO start time (inclusive)."),
  occurred_at_lte: optionalString.describe("Optional ISO end time (inclusive).")
};

export function createServer(): McpServer {
  const server = new AppMcpServer(
    {
      name: "telnyx-voice-monitor",
      version: "0.1.0"
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  registerReadTool(
    server,
    "voice_monitor_dashboard",
    "Open Voice Monitor",
    "Open a single read-only Telnyx voice monitor workspace with preloaded dropdowns, active calls, call timelines, status lookup, and recording search.",
    pagingSchema,
    dashboardResultSchema,
    async (service, input) => {
      const options = await service.listOptions({ pageNumber: input.page_number, pageSize: input.page_size });
      const active_calls = await service.activeCalls({ pageNumber: input.page_number, pageSize: input.page_size });
      return { options, active_calls };
    },
    UI_RESOURCE_URI
  );

  registerReadTool(
    server,
    "voice_monitor_list_options",
    "Load Voice Monitor options",
    "Discover app-friendly dropdown options for connections, call-control applications, and voice numbers so users do not need to paste IDs.",
    pagingSchema,
    listOptionsResultSchema,
    async (service, input) => service.listOptions({ pageNumber: input.page_number, pageSize: input.page_size })
  );

  registerReadTool(
    server,
    "voice_monitor_active_calls",
    "List active calls",
    "List active calls for a selected Call Control Application ID. If omitted, discovers a bounded set of call-control applications and queries each; it never assumes a global active-calls endpoint. Aggregate output is capped near 1 MiB, reports truncation explicitly, and stops querying later connections once the cap is reached.",
    {
      connection_id: optionalString.describe("Optional Telnyx Call Control Application ID accepted by the active-calls endpoint. Prefer selecting from the dashboard dropdown."),
      max_connections: z.number().int().positive().optional().describe("When connection_id is omitted, cap how many discovered connections are queried."),
      ...pagingSchema
    },
    activeCallsResultSchema,
    async (service, input) =>
      service.activeCalls({
        connectionId: input.connection_id,
        maxConnections: input.max_connections,
        pageNumber: input.page_number,
        pageSize: input.page_size
      })
  );

  registerReadTool(
    server,
    "voice_monitor_call_timeline",
    "Read call timeline",
    "Read Telnyx GET /call_events with supported filters. Prefer call_leg_id or call_session_id/application_session_id; connection-only searches default to the last 24 hours.",
    {
      call_leg_id: optionalString.describe("Telnyx call leg ID (filter[leg_id])."),
      call_session_id: optionalString.describe("Telnyx call/session ID; mapped to filter[application_session_id] if application_session_id is omitted."),
      application_session_id: optionalString.describe("Telnyx application session ID (filter[application_session_id])."),
      connection_id: optionalString.describe("Optional connection_id, preferably selected from options."),
      product: optionalString,
      failed: z.boolean().optional(),
      from: optionalString,
      to: optionalString,
      name: optionalString,
      type: optionalString,
      status: optionalString,
      occurred_at_eq: optionalString,
      occurred_at_gt: optionalString,
      ...timeFilterSchema,
      occurred_at_lt: optionalString,
      ...pagingSchema
    },
    callTimelineResultSchema,
    async (service, input) =>
      service.callTimeline({
        callLegId: input.call_leg_id,
        callSessionId: input.call_session_id,
        applicationSessionId: input.application_session_id,
        connectionId: input.connection_id,
        product: input.product,
        failed: input.failed,
        from: input.from,
        to: input.to,
        name: input.name,
        type: input.type,
        status: input.status,
        occurredAtEq: input.occurred_at_eq,
        occurredAtGt: input.occurred_at_gt,
        occurredAtGte: input.occurred_at_gte,
        occurredAtLt: input.occurred_at_lt,
        occurredAtLte: input.occurred_at_lte,
        pageNumber: input.page_number,
        pageSize: input.page_size
      })
  );

  registerReadTool(
    server,
    "voice_monitor_call_status",
    "Get call status",
    "Read call status from GET /calls/{call_control_id}. This is read-only and does not issue Call Control commands.",
    {
      call_control_id: z.string().trim().min(1).describe("Telnyx call_control_id to fetch.")
    },
    callStatusResultSchema,
    async (service, input) => service.callStatus({ callControlId: input.call_control_id })
  );

  registerReadTool(
    server,
    "voice_monitor_recordings",
    "Search recordings",
    "Search Telnyx recordings for post-call investigation. Recording URLs, transcripts, and metadata are redacted in output.",
    {
      call_control_id: optionalString,
      call_leg_id: optionalString,
      call_session_id: optionalString,
      connection_id: optionalString,
      ...timeFilterSchema,
      ...pagingSchema
    },
    recordingsResultSchema,
    async (service, input) =>
      service.recordings({
        callControlId: input.call_control_id,
        callLegId: input.call_leg_id,
        callSessionId: input.call_session_id,
        connectionId: input.connection_id,
        occurredAtGte: input.occurred_at_gte,
        occurredAtLte: input.occurred_at_lte,
        pageNumber: input.page_number,
        pageSize: input.page_size
      })
  );

  registerAppResource(
    server,
    "Voice Monitor UI",
    UI_RESOURCE_URI,
    {
      description: "Interactive read-only Telnyx voice monitor with option discovery dropdowns, active calls, call timelines, status lookup, and recording search.",
      _meta: UI_RESOURCE_META
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: VOICE_MONITOR_UI_HTML,
          _meta: UI_RESOURCE_META
        }
      ]
    })
  );

  return server;
}

type ToolShape = Record<string, z.ZodTypeAny>;
type ToolInput<T extends ToolShape> = { [K in keyof T]: z.infer<T[K]> };

function registerReadTool<T extends ToolShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: T,
  outputSchema: z.ZodType,
  run: (service: VoiceMonitorService, input: ToolInput<T>) => Promise<unknown>,
  uiResourceUri?: string
): void {
  (registerAppTool as unknown as (...args: unknown[]) => void)(
    server,
    name,
    {
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ui: {
          ...(uiResourceUri ? { resourceUri: uiResourceUri } : {}),
          visibility: ["app"]
        }
      }
    },
    async (input: ToolInput<T>, extra: AuthBearingExtra) => {
      const service = createLiveService(extra);
      if (!service) return missingApiKeyResult();
      try {
        return toolResult(await run(service, input), outputSchema);
      } catch (error) {
        return safeToolError(error);
      }
    }
  );
}

type AuthBearingExtra = { authInfo?: { token?: string }; signal?: AbortSignal };

function createLiveService(extra?: AuthBearingExtra): VoiceMonitorService | undefined {
  const apiKey = extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
  if (!apiKey) return undefined;
  const client = new TelnyxVoiceMonitorClient({
    apiKey,
    baseUrl: process.env.TELNYX_API_BASE_URL,
    signal: extra?.signal
  });
  return createVoiceMonitorService(client, {
    maxPageSize: envNumber("VOICE_MONITOR_MAX_PAGE_SIZE", DEFAULT_MAX_PAGE_SIZE),
    maxDiscoveryConnections: envNumber("VOICE_MONITOR_MAX_DISCOVERY_CONNECTIONS", DEFAULT_MAX_DISCOVERY_CONNECTIONS),
    maxTimelineWindowHours: envNumber("VOICE_MONITOR_MAX_TIMELINE_WINDOW_HOURS", DEFAULT_MAX_TIMELINE_WINDOW_HOURS),
    maxRecordingWindowHours: envNumber("VOICE_MONITOR_MAX_RECORDING_WINDOW_HOURS", DEFAULT_MAX_RECORDING_WINDOW_HOURS),
    maxAggregateOutputBytes: MAX_ACTIVE_CALL_TOOL_OUTPUT_BYTES
  });
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toolResult(
  result: unknown,
  outputSchema: z.ZodType
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const structuredContent = asStructuredContent(outputSchema.parse(sanitizeVoiceMonitorValue(result)));
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

function asStructuredContent(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  return { result };
}

function missingApiKeyResult(): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "TELNYX_API_KEY is not set. Provide a read-only Telnyx API key with least-privilege voice/call monitoring access to run live Voice Monitor tools."
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
  const message =
    status === 401
      ? "Telnyx authentication failed. Reconnect or provide a valid Telnyx credential."
      : status === 403
        ? "The Telnyx credential does not have permission to access this voice operation."
        : sanitizeError(error).message;
  return {
    isError: true,
    content: [{ type: "text", text: message }],
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
