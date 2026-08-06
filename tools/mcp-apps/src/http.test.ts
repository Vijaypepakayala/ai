import { afterEach, describe, expect, it } from "vitest";

import { createHostedMcpAppsHttpApp } from "./http.js";

const AUTH_SCHEME = "Bearer";
const INTERNAL_TOKEN = "internal-service-token";
const INTERNAL_AUTH_CHALLENGE = 'Bearer realm="Telnyx MCP Apps Internal"';
const TELNYX_API_KEY_CHALLENGE = 'TelnyxApiKey realm="Telnyx MCP Apps"';
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: authHeader(INTERNAL_TOKEN)
};
const PROTOCOL_VERSION = "2025-06-18";

describe("hosted MCP Apps HTTP service", () => {
  const oldFetch = globalThis.fetch;
  const oldApiKey = process.env.TELNYX_API_KEY;
  const oldBaseUrl = process.env.TELNYX_API_BASE_URL;
  const oldCorsAllowedOrigins = process.env.MCP_APPS_CORS_ALLOWED_ORIGINS;
  const oldMcpAppsPublicBaseUrl = process.env.MCP_APPS_PUBLIC_BASE_URL;

  afterEach(() => {
    globalThis.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = oldApiKey;
    if (oldBaseUrl === undefined) delete process.env.TELNYX_API_BASE_URL;
    else process.env.TELNYX_API_BASE_URL = oldBaseUrl;
    if (oldCorsAllowedOrigins === undefined) delete process.env.MCP_APPS_CORS_ALLOWED_ORIGINS;
    else process.env.MCP_APPS_CORS_ALLOWED_ORIGINS = oldCorsAllowedOrigins;
    if (oldMcpAppsPublicBaseUrl === undefined) delete process.env.MCP_APPS_PUBLIC_BASE_URL;
    else process.env.MCP_APPS_PUBLIC_BASE_URL = oldMcpAppsPublicBaseUrl;
  });

  it("fails closed when neither an internal token nor the explicit loopback escape hatch is configured", () => {
    expect(() =>
      createHostedMcpAppsHttpApp({
        internalToken: "",
        allowInsecureLoopback: false
      })
    ).toThrow(/MCP_APPS_INTERNAL_TOKEN is required/);
  });

  it.each([
    ["missing", undefined],
    ["incorrect", authHeader("wrong-internal-token")]
  ])("rejects %s internal service credentials before MCP discovery", async (_caseName, authorization) => {
    const app = createTestApp();
    const headers: Record<string, string> = {
      "content-type": MCP_HEADERS["content-type"],
      accept: MCP_HEADERS.accept
    };
    if (authorization) headers.authorization = authorization;

    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(initializeRequest())
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(INTERNAL_AUTH_CHALLENGE);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      result: {
        content: [{ type: "text", text: "Internal service authentication required" }],
        _meta: { "mcp/www_authenticate": [INTERNAL_AUTH_CHALLENGE] },
        isError: true
      }
    });
  });

  it("checks internal service authentication before reading an oversized request body", async () => {
    const app = createTestApp({ maxRequestBytes: 32 });
    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: MCP_HEADERS.accept
      },
      body: JSON.stringify({ padding: "x".repeat(64) })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(INTERNAL_AUTH_CHALLENGE);
  });

  it("rejects an authenticated MCP request body that exceeds the configured limit", async () => {
    const app = createTestApp({ maxRequestBytes: 32 });
    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({ padding: "x".repeat(64) })
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Request body exceeds the 32-byte limit"
      },
      id: null
    });
  });

  it("rejects an oversized streamed body even when Content-Length claims it is small", async () => {
    const app = createTestApp({ maxRequestBytes: 32 });
    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "content-length": "1"
      },
      body: JSON.stringify({ padding: "x".repeat(64) })
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Request body exceeds the 32-byte limit" }
    });
  });

  it("permits the explicit tokenless development mode only for loopback requests", async () => {
    const app = createHostedMcpAppsHttpApp({
      internalToken: "",
      allowInsecureLoopback: true
    });
    const headers = {
      "content-type": MCP_HEADERS["content-type"],
      accept: MCP_HEADERS.accept
    };

    const loopback = await app.request("http://127.0.0.1/apps/number-intelligence/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(initializeRequest())
    });
    expect(loopback.status).toBe(200);

    const nonLoopback = await app.request("https://mcp-apps.internal/apps/number-intelligence/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(initializeRequest())
    });
    expect(nonLoopback.status).toBe(401);
    expect(nonLoopback.headers.get("www-authenticate")).toBe(INTERNAL_AUTH_CHALLENGE);

    const rebindingHost = await app.request("http://127.0.0.1/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...headers,
        host: "evil.example"
      },
      body: JSON.stringify(initializeRequest())
    });
    expect(rebindingHost.status).toBe(401);
    expect(rebindingHost.headers.get("www-authenticate")).toBe(INTERNAL_AUTH_CHALLENGE);

    for (const [url, host] of [
      ["http://127.0.0.1:8080/apps/number-intelligence/mcp", "127.0.0.1:8080"],
      ["http://localhost:8080/apps/number-intelligence/mcp", "localhost:8080"],
      ["http://[::1]:8080/apps/number-intelligence/mcp", "[::1]:8080"]
    ] as const) {
      const validLoopbackHost = await app.request(url, {
        method: "POST",
        headers: {
          ...headers,
          host
        },
        body: JSON.stringify(initializeRequest())
      });
      expect(validLoopbackHost.status).toBe(200);
    }

    for (const invalidHost of [
      "127.0.0.1.evil.example",
      "127.999.0.1",
      "127.0.0.1:65536",
      "::1",
      "[::1].evil.example",
      "[::1]:65536"
    ]) {
      const invalidLoopbackHost = await app.request(
        "http://127.0.0.1/apps/number-intelligence/mcp",
        {
          method: "POST",
          headers: {
            ...headers,
            host: invalidHost
          },
          body: JSON.stringify(initializeRequest())
        }
      );
      expect(invalidLoopbackHost.status).toBe(401);
    }

    const sessionId = loopback.headers.get("mcp-session-id");
    const toolCallWithoutUserKey = await app.request(
      "http://127.0.0.1/apps/number-intelligence/mcp",
      {
        method: "POST",
        headers: {
          ...headers,
          "mcp-session-id": sessionId ?? "",
          "mcp-protocol-version": PROTOCOL_VERSION
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "number_intelligence_analyze",
            arguments: { phone_number: "+15551234567" }
          }
        })
      }
    );
    expect(toolCallWithoutUserKey.status).toBe(401);
    expect(toolCallWithoutUserKey.headers.get("www-authenticate")).toBe(TELNYX_API_KEY_CHALLENGE);
  });

  it("serves health, readiness, and catalog endpoints", async () => {
    const app = createTestApp({ now: () => "2026-05-21T00:00:00.000Z" });

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
      apps: ["number-intelligence", "voice-monitor"]
    });

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mcp.telnyx.com",
        "x-forwarded-prefix": "/mcp-apps"
      }
    });
    expect(catalog.status).toBe(200);
    const body = await catalog.json();
    expect(body.apps).toHaveLength(2);
    expect(body.apps[0]).not.toHaveProperty("createServer");
    expect(body.apps[0]).toMatchObject({
      slug: "number-intelligence",
      endpoint: "/apps/number-intelligence/mcp",
      endpointPath: "/mcp-apps/apps/number-intelligence/mcp",
      endpointUrl: "https://mcp.telnyx.com/mcp-apps/apps/number-intelligence/mcp",
      discovery: {
        transport: "streamable-http",
        requiredAccept: ["application/json", "text/event-stream"],
        sessionHeader: "mcp-session-id",
        publicMethods: [
          "initialize",
          "notifications/initialized",
          "notifications/cancelled",
          "ping",
          "tools/list",
          "resources/list",
          "resources/read"
        ],
        authRequiredMethods: ["tools/call"]
      }
    });

    expect(body.apps.map((entry: { slug: string }) => entry.slug)).not.toContain(
      "usage-cost-explorer"
    );

    const billingRoute = await app.request("/apps/usage-cost-explorer/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(initializeRequest())
    });
    expect(billingRoute.status).toBe(404);
  });

  it("rejects browser origins by default without affecting server-to-server requests", async () => {
    delete process.env.MCP_APPS_CORS_ALLOWED_ORIGINS;
    const app = createTestApp();

    const telnyxHostedBrowser = await app.request("/health", {
      headers: { origin: "https://portal.telnyx.com" }
    });
    expect(telnyxHostedBrowser.status).toBe(403);
    expect(telnyxHostedBrowser.headers.get("access-control-allow-origin")).toBeNull();

    const denied = await app.request("/health", {
      headers: { origin: "https://untrusted.example" }
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const serverToServer = await app.request("/health");
    expect(serverToServer.status).toBe(200);
    expect(serverToServer.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows CORS origins configured by environment without accepting wildcards", async () => {
    process.env.MCP_APPS_CORS_ALLOWED_ORIGINS = "https://mcp-apps.telnyx.test, http://localhost:5173/, *";
    const app = createTestApp();

    const configured = await app.request("/health", {
      headers: { origin: "https://mcp-apps.telnyx.test" }
    });
    expect(configured.status).toBe(200);
    expect(configured.headers.get("access-control-allow-origin")).toBe("https://mcp-apps.telnyx.test");

    const preflight = await app.request("/apps/number-intelligence/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://mcp-apps.telnyx.test",
        "access-control-request-method": "POST"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://mcp-apps.telnyx.test");
    expect(preflight.headers.get("access-control-allow-origin")).not.toBe("*");

    const localhost = await app.request("/health", {
      headers: { origin: "http://localhost:5173" }
    });
    expect(localhost.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const defaultOriginAfterOverride = await app.request("/health", {
      headers: { origin: "https://portal.telnyx.com" }
    });
    expect(defaultOriginAfterOverride.status).toBe(403);
    expect(defaultOriginAfterOverride.headers.get("access-control-allow-origin")).toBeNull();

    const wildcardOrigin = await app.request("/health", {
      headers: { origin: "https://untrusted.example" }
    });
    expect(wildcardOrigin.status).toBe(403);
    expect(wildcardOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const allowedHostWithPath = await app.request("/health", {
      headers: { origin: "https://mcp-apps.telnyx.test/not-an-origin" }
    });
    expect(allowedHostWithPath.status).toBe(403);
    expect(allowedHostWithPath.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("uses configured public base URL options for catalog endpoint URLs", async () => {
    const app = createTestApp({ publicBaseUrl: "https://api.telnyx.com/v2/mcp/" });

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "http",
        "x-forwarded-host": "wrong.example",
        "x-forwarded-prefix": "/wrong-prefix"
      }
    });
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpoint: "/apps/number-intelligence/mcp",
      endpointPath: "/v2/mcp/apps/number-intelligence/mcp",
      endpointUrl: "https://api.telnyx.com/v2/mcp/apps/number-intelligence/mcp"
    });
  });

  it("uses MCP_APPS_PUBLIC_BASE_URL for catalog endpoint URLs", async () => {
    process.env.MCP_APPS_PUBLIC_BASE_URL = "https://api.telnyx.com/v2/mcp";
    const app = createTestApp();

    const catalog = await app.request("http://api.telnyx.com/apps");
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpointPath: "/v2/mcp/apps/number-intelligence/mcp",
      endpointUrl: "https://api.telnyx.com/v2/mcp/apps/number-intelligence/mcp"
    });
  });

  it("normalizes double-leading configured public path prefixes without changing endpoint URL host", async () => {
    const app = createTestApp({ publicBaseUrl: "https://api.telnyx.com//evil.example/v2/mcp" });

    const catalog = await app.request("https://internal.example/apps");
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpointPath: "/evil.example/v2/mcp/apps/number-intelligence/mcp",
      endpointUrl: "https://api.telnyx.com/evil.example/v2/mcp/apps/number-intelligence/mcp"
    });
  });

  it("normalizes double-leading X-Forwarded-Prefix values without changing endpoint URL host", async () => {
    const app = createTestApp();

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mcp.telnyx.com",
        "x-forwarded-prefix": "//evil.example/v2/mcp"
      }
    });
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpointPath: "/evil.example/v2/mcp/apps/number-intelligence/mcp",
      endpointUrl: "https://mcp.telnyx.com/evil.example/v2/mcp/apps/number-intelligence/mcp"
    });
  });

  it.each([
    "/mcp?redirect=evil.example",
    "/mcp#evil.example",
    "/mcp\\evil",
    "/mcp/../admin",
    "/mcp/%2e%2e/admin",
    "/mcp/%2Fadmin",
    "/mcp//admin"
  ])(
    "ignores unsafe forwarded path prefix %s",
    async (prefix) => {
      const app = createTestApp();
      const catalog = await app.request("https://internal.example/apps", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "mcp.telnyx.com",
          "x-forwarded-prefix": prefix
        }
      });
      const body = await catalog.json();
      expect(body.apps[0]).toMatchObject({
        endpointPath: "/apps/number-intelligence/mcp",
        endpointUrl: "https://mcp.telnyx.com/apps/number-intelligence/mcp"
      });
    }
  );

  it.each([
    ["insecure non-loopback origin", "http", "mcp.telnyx.com"],
    ["host containing a path", "https", "mcp.telnyx.com/evil"],
    ["host containing credentials", "https", "attacker@mcp.telnyx.com"]
  ])("ignores an unsafe forwarded %s", async (_caseName, proto, host) => {
    const app = createTestApp();
    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": proto,
        "x-forwarded-host": host,
        "x-forwarded-prefix": "/mcp-apps"
      }
    });
    const body = await catalog.json();
    expect(body.apps[0]).toMatchObject({
      endpointPath: "/mcp-apps/apps/number-intelligence/mcp",
      endpointUrl: "https://internal.example/mcp-apps/apps/number-intelligence/mcp"
    });
  });

  it("falls back to forwarded headers when MCP_APPS_PUBLIC_BASE_URL is malformed", async () => {
    process.env.MCP_APPS_PUBLIC_BASE_URL = "ftp://evil.example/v2/mcp";
    const app = createTestApp();

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mcp.telnyx.com",
        "x-forwarded-prefix": "/mcp-apps"
      }
    });
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpointPath: "/mcp-apps/apps/number-intelligence/mcp",
      endpointUrl: "https://mcp.telnyx.com/mcp-apps/apps/number-intelligence/mcp"
    });
  });

  it.each([
    ["credentials", "https://user:pass@api.telnyx.com/v2/mcp"],
    ["query", "https://api.telnyx.com/v2/mcp?redirect=evil.example"],
    ["hash", "https://api.telnyx.com/v2/mcp#evil.example"]
  ])("falls back to forwarded headers when MCP_APPS_PUBLIC_BASE_URL contains %s", async (_caseName, publicBaseUrl) => {
    process.env.MCP_APPS_PUBLIC_BASE_URL = publicBaseUrl;
    const app = createTestApp();

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mcp.telnyx.com",
        "x-forwarded-prefix": "/mcp-apps"
      }
    });
    expect(catalog.status).toBe(200);
    const body = await catalog.json();

    expect(body.apps[0]).toMatchObject({
      endpointPath: "/mcp-apps/apps/number-intelligence/mcp",
      endpointUrl: "https://mcp.telnyx.com/mcp-apps/apps/number-intelligence/mcp"
    });
  });

  it("rejects non-loopback HTTP origins and public base URLs", async () => {
    process.env.MCP_APPS_CORS_ALLOWED_ORIGINS =
      "http://browser.example,http://127.0.0.1:5173";
    process.env.MCP_APPS_PUBLIC_BASE_URL = "http://api.telnyx.com/v2/mcp";
    const app = createTestApp();

    const insecureBrowser = await app.request("/health", {
      headers: { origin: "http://browser.example" }
    });
    expect(insecureBrowser.status).toBe(403);

    const loopbackBrowser = await app.request("/health", {
      headers: { origin: "http://127.0.0.1:5173" }
    });
    expect(loopbackBrowser.status).toBe(200);

    const catalog = await app.request("https://internal.example/apps", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mcp.telnyx.com",
        "x-forwarded-prefix": "/v2/mcp"
      }
    });
    const body = await catalog.json();
    expect(body.apps[0].endpointUrl).toBe(
      "https://mcp.telnyx.com/v2/mcp/apps/number-intelligence/mcp"
    );
  });

  it("rejects query strings on MCP app routes", async () => {
    const app = createTestApp();
    const response = await app.request(
      "/apps/number-intelligence/mcp?catalog=usage-cost-explorer",
      {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify(initializeRequest())
      }
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "query_not_allowed" });
  });

  it("allows unauthenticated MCP Apps discovery and UI resource introspection", async () => {
    const app = createTestApp();

    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(initializeRequest())
    });
    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);
    const initializeBody = await initialize.json();
    expect(initializeBody.result.instructions).toContain("Accept: application/json, text/event-stream");

    const initializedNotification = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    expect(initializedNotification.status).toBe(202);

    const toolsList = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(toolsList.status).toBe(200);
    const toolsListBody = await toolsList.json();
    expect(toolsListBody.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "number_intelligence_analyze",
          outputSchema: expect.objectContaining({ type: "object" }),
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true
          },
          _meta: expect.objectContaining({
            ui: expect.objectContaining({ resourceUri: "ui://number-intelligence/index.html" })
          })
        })
      ])
    );

    const resourcesList = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} })
    });
    expect(resourcesList.status).toBe(200);
    const resourcesListBody = await resourcesList.json();
    expect(resourcesListBody.result.resources).toContainEqual(
      expect.objectContaining({
        uri: "ui://number-intelligence/index.html",
        _meta: {
          ui: {
            domain: "https://telnyx-developer-kit.telnyx.com",
            csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }
          }
        }
      })
    );

    const resourcesRead = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "resources/read",
        params: { uri: "ui://number-intelligence/index.html" }
      })
    });
    expect(resourcesRead.status).toBe(200);
    const resourcesReadBody = await resourcesRead.json();
    expect(resourcesReadBody.result.contents).toContainEqual(
      expect.objectContaining({
        uri: "ui://number-intelligence/index.html",
        mimeType: "text/html;profile=mcp-app",
        _meta: {
          ui: {
            domain: "https://telnyx-developer-kit.telnyx.com",
            csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }
          }
        }
      })
    );
  });

  it.each([
    ["missing", undefined],
    ["an opaque OAuth access token", "opaque-oauth-access-token"]
  ])("rejects %s user credentials for tool execution", async (_caseName, userCredential) => {
    const app = createTestApp();
    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(initializeRequest())
    });
    const sessionId = initialize.headers.get("mcp-session-id");

    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...publicSessionHeaders(sessionId),
        ...(userCredential ? { "x-telnyx-api-key": userCredential } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "number_intelligence_analyze", arguments: { phone_number: "+155****4567" } }
      })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(TELNYX_API_KEY_CHALLENGE);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "A resolved Telnyx API key is required for tool execution" }],
        _meta: { "mcp/www_authenticate": [TELNYX_API_KEY_CHALLENGE] },
        isError: true
      }
    });
  });

  it("initializes stateful MCP sessions and removes them on DELETE", async () => {
    const app = createTestApp();

    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "x-telnyx-api-key": "KEY_session_token_1234567890"
      },
      body: JSON.stringify(initializeRequest())
    });

    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);

    const deleted = await app.request("/apps/number-intelligence/mcp", {
      method: "DELETE",
      headers: {
        authorization: authHeader(INTERNAL_TOKEN),
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": PROTOCOL_VERSION
      }
    });
    expect(deleted.status).toBe(200);

    const afterDelete = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "x-telnyx-api-key": "KEY_session_token_1234567890",
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": PROTOCOL_VERSION
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(afterDelete.status).toBe(404);
  });

  it("rejects a valid session id when it is presented with a different Telnyx API key", async () => {
    const app = createTestApp();
    const sessionId = await initializeSession(app, "KEY_original_token_1234567890");

    const mismatch = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_different_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });

    expect(mismatch.status).toBe(404);
    await expect(mismatch.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" }
    });

    const originalTokenStillWorks = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_original_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(originalTokenStillWorks.status).toBe(200);
  });

  it("bounds each app session store and evicts the oldest initialized session", async () => {
    let currentTimeMs = 1_000;
    const app = createTestApp({
      sessionClock: () => currentTimeMs,
      maxSessionsPerApp: 2
    });
    const oldest = await initializeSession(app, "KEY_oldest_session_1234567890");

    currentTimeMs += 1;
    const middle = await initializeSession(app, "KEY_middle_session_1234567890");

    currentTimeMs += 1;
    const newest = await initializeSession(app, "KEY_newest_session_1234567890");

    const oldestAfterEviction = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(oldest, "KEY_oldest_session_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(oldestAfterEviction.status).toBe(404);

    for (const [sessionId, token] of [
      [middle, "KEY_middle_session_1234567890"],
      [newest, "KEY_newest_session_1234567890"]
    ] as const) {
      const retained = await app.request("/apps/number-intelligence/mcp", {
        method: "POST",
        headers: sessionHeaders(sessionId, token),
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
      });
      expect(retained.status).toBe(200);
    }
  });

  it("reserves initialization capacity so concurrent requests cannot overflow the session cap", async () => {
    const app = createTestApp({ maxSessionsPerApp: 1 });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app
          .request("/apps/number-intelligence/mcp", {
            method: "POST",
            headers: {
              ...MCP_HEADERS,
              "x-telnyx-api-key": `KEY_concurrent_session_${index}_1234567890`
            },
            body: JSON.stringify(initializeRequest())
          })
          .then((response) => ({ index, response }))
      )
    );

    const successful = attempts.filter(({ response }) => response.status === 200);
    const rejected = attempts.filter(({ response }) => response.status === 429);
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(rejected.every(({ response }) => response.headers.get("retry-after") === "1")).toBe(true);

    const retainedSessionId = successful[0]?.response.headers.get("mcp-session-id");
    expect(retainedSessionId).toMatch(/[0-9a-f-]{36}/);

    const retained = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(
        retainedSessionId,
        `KEY_concurrent_session_${successful[0]?.index ?? -1}_1234567890`
      ),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(retained.status).toBe(200);
  });

  it("coordinates concurrent replacements against a full session store", async () => {
    const app = createTestApp({ maxSessionsPerApp: 3 });
    const originalSessions = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const token = `KEY_full_store_original_${index}_1234567890`;
        return { token, sessionId: await initializeSession(app, token) };
      })
    );
    const replacementTokens = [
      "KEY_full_store_failed_1234567890",
      "KEY_full_store_replacement_1_1234567890",
      "KEY_full_store_replacement_2_1234567890"
    ];

    const replacementAttempts = await Promise.all(
      replacementTokens.map((token, index) =>
        app.request("/apps/number-intelligence/mcp", {
          method: "POST",
          headers: {
            ...MCP_HEADERS,
            ...(index === 0 ? { accept: "application/json" } : {}),
            "x-telnyx-api-key": token
          },
          body: JSON.stringify(initializeRequest())
        })
      )
    );
    expect(replacementAttempts.map((response) => response.status)).toEqual([406, 200, 200]);

    const successfulReplacements = replacementAttempts.slice(1).map((response, index) => ({
      token: replacementTokens[index + 1] ?? "",
      sessionId: response.headers.get("mcp-session-id") ?? ""
    }));
    expect(successfulReplacements.every(({ sessionId }) => /[0-9a-f-]{36}/.test(sessionId))).toBe(
      true
    );
    await Promise.all(
      successfulReplacements.map(({ sessionId, token }) =>
        app.request("/apps/number-intelligence/mcp", {
          method: "POST",
          headers: sessionHeaders(sessionId, token),
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
        })
      )
    );

    const originalStatuses = await Promise.all(
      originalSessions.map(async ({ sessionId, token }) => {
        const response = await app.request("/apps/number-intelligence/mcp", {
          method: "POST",
          headers: sessionHeaders(sessionId, token),
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
        });
        return response.status;
      })
    );
    expect(originalStatuses.filter((status) => status === 200)).toHaveLength(1);
    expect(originalStatuses.filter((status) => status === 404)).toHaveLength(2);

    const finalReplacement = {
      token: "KEY_full_store_replacement_3_1234567890",
      sessionId: await initializeSession(app, "KEY_full_store_replacement_3_1234567890")
    };
    const finalRetainedStatuses = await Promise.all(
      [...successfulReplacements, finalReplacement].map(async ({ sessionId, token }) => {
        const response = await app.request("/apps/number-intelligence/mcp", {
          method: "POST",
          headers: sessionHeaders(sessionId, token),
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
        });
        return response.status;
      })
    );
    expect(finalRetainedStatuses).toEqual([200, 200, 200]);
  });

  it("evicts existing sessions only when successful concurrent initializations consume capacity", async () => {
    let caseNumber = 0;

    for (let capacity = 1; capacity <= 3; capacity += 1) {
      for (let initialOccupancy = 0; initialOccupancy <= capacity; initialOccupancy += 1) {
        for (let pendingCount = 1; pendingCount <= capacity; pendingCount += 1) {
          for (let outcomeMask = 0; outcomeMask < 2 ** pendingCount; outcomeMask += 1) {
            caseNumber += 1;
            const app = createTestApp({ maxSessionsPerApp: capacity });
            const originalSessionIds: string[] = [];

            for (let index = 0; index < initialOccupancy; index += 1) {
              const initialized = await app.request("/apps/number-intelligence/mcp", {
                method: "POST",
                headers: MCP_HEADERS,
                body: JSON.stringify(initializeRequest())
              });
              expect(initialized.status).toBe(200);
              originalSessionIds.push(initialized.headers.get("mcp-session-id") ?? "");
            }

            const expectedOutcomes = Array.from(
              { length: pendingCount },
              (_, index) => Boolean(outcomeMask & (1 << index))
            );
            const attempts = await Promise.all(
              expectedOutcomes.map((shouldSucceed) =>
                app.request("/apps/number-intelligence/mcp", {
                  method: "POST",
                  headers: {
                    ...MCP_HEADERS,
                    ...(shouldSucceed ? {} : { accept: "application/json" })
                  },
                  body: JSON.stringify(initializeRequest())
                })
              )
            );
            const successfulCount = attempts.filter((response) => response.status === 200).length;
            expect(
              successfulCount,
              `capacity matrix case ${caseNumber} returned unexpected initialization statuses`
            ).toBe(expectedOutcomes.filter(Boolean).length);

            const retainedStatuses = await Promise.all(
              originalSessionIds.map(async (sessionId) => {
                const response = await app.request("/apps/number-intelligence/mcp", {
                  method: "POST",
                  headers: publicSessionHeaders(sessionId),
                  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
                });
                return response.status;
              })
            );
            const retainedCount = retainedStatuses.filter((status) => status === 200).length;
            const expectedRetainedCount = Math.min(
              initialOccupancy,
              Math.max(0, capacity - successfulCount)
            );
            expect(
              retainedCount,
              `capacity matrix case ${caseNumber} evicted more sessions than required`
            ).toBe(expectedRetainedCount);
          }
        }
      }
    }

    expect(caseNumber).toBe(78);
  });

  it("releases reserved initialization capacity when transport initialization fails", async () => {
    const app = createTestApp({ maxSessionsPerApp: 1 });
    const failed = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        accept: "application/json",
        "x-telnyx-api-key": "KEY_failed_session_1234567890"
      },
      body: JSON.stringify(initializeRequest())
    });
    expect(failed.status).toBe(406);
    expect(failed.headers.get("mcp-session-id")).toBeNull();

    const valid = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "x-telnyx-api-key": "KEY_after_failed_session_1234567890"
      },
      body: JSON.stringify(initializeRequest())
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("mcp-session-id")).toMatch(/[0-9a-f-]{36}/);
  });

  it("keeps the original session usable when a capacity replacement returns 406", async () => {
    const app = createTestApp({ maxSessionsPerApp: 1 });
    const originalToken = "KEY_original_capacity_session_1234567890";
    const originalSessionId = await initializeSession(app, originalToken);

    const failedReplacement = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        accept: "application/json",
        "x-telnyx-api-key": "KEY_failed_replacement_1234567890"
      },
      body: JSON.stringify(initializeRequest())
    });
    expect(failedReplacement.status).toBe(406);
    expect(failedReplacement.headers.get("mcp-session-id")).toBeNull();

    const originalStillWorks = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(originalSessionId, originalToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(originalStillWorks.status).toBe(200);

    const successfulReplacement = await initializeSession(
      app,
      "KEY_successful_replacement_1234567890"
    );
    expect(successfulReplacement).toMatch(/[0-9a-f-]{36}/);

    const originalAfterSuccessfulReplacement = await app.request(
      "/apps/number-intelligence/mcp",
      {
        method: "POST",
        headers: sessionHeaders(originalSessionId, originalToken),
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
      }
    );
    expect(originalAfterSuccessfulReplacement.status).toBe(404);
  });

  it("keeps the original session usable when a capacity replacement is malformed", async () => {
    const app = createTestApp({ maxSessionsPerApp: 1 });
    const originalToken = "KEY_original_malformed_session_1234567890";
    const originalSessionId = await initializeSession(app, originalToken);

    const malformedReplacement = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "x-telnyx-api-key": "KEY_malformed_replacement_1234567890"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })
    });
    expect(malformedReplacement.status).toBe(400);
    expect(malformedReplacement.headers.get("mcp-session-id")).toBeNull();

    const originalStillWorks = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(originalSessionId, originalToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(originalStillWorks.status).toBe(200);
  });

  it("evicts sessions after the idle timeout", async () => {
    let currentTimeMs = 0;
    const app = createTestApp({
      sessionClock: () => currentTimeMs,
      sessionMaxAgeMs: 60_000,
      sessionIdleTimeoutMs: 1_000
    });
    const sessionId = await initializeSession(app, "KEY_idle_token_1234567890");

    currentTimeMs = 999;
    const active = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_idle_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(active.status).toBe(200);

    currentTimeMs = 2_000;
    const expired = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_idle_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(expired.status).toBe(404);
  });

  it("evicts sessions after the absolute max age even if recently used", async () => {
    let currentTimeMs = 0;
    const app = createTestApp({
      sessionClock: () => currentTimeMs,
      sessionMaxAgeMs: 1_000,
      sessionIdleTimeoutMs: 60_000
    });
    const sessionId = await initializeSession(app, "KEY_ttl_token_1234567890");

    currentTimeMs = 999;
    const active = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_ttl_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(active.status).toBe(200);

    currentTimeMs = 1_000;
    const expired = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_ttl_token_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(expired.status).toBe(404);
  });

  it("passes only the per-request Telnyx API key to upstream Telnyx requests", async () => {
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

    const app = createTestApp();
    const initialize = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(initializeRequest())
    });
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const initialized = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    expect(initialized.status).toBe(202);

    const toolCall = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_request_scoped_key_1234567890"),
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
    expect(seenAuthorizations).toEqual([authHeader("KEY_request_scoped_key_1234567890")]);

    const discoveryWithoutUserKey = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
    });
    expect(discoveryWithoutUserKey.status).toBe(200);

    const pingWithoutUserKey = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" })
    });
    expect(pingWithoutUserKey.status).toBe(200);

    const cancellationWithoutUserKey = await app.request(
      "/apps/number-intelligence/mcp",
      {
        method: "POST",
        headers: publicSessionHeaders(sessionId),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: 2, reason: "User cancelled the lookup" }
        })
      }
    );
    expect(cancellationWithoutUserKey.status).toBe(202);

    const unknownMethodWithoutUserKey = await app.request(
      "/apps/number-intelligence/mcp",
      {
        method: "POST",
        headers: publicSessionHeaders(sessionId),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "telnyx/unknown"
        })
      }
    );
    expect(unknownMethodWithoutUserKey.status).toBe(401);

    const differentUserKey = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_different_user_key_1234567890"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} })
    });
    expect(differentUserKey.status).toBe(404);
  });

  it("accepts credential-free cancellation and stops a billable batch before its next lookup", async () => {
    delete process.env.TELNYX_API_KEY;
    process.env.TELNYX_API_BASE_URL = "https://example.test";
    let lookupCalls = 0;
    let markFetchStarted: (() => void) | undefined;
    let markFetchAborted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchAborted = new Promise<void>((resolve) => {
      markFetchAborted = resolve;
    });

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      lookupCalls += 1;
      markFetchStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectForCancellation = () => {
          markFetchAborted?.();
          reject(signal?.reason ?? new Error("Telnyx request was cancelled"));
        };
        if (signal?.aborted) rejectForCancellation();
        else signal?.addEventListener("abort", rejectForCancellation, { once: true });
      });
    }) as typeof fetch;

    const app = createTestApp();
    const sessionId = await initializeSession(app, "KEY_cancel_batch_1234567890");
    const toolCallPromise = app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, "KEY_cancel_batch_1234567890"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "number_intelligence_batch_analyze",
          arguments: {
            numbers: ["+15551234567", "+15557654321"],
            sources: ["lookup"]
          }
        }
      })
    });

    await fetchStarted;
    const cancellation = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: publicSessionHeaders(sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 2, reason: "User cancelled the batch" }
      })
    });
    expect(cancellation.status).toBe(202);

    await fetchAborted;
    void toolCallPromise.catch(() => undefined);
    expect(lookupCalls).toBe(1);
  });

  it("preserves the hidden upstream auth marker over MCP HTTP for proxy translation", async () => {
    const userKey = "KEY_TEST_INVALID_USER_SECRET";
    process.env.TELNYX_API_BASE_URL = "https://example.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              title: "Authorization failed",
              detail: `Bearer ${userKey}`
            }
          ]
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const app = createTestApp();
    const sessionId = await initializeSession(app, userKey);
    const response = await app.request("/apps/number-intelligence/mcp", {
      method: "POST",
      headers: sessionHeaders(sessionId, userKey),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "number_intelligence_analyze",
          arguments: {
            phone_number: "+15551234567",
            sources: ["lookup"]
          }
        }
      })
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        isError: true,
        _meta: { "telnyx/internal-http-status": 401 }
      }
    });
    expect(serialized).not.toContain(userKey);
    expect(serialized).not.toContain("Authorization failed");
  });
});

async function initializeSession(app: ReturnType<typeof createHostedMcpAppsHttpApp>, token: string): Promise<string> {
  const initialize = await app.request("/apps/number-intelligence/mcp", {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      "x-telnyx-api-key": token
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

function publicSessionHeaders(sessionId: string | null): Record<string, string> {
  return {
    ...MCP_HEADERS,
    "mcp-session-id": sessionId ?? "",
    "mcp-protocol-version": PROTOCOL_VERSION
  };
}

function sessionHeaders(sessionId: string | null, token: string): Record<string, string> {
  return {
    ...MCP_HEADERS,
    "x-telnyx-api-key": token,
    "mcp-session-id": sessionId ?? "",
    "mcp-protocol-version": PROTOCOL_VERSION
  };
}

function createTestApp(
  options: Parameters<typeof createHostedMcpAppsHttpApp>[0] = {}
): ReturnType<typeof createHostedMcpAppsHttpApp> {
  return createHostedMcpAppsHttpApp({ internalToken: INTERNAL_TOKEN, ...options });
}

function authHeader(token: string): string {
  return `${AUTH_SCHEME} ${token}`;
}
