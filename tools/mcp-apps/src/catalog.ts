import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createServer as createNumberIntelligenceServer } from "../apps/number-intelligence/src/server.js";
import { createServer as createUsageCostExplorerServer } from "../apps/usage-cost-explorer/src/server.js";
import { createServer as createVoiceMonitorServer } from "../apps/voice-monitor/src/server.js";

export type McpAppSlug = "number-intelligence" | "usage-cost-explorer" | "voice-monitor";

export interface McpAppDefinition {
  slug: McpAppSlug;
  name: string;
  description: string;
  endpoint: string;
  createServer: () => McpServer;
}

export const MCP_APP_DEFINITIONS: readonly McpAppDefinition[] = [
  {
    slug: "number-intelligence",
    name: "Number Intelligence",
    description: "Phone-number analysis using Telnyx Number Lookup and read-first readiness signals.",
    endpoint: "/apps/number-intelligence/mcp",
    createServer: createNumberIntelligenceServer
  },
  {
    slug: "usage-cost-explorer",
    name: "Usage & Cost Explorer",
    description: "Balance, usage reports, billing groups, and guarded billing controls.",
    endpoint: "/apps/usage-cost-explorer/mcp",
    createServer: createUsageCostExplorerServer
  },
  {
    slug: "voice-monitor",
    name: "Voice Monitor",
    description: "Read-only active-call monitoring, call timelines, call status, and recording discovery.",
    endpoint: "/apps/voice-monitor/mcp",
    createServer: createVoiceMonitorServer
  }
] as const;

export interface PublicMcpAppInfo {
  slug: McpAppSlug;
  name: string;
  description: string;
  endpoint: string;
}

export function listPublicApps(): PublicMcpAppInfo[] {
  return MCP_APP_DEFINITIONS.map(({ slug, name, description, endpoint }) => ({ slug, name, description, endpoint }));
}

export function findMcpApp(slug: string): McpAppDefinition | undefined {
  return MCP_APP_DEFINITIONS.find((app) => app.slug === slug);
}
