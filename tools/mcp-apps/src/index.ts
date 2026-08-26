import { serve } from "@hono/node-server";

import { listPublicApps } from "./catalog.js";
import { createHostedMcpAppsHttpApp } from "./http.js";

export { MCP_APP_DEFINITIONS, listPublicApps } from "./catalog.js";
export { createHostedMcpAppsHttpApp } from "./http.js";

export function getPort(): number {
  const raw = process.env.PORT ?? process.env.MCP_APPS_PORT ?? "8080";
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : 8080;
}

async function main(): Promise<void> {
  const port = getPort();
  const app = createHostedMcpAppsHttpApp();
  serve({ fetch: app.fetch, port });

  const endpoints = listPublicApps().map((entry) => entry.endpoint).join(", ");
  console.log(`mcp-apps HTTP service listening on :${port}`);
  console.log(`health: /health; ready: /readyz; apps: /apps; mcp: ${endpoints}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
