import { createHash, randomUUID } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { findMcpApp, listPublicApps } from "./catalog.js";

const SERVICE_NAME = "mcp-apps";
const WWW_AUTHENTICATE = 'Bearer realm="Telnyx MCP Apps"';
const DEFAULT_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface SessionLimits {
  maxAgeMs: number;
  idleTimeoutMs: number;
}

type SessionRecord = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  tokenFingerprint: string;
  createdAtMs: number;
  lastSeenAtMs: number;
};

type SessionStore = Map<string, SessionRecord>;

export interface HostedMcpAppsOptions {
  now?: () => string;
  sessionClock?: () => number;
  sessionMaxAgeMs?: number;
  sessionIdleTimeoutMs?: number;
}

export function createHostedMcpAppsHttpApp(options: HostedMcpAppsOptions = {}): Hono {
  const sessionsByApp = new Map<string, SessionStore>();
  const now = options.now ?? (() => new Date().toISOString());
  const sessionClock = options.sessionClock ?? Date.now;
  const sessionLimits: SessionLimits = {
    maxAgeMs: positiveDurationOrDefault(options.sessionMaxAgeMs, DEFAULT_SESSION_MAX_AGE_MS),
    idleTimeoutMs: positiveDurationOrDefault(options.sessionIdleTimeoutMs, DEFAULT_SESSION_IDLE_TIMEOUT_MS)
  };
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
      exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version", "WWW-Authenticate"]
    })
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: SERVICE_NAME,
      time: now()
    })
  );

  app.get("/readyz", (c) =>
    c.json({
      status: "ready",
      service: SERVICE_NAME,
      apps: listPublicApps().map((entry) => entry.slug)
    })
  );

  app.get("/apps", (c) => c.json({ apps: listPublicApps() }));

  app.all("/apps/:slug/mcp", async (c) => {
    const definition = findMcpApp(c.req.param("slug"));
    if (!definition) {
      return c.json({ error: "app_not_found" }, 404);
    }

    const token = parseBearerToken(c.req.header("authorization"));
    if (!token) {
      return unauthorizedResponse();
    }

    const authInfo: AuthInfo = {
      token,
      clientId: "telnyx-api-key",
      scopes: []
    };

    const appSessions = getSessionStore(sessionsByApp, definition.slug);
    const requestTimeMs = sessionClock();
    await evictExpiredSessions(appSessions, requestTimeMs, sessionLimits);

    const tokenFingerprint = fingerprintBearerToken(token);
    const sessionId = c.req.header("mcp-session-id");
    const existing = sessionId ? appSessions.get(sessionId) : undefined;

    if (sessionId && !existing) {
      return sessionNotFoundResponse();
    }

    if (existing && existing.tokenFingerprint !== tokenFingerprint) {
      return sessionNotFoundResponse();
    }

    const record =
      existing ?? (await createSession(definition.createServer, appSessions, tokenFingerprint, requestTimeMs));
    record.lastSeenAtMs = requestTimeMs;

    const response = await record.transport.handleRequest(c.req.raw, { authInfo });

    if (!existing && !record.transport.sessionId) {
      await closeSession(record);
    }

    return response;
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}

function getSessionStore(sessionsByApp: Map<string, SessionStore>, slug: string): SessionStore {
  let store = sessionsByApp.get(slug);
  if (!store) {
    store = new Map();
    sessionsByApp.set(slug, store);
  }
  return store;
}

async function createSession(
  createServer: () => McpServer,
  sessions: SessionStore,
  tokenFingerprint: string,
  createdAtMs: number
): Promise<SessionRecord> {
  let record: SessionRecord;
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, record);
    },
    onsessionclosed: (sessionId) => {
      if (sessionId) sessions.delete(sessionId);
    }
  });
  record = { server, transport, tokenFingerprint, createdAtMs, lastSeenAtMs: createdAtMs };
  await server.connect(transport);
  return record;
}

async function evictExpiredSessions(sessions: SessionStore, nowMs: number, limits: SessionLimits): Promise<void> {
  const expired: SessionRecord[] = [];

  for (const [sessionId, record] of sessions.entries()) {
    if (isExpired(record, nowMs, limits)) {
      sessions.delete(sessionId);
      expired.push(record);
    }
  }

  await Promise.all(expired.map((record) => closeSession(record)));
}

function isExpired(record: SessionRecord, nowMs: number, limits: SessionLimits): boolean {
  return nowMs - record.createdAtMs >= limits.maxAgeMs || nowMs - record.lastSeenAtMs >= limits.idleTimeoutMs;
}

async function closeSession(record: SessionRecord): Promise<void> {
  await record.server.close();
}

function positiveDurationOrDefault(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function fingerprintBearerToken(token: string): string {
  return createHash("sha256").update("mcp-apps:bearer-token:v1\0").update(token).digest("hex");
}

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

function sessionNotFoundResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null
    }),
    {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": WWW_AUTHENTICATE
    }
  });
}
