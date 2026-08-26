import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { analyzeBatchNumbers, analyzeNumber } from "./service.js";
import { TelnyxReadOnlyClient } from "./telnyxClient.js";
import type { AnalyzeNumberDeps, NumberIntelligenceSourceId } from "./types.js";
import { NUMBER_INTELLIGENCE_UI_HTML } from "./ui.js";

const TOOL_NAME = "number_intelligence_analyze";
const BATCH_TOOL_NAME = "number_intelligence_batch_analyze";
const UI_RESOURCE_URI = "ui://number-intelligence/index.html";
const SOURCE_IDS = ["lookup", "owned", "portability", "messaging", "voice", "reputation"] as const;
const DEFAULT_SAFE_SOURCES: NumberIntelligenceSourceId[] = ["owned", "messaging", "voice"];
const MAX_BATCH_SIZE = 25;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telnyx-number-intelligence",
    version: "0.2.0"
  });

  const envIncludeRawDefault = process.env.NUMBER_INTELLIGENCE_INCLUDE_RAW === "true";

  registerAppTool(
    server,
    TOOL_NAME,
    {
      title: "Analyze phone number",
      description:
        "Read-first Number Intelligence summary using Telnyx Number Lookup plus safe owned-number, messaging, and voice enrichment by default. Portability and cached reputation are opt-in; reputation is always fresh=false.",
      inputSchema: {
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
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } }
    },
    async ({ phone_number, include_raw, sources }, extra) => {
      const deps = createLiveDeps(extra);
      if (!deps) {
        return missingApiKeyResult();
      }

      const result = await analyzeNumber(
        {
          phone_number,
          include_raw: include_raw ?? envIncludeRawDefault,
          sources
        },
        deps
      );

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>
      };
    }
  );

  registerAppTool(
    server,
    BATCH_TOOL_NAME,
    {
      title: "Batch analyze phone numbers",
      description:
        "Read-first batch Number Intelligence for pasted CSV/newline input. Runs sequentially, caps batch size, redacts outputs, and never performs mutating Telnyx calls.",
      inputSchema: {
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
      _meta: { ui: { resourceUri: UI_RESOURCE_URI } }
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
          { maxBatchSize: MAX_BATCH_SIZE }
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>
        };
      } catch (error) {
        const batchError = error instanceof Error ? error : new Error(String(error));
        return {
          isError: true,
          content: [{ type: "text", text: batchError.message }]
        };
      }
    }
  );

  registerAppResource(
    server,
    "Number Intelligence UI",
    UI_RESOURCE_URI,
    {
      description:
        "Interactive summary for phone-number analysis: carrier, line type, ownership/configuration readiness, cached reputation, batch aggregates, and recommended actions."
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: NUMBER_INTELLIGENCE_UI_HTML
        }
      ]
    })
  );

  return server;
}

type AuthBearingExtra = { authInfo?: { token?: string } };

function createLiveDeps(extra?: AuthBearingExtra): AnalyzeNumberDeps | undefined {
  const apiKey = extra?.authInfo?.token ?? process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const client = new TelnyxReadOnlyClient({
    apiKey,
    baseUrl: process.env.TELNYX_API_BASE_URL
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

async function main(): Promise<void> {
  await import("dotenv/config");
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
