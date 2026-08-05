import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listPublicApps } from "./catalog.js";
import { createHostedMcpAppsHttpApp } from "./http.js";

export { MCP_APP_DEFINITIONS, listPublicApps } from "./catalog.js";
export { createHostedMcpAppsHttpApp } from "./http.js";

export function getPort(): number {
  const raw = process.env.PORT ?? process.env.MCP_APPS_PORT ?? "8080";
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : 8080;
}

export function getHostname(): string {
  return process.env.MCP_APPS_HOST?.trim() || "0.0.0.0";
}

export function isMainModule(moduleUrl: string, scriptPath: string | undefined): boolean {
  return Boolean(scriptPath) && fileURLToPath(moduleUrl) === resolve(scriptPath!);
}

export function assertSecureStartupConfig(
  hostname: string,
  internalToken: string | undefined,
  allowInsecureLoopback: boolean
): void {
  if (internalToken?.trim()) return;
  if (allowInsecureLoopback && isLoopbackHostname(hostname)) return;
  throw new Error(
    "MCP_APPS_INTERNAL_TOKEN is required unless MCP_APPS_ALLOW_INSECURE_LOOPBACK=true " +
      "and MCP_APPS_HOST is explicitly bound to localhost, 127.0.0.1, or ::1."
  );
}

async function main(): Promise<void> {
  const port = getPort();
  const hostname = getHostname();
  const internalToken = process.env.MCP_APPS_INTERNAL_TOKEN;
  const allowInsecureLoopback = process.env.MCP_APPS_ALLOW_INSECURE_LOOPBACK === "true";
  assertSecureStartupConfig(hostname, internalToken, allowInsecureLoopback);
  const app = createHostedMcpAppsHttpApp({ internalToken, allowInsecureLoopback });
  serve({ fetch: app.fetch, port, hostname });

  const endpoints = listPublicApps().map((entry) => entry.endpoint).join(", ");
  console.log(`mcp-apps HTTP service listening on ${hostname}:${port}`);
  console.log(`health: /health; ready: /readyz; apps: /apps; mcp: ${endpoints}`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
