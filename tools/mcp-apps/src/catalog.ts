import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createServer as createNumberIntelligenceServer } from "../apps/number-intelligence/src/server.js";
import { createServer as createVoiceMonitorServer } from "../apps/voice-monitor/src/server.js";

export type McpAppSlug = "number-intelligence" | "voice-monitor";

export interface McpAppDefinition {
  slug: McpAppSlug;
  name: string;
  description: string;
  endpoint: string;
  createServer: () => McpServer;
}

export const MCP_PUBLIC_DISCOVERY_METHODS = [
  "initialize",
  "notifications/initialized",
  "notifications/cancelled",
  "ping",
  "tools/list",
  "resources/list",
  "resources/read"
] as const;

export const MCP_AUTH_REQUIRED_METHODS = ["tools/call"] as const;

export const MCP_STREAMABLE_HTTP_DISCOVERY = {
  transport: "streamable-http",
  requiredAccept: ["application/json", "text/event-stream"],
  sessionHeader: "mcp-session-id",
  publicMethods: MCP_PUBLIC_DISCOVERY_METHODS,
  authRequiredMethods: MCP_AUTH_REQUIRED_METHODS
} as const;

export const MCP_APP_DEFINITIONS: readonly McpAppDefinition[] = [
  {
    slug: "number-intelligence",
    name: "Number Intelligence",
    description: "Phone-number analysis using Telnyx Number Lookup and read-first readiness signals.",
    endpoint: "/apps/number-intelligence/mcp",
    createServer: createNumberIntelligenceServer
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
  endpointPath: string;
  endpointUrl?: string;
  discovery: typeof MCP_STREAMABLE_HTTP_DISCOVERY;
}

export interface PublicMcpAppListOptions {
  publicOrigin?: string;
  publicPathPrefix?: string;
}

export function listPublicApps(options: PublicMcpAppListOptions = {}): PublicMcpAppInfo[] {
  return MCP_APP_DEFINITIONS.map(({ slug, name, description, endpoint }) => {
    const endpointPath = joinPublicPath(options.publicPathPrefix, endpoint);
    return {
      slug,
      name,
      description,
      endpoint,
      endpointPath,
      ...(options.publicOrigin ? { endpointUrl: new URL(endpointPath, options.publicOrigin).toString() } : {}),
      discovery: MCP_STREAMABLE_HTTP_DISCOVERY
    };
  });
}

export function findMcpApp(slug: string): McpAppDefinition | undefined {
  return MCP_APP_DEFINITIONS.find((app) => app.slug === slug);
}

function joinPublicPath(prefix: string | undefined, path: string): string {
  const normalizedPrefix = normalizePathPrefix(prefix);
  return `${normalizedPrefix}${path}`;
}

function normalizePathPrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const trimmed = prefix.trim();
  if (!trimmed || /[\\?#\u0000-\u001f\u007f]/.test(trimmed)) return "";

  const withoutBoundarySlashes = trimmed.replace(/^\/+|\/+$/g, "");
  if (!withoutBoundarySlashes) return "";

  const segments = withoutBoundarySlashes.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._~-]+$/.test(segment)
    )
  ) {
    return "";
  }
  return `/${segments.join("/")}`;
}
