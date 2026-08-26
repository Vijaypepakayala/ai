import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import {
  createVoiceMonitorService,
  DEFAULT_MAX_DISCOVERY_CONNECTIONS,
  DEFAULT_MAX_PAGE_SIZE,
  DEFAULT_MAX_RECORDING_WINDOW_HOURS,
  DEFAULT_MAX_TIMELINE_WINDOW_HOURS
} from "./service.js";
import { TelnyxVoiceMonitorClient, sanitizeError, sanitizeVoiceMonitorValue } from "./telnyxClient.js";
import type { VoiceMonitorService } from "./service.js";
import { VOICE_MONITOR_UI_HTML } from "./ui.js";

const UI_RESOURCE_URI = "ui://voice-monitor/index.html";
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

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
  const server = new McpServer({
    name: "telnyx-voice-monitor",
    version: "0.1.0"
  });

  registerReadTool(
    server,
    "voice_monitor_dashboard",
    "Open Voice Monitor",
    "Open a single read-only Telnyx voice monitor workspace with preloaded dropdowns, active calls, call timelines, status lookup, and recording search.",
    pagingSchema,
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
    async (service, input) => service.listOptions({ pageNumber: input.page_number, pageSize: input.page_size })
  );

  registerReadTool(
    server,
    "voice_monitor_active_calls",
    "List active calls",
    "List active calls for a selected Call Control Application ID. If omitted, discovers a bounded set of call-control applications and queries each; it never assumes a global active-calls endpoint.",
    {
      connection_id: optionalString.describe("Optional Telnyx Call Control Application ID accepted by the active-calls endpoint. Prefer selecting from the dashboard dropdown."),
      max_connections: z.number().int().positive().optional().describe("When connection_id is omitted, cap how many discovered connections are queried."),
      ...pagingSchema
    },
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
      description: "Interactive read-only Telnyx voice monitor with option discovery dropdowns, active calls, call timelines, status lookup, and recording search."
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: VOICE_MONITOR_UI_HTML
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
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: uiResourceUri ? { resourceUri: uiResourceUri } : { visibility: ["app"] } }
    },
    async (input: ToolInput<T>, extra: AuthBearingExtra) => {
      const service = createLiveService(extra);
      if (!service) return missingApiKeyResult();
      try {
        return toolResult(await run(service, input));
      } catch (error) {
        return safeToolError(error);
      }
    }
  );
}

type AuthBearingExtra = { authInfo?: { token?: string } };

function createLiveService(extra?: AuthBearingExtra): VoiceMonitorService | undefined {
  const apiKey = extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
  if (!apiKey) return undefined;
  const client = new TelnyxVoiceMonitorClient({ apiKey, baseUrl: process.env.TELNYX_API_BASE_URL });
  return createVoiceMonitorService(client, {
    maxPageSize: envNumber("VOICE_MONITOR_MAX_PAGE_SIZE", DEFAULT_MAX_PAGE_SIZE),
    maxDiscoveryConnections: envNumber("VOICE_MONITOR_MAX_DISCOVERY_CONNECTIONS", DEFAULT_MAX_DISCOVERY_CONNECTIONS),
    maxTimelineWindowHours: envNumber("VOICE_MONITOR_MAX_TIMELINE_WINDOW_HOURS", DEFAULT_MAX_TIMELINE_WINDOW_HOURS),
    maxRecordingWindowHours: envNumber("VOICE_MONITOR_MAX_RECORDING_WINDOW_HOURS", DEFAULT_MAX_RECORDING_WINDOW_HOURS)
  });
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toolResult(result: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  const structuredContent = asStructuredContent(sanitizeVoiceMonitorValue(result));
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
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

function safeToolError(error: unknown): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return { isError: true, content: [{ type: "text", text: sanitizeError(error).message }] };
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
