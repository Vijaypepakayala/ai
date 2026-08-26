import { afterEach, describe, expect, it } from "vitest";

import { createHostedMcpAppsHttpApp } from "./http.js";

const AUTH_SCHEME = "Bearer";
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream"
};
const PROTOCOL_VERSION = "2025-06-18";

describe("hosted MCP Apps HTTP service", () => {
  const oldFetch = globalThis.fetch;
  const oldApiKey = process.env.TELNYX_API_KEY;
  const oldBaseUrl = process.env.TELNYX_API_BASE_URL;

  afterEach(() => {
    globalThis.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = oldApiKey;
    if (oldBaseUrl === undefined) delete process.env.TELNYX_API_BASE_URL;
    else process.env.TELNYX_API_BASE_URL = oldBaseUrl;
  });

  it("serves health, readiness, and catalog endpoints", async () => {
    const app = createHostedMcpAppsHttpApp({ now: () => "2026-05-21T00:00:00.000Z" });

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      service: "mcp-apps",
      time: "2026-05-21T00:00:00.000Z"
    });

    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      status: "ready",
      service: "mcp-apps",
      apps: ["number-intelligence", "usage-cost-explorer", "voice-monitor"]
    });

    const catalog = await app.request("/apps");
    expect(catalog.status).toBe(200);
    const body = await catalog.json();
    expect(body.apps).toHaveLength(3);
    expect(body.apps[0]).not.toHaveProperty("createServer");
  });

  it("requires bearer authorization on MCP endpoints", async () => {
    const app = createHostedMcpAppsHttpApp();

    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(initializeRequest())
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`${AUTH_SCHEME} realm="Telnyx MCP Apps"`);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("initializes stateful MCP sessions and removes them on DELETE", async () => {
    const app = createHostedMcpAppsHttpApp();

    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        authorization: authHeader("session-token")
      },
      body: JSON.stringify(initializeRequest())
    });

    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);

    const deleted = await app.request("/apps/number-intelligence/mcp", {
      method: "DELETE",
      headers: {
        authorization: authHeader("session-token"),
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": PROTOCOL_VERSION
      }
    });
    expect(deleted.status).toBe(200);

    const afterDelete = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        authorization: authHeader("session-token"),
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": PROTOCOL_VERSION
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(afterDelete.status).toBe(404);
  });

  it("rejects a valid session id when it is presented with a different bearer token", async () => {
    const app = createHostedMcpAppsHttpApp();
    const sessionId = await initializeSession(app, "original-token");

    const mismatch = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "different-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });

    expect(mismatch.status).toBe(404);
    await expect(mismatch.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" }
    });

    const originalTokenStillWorks = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "original-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(originalTokenStillWorks.status).toBe(200);
  });

  it("evicts sessions after the idle timeout", async () => {
    let currentTimeMs = 0;
    const app = createHostedMcpAppsHttpApp({
      sessionClock: () => currentTimeMs,
      sessionMaxAgeMs: 60_000,
      sessionIdleTimeoutMs: 1_000
    });
    const sessionId = await initializeSession(app, "idle-token");

    currentTimeMs = 999;
    const active = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "idle-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(active.status).toBe(200);

    currentTimeMs = 2_000;
    const expired = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "idle-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(expired.status).toBe(404);
  });

  it("evicts sessions after the absolute max age even if recently used", async () => {
    let currentTimeMs = 0;
    const app = createHostedMcpAppsHttpApp({
      sessionClock: () => currentTimeMs,
      sessionMaxAgeMs: 1_000,
      sessionIdleTimeoutMs: 60_000
    });
    const sessionId = await initializeSession(app, "ttl-token");

    currentTimeMs = 999;
    const active = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "ttl-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(active.status).toBe(200);

    currentTimeMs = 1_000;
    const expired = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "ttl-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(expired.status).toBe(404);
  });

  it("passes the per-request Authorization token to MCP tool handlers as the Telnyx API key", async () => {
    const seenAuthorizations: string[] = [];
    delete process.env.TELNYX_API_KEY;
    process.env.TELNYX_API_BASE_URL = "https://example.test";
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenAuthorizations.push(headers.get("authorization") ?? "");
      return new Response(
        JSON.stringify({
          data: {
            phone_number: "+155****4567",
            country_code: "US",
            national_format: "(555) 123-4567",
            carrier: { name: "Telnyx", type: "mobile" },
            caller_name: { caller_name: "Example User" }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const app = createHostedMcpAppsHttpApp();
    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        authorization: authHeader("request-scoped-key")
      },
      body: JSON.stringify(initializeRequest())
    });
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const initialized = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "request-scoped-key"),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    expect(initialized.status).toBe(202);

    const toolCall = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "request-scoped-key"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "number_intelligence_analyze",
          arguments: {
            phone_number: "+155****4567",
            sources: ["lookup"]
          }
        }
      })
    });

    expect(toolCall.status).toBe(200);
    expect(seenAuthorizations).toEqual([authHeader("request-scoped-key")]);
  });
});

async function initializeSession(app: ReturnType<typeof createHostedMcpAppsHttpApp>, token: string): Promise<string> {
  const initialize = await app.request("/apps/number-intelligence/mcp", {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      authorization: authHeader(token)
    },
    body: JSON.stringify(initializeRequest())
  });

  expect(initialize.status).toBe(200);
  const sessionId = initialize.headers.get("mcp-session-id");
  expect(sessionId).toMatch(/[0-9a-f-]{36}/);

  const initialized = await app.request("/apps/number-intelligence/mcp", {
    method: "POST",
    headers: sessionHeaders(sessionId, token),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  });
  expect(initialized.status).toBe(202);

  return sessionId ?? "";
}

function initializeRequest(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" }
    }
  };
}

function sessionHeaders(sessionId: string | null, token: string): Record<string, string> {
  return {
    ...MCP_HEADERS,
    authorization: authHeader(token),
    "mcp-session-id": sessionId ?? "",
    "mcp-protocol-version": PROTOCOL_VERSION
  };
}

function authHeader(token: string): string {
  return `${AUTH_SCHEME} ${token}`;
}
