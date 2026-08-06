import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { MCP_PUBLIC_DISCOVERY_METHODS, findMcpApp, listPublicApps } from "./catalog.js";

const SERVICE_NAME = "mcp-apps";
const INTERNAL_TOKEN_ENV = "MCP_APPS_INTERNAL_TOKEN";
const ALLOW_INSECURE_LOOPBACK_ENV = "MCP_APPS_ALLOW_INSECURE_LOOPBACK";
const TELNYX_API_KEY_HEADER = "x-telnyx-api-key";
const INTERNAL_AUTH_CHALLENGE = 'Bearer realm="Telnyx MCP Apps Internal"';
const TELNYX_API_KEY_CHALLENGE = 'TelnyxApiKey realm="Telnyx MCP Apps"';
const TELNYX_API_KEY_PATTERN = /^KEY_[A-Za-z0-9_-]{16,}$/;
const CREDENTIAL_FREE_TOKEN_FINGERPRINT = "credential-free";
const CREDENTIAL_FREE_METHODS = new Set<string>(MCP_PUBLIC_DISCOVERY_METHODS);
const DEFAULT_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_SESSIONS_PER_APP = 256;
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const CORS_ALLOWED_ORIGINS_ENV = "MCP_APPS_CORS_ALLOWED_ORIGINS";
const PUBLIC_BASE_URL_ENV = "MCP_APPS_PUBLIC_BASE_URL";
const MAX_SESSIONS_PER_APP_ENV = "MCP_APPS_MAX_SESSIONS_PER_APP";

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
type PendingInitializationState = {
  count: number;
  reservedSessions: Set<SessionRecord>;
};
type PendingInitializationStore = Map<string, PendingInitializationState>;

type InitializationReservation = {
  commit: (sessionId: string, record: SessionRecord) => SessionRecord[];
  release: () => void;
};

type CredentialFreeDecision =
  | { allowed: true; parsedBody?: unknown }
  | { allowed: false; parsedBody?: unknown };

export interface HostedMcpAppsOptions {
  now?: () => string;
  sessionClock?: () => number;
  sessionMaxAgeMs?: number;
  sessionIdleTimeoutMs?: number;
  /** Maximum retained MCP sessions for each app. Defaults to 256. */
  maxSessionsPerApp?: number;
  maxRequestBytes?: number;
  corsAllowedOrigins?: string[];
  publicBaseUrl?: string;
  internalToken?: string;
  allowInsecureLoopback?: boolean;
}

export function createHostedMcpAppsHttpApp(options: HostedMcpAppsOptions = {}): Hono {
  const internalToken = normalizeCredential(
    options.internalToken !== undefined ? options.internalToken : process.env[INTERNAL_TOKEN_ENV]
  );
  const allowInsecureLoopback =
    options.allowInsecureLoopback ?? process.env[ALLOW_INSECURE_LOOPBACK_ENV] === "true";
  if (!internalToken && !allowInsecureLoopback) {
    throw new Error(
      `${INTERNAL_TOKEN_ENV} is required. For explicit local development only, set ` +
        `${ALLOW_INSECURE_LOOPBACK_ENV}=true and bind the service to a loopback host.`
    );
  }

  const sessionsByApp = new Map<string, SessionStore>();
  const pendingInitializationsByApp: PendingInitializationStore = new Map();
  const now = options.now ?? (() => new Date().toISOString());
  const sessionClock = options.sessionClock ?? Date.now;
  const sessionLimits: SessionLimits = {
    maxAgeMs: positiveDurationOrDefault(options.sessionMaxAgeMs, DEFAULT_SESSION_MAX_AGE_MS),
    idleTimeoutMs: positiveDurationOrDefault(options.sessionIdleTimeoutMs, DEFAULT_SESSION_IDLE_TIMEOUT_MS)
  };
  const maxSessionsPerApp = positiveIntegerOrDefault(
    options.maxSessionsPerApp ?? Number(process.env[MAX_SESSIONS_PER_APP_ENV]),
    DEFAULT_MAX_SESSIONS_PER_APP
  );
  const maxRequestBytes = positiveDurationOrDefault(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES
  );
  const allowedCorsOrigins = resolveAllowedCorsOrigins(options.corsAllowedOrigins);
  const configuredPublicEndpointContext = resolveConfiguredPublicEndpointContext(options.publicBaseUrl);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !isCorsOriginAllowed(origin, allowedCorsOrigins)) {
      c.header("Vary", "Origin");
      return c.json({ error: "origin_not_allowed" }, 403);
    }
    await next();
  });

  app.use(
    "*",
    cors({
      origin: createCorsOriginResolver(allowedCorsOrigins),
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "Last-Event-ID",
        "X-Telnyx-API-Key"
      ],
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

  app.get("/apps", (c) => {
    c.header("Vary", "Forwarded, X-Forwarded-Proto, X-Forwarded-Host, X-Forwarded-Prefix");
    return c.json({
      apps: listPublicApps(configuredPublicEndpointContext ?? resolvePublicEndpointContext(c.req.raw))
    });
  });

  app.all("/apps/:slug/mcp", async (c) => {
    const definition = findMcpApp(c.req.param("slug"));
    if (!definition) {
      return c.json({ error: "app_not_found" }, 404);
    }
    if (new URL(c.req.url).search) {
      return c.json({ error: "query_not_allowed" }, 400);
    }

    const serviceToken = parseBearerToken(c.req.header("authorization"));
    const serviceAuthenticated = internalToken
      ? Boolean(serviceToken && credentialsEqual(serviceToken, internalToken))
      : allowInsecureLoopback && isLoopbackRequest(c.req.raw);
    if (!serviceAuthenticated) {
      return authenticationErrorResponse(
        undefined,
        "Internal service authentication required",
        INTERNAL_AUTH_CHALLENGE
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = await parseRequestBodyForAuth(c.req.raw, maxRequestBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return payloadTooLargeResponse(error.maxBytes);
      }
      throw error;
    }
    const telnyxApiKey = parseTelnyxApiKey(c.req.header(TELNYX_API_KEY_HEADER));
    const credentialFreeRequest = telnyxApiKey
      ? undefined
      : authorizeCredentialFreeRequest(c.req.raw, parsedBody);
    if (!telnyxApiKey && credentialFreeRequest?.allowed !== true) {
      return authenticationErrorResponse(
        parsedBody,
        "A resolved Telnyx API key is required for tool execution",
        TELNYX_API_KEY_CHALLENGE
      );
    }

    const authInfo: AuthInfo | undefined = telnyxApiKey
      ? {
          token: telnyxApiKey,
          clientId: "telnyx-api-key",
          scopes: []
        }
      : undefined;

    const appSessions = getSessionStore(sessionsByApp, definition.slug);
    const requestTimeMs = sessionClock();
    await evictExpiredSessions(appSessions, requestTimeMs, sessionLimits);

    const tokenFingerprint = telnyxApiKey
      ? fingerprintBearerToken(telnyxApiKey)
      : CREDENTIAL_FREE_TOKEN_FINGERPRINT;
    const sessionId = c.req.header("mcp-session-id");
    const existing = sessionId ? appSessions.get(sessionId) : undefined;

    if (sessionId && !existing) {
      return sessionNotFoundResponse();
    }

    if (existing) {
      if (
        existing.tokenFingerprint === CREDENTIAL_FREE_TOKEN_FINGERPRINT &&
        tokenFingerprint !== CREDENTIAL_FREE_TOKEN_FINGERPRINT
      ) {
        existing.tokenFingerprint = tokenFingerprint;
      } else if (
        existing.tokenFingerprint !== CREDENTIAL_FREE_TOKEN_FINGERPRINT &&
        tokenFingerprint === CREDENTIAL_FREE_TOKEN_FINGERPRINT &&
        credentialFreeRequest?.allowed === true
      ) {
        // Discovery remains credential-free behind the authenticated internal
        // boundary, while the session stays pinned to its first user key.
      } else if (existing.tokenFingerprint !== tokenFingerprint) {
        return sessionNotFoundResponse();
      }
    }

    let initializationReservation: InitializationReservation | undefined;
    if (!existing && isInitializeMessage(parsedBody)) {
      initializationReservation = reserveInitializationCapacity(
        definition.slug,
        appSessions,
        pendingInitializationsByApp,
        maxSessionsPerApp
      );
      if (!initializationReservation) {
        return sessionCapacityResponse(parsedBody);
      }
    }

    let uncommittedRecord: SessionRecord | undefined;
    try {
      const record =
        existing ??
        (await createSession(
          definition.createServer,
          appSessions,
          tokenFingerprint,
          requestTimeMs
        ));
      if (!existing) uncommittedRecord = record;
      record.lastSeenAtMs = requestTimeMs;

      const requestOptions = {
        ...(authInfo ? { authInfo } : {}),
        ...(parsedBody !== undefined ? { parsedBody } : {})
      };
      const response = await record.transport.handleRequest(c.req.raw, requestOptions);

      if (initializationReservation && response.ok && record.transport.sessionId) {
        const evicted = initializationReservation.commit(record.transport.sessionId, record);
        initializationReservation = undefined;
        uncommittedRecord = undefined;
        await Promise.all(evicted.map((evictedRecord) => closeSession(evictedRecord)));
      } else if (!existing) {
        uncommittedRecord = undefined;
        await closeSession(record);
      }
      await enforceSessionCapacity(appSessions, maxSessionsPerApp);

      return response;
    } finally {
      try {
        if (uncommittedRecord) await closeSession(uncommittedRecord);
      } finally {
        initializationReservation?.release();
      }
    }
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

function authorizeCredentialFreeRequest(
  request: Request,
  parsedBody: unknown
): CredentialFreeDecision {
  if (request.method === "GET") {
    return { allowed: true };
  }

  if (request.method === "DELETE") {
    return { allowed: true };
  }

  if (request.method !== "POST") {
    return { allowed: false };
  }

  if (parsedBody === undefined) {
    return { allowed: false };
  }

  return containsOnlyCredentialFreeMethods(parsedBody)
    ? { allowed: true, parsedBody }
    : { allowed: false, parsedBody };
}

class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeded the ${maxBytes}-byte limit`);
    this.name = "RequestBodyTooLargeError";
  }
}

async function parseRequestBodyForAuth(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  if (request.method !== "POST") return undefined;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  try {
    const body = request.clone().body;
    if (!body) return undefined;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          void reader.cancel();
          throw new RequestBodyTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return undefined;
  }
}

function containsOnlyCredentialFreeMethods(message: unknown): boolean {
  const messages = Array.isArray(message) ? message : [message];
  return messages.length > 0 && messages.every(isCredentialFreeMessage);
}

function isCredentialFreeMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const method = (message as { method?: unknown }).method;
  return typeof method === "string" && CREDENTIAL_FREE_METHODS.has(method);
}

function isInitializeMessage(message: unknown): boolean {
  const messages = Array.isArray(message) ? message : [message];
  return messages.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as { method?: unknown }).method === "initialize"
  );
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
    onsessionclosed: (sessionId) => {
      if (sessionId && sessions.get(sessionId) === record) sessions.delete(sessionId);
    }
  });
  record = { server, transport, tokenFingerprint, createdAtMs, lastSeenAtMs: createdAtMs };
  await server.connect(transport);
  return record;
}

function reserveInitializationCapacity(
  slug: string,
  sessions: SessionStore,
  pendingInitializations: PendingInitializationStore,
  maxEntries: number
): InitializationReservation | undefined {
  let state = pendingInitializations.get(slug);
  if (!state) {
    state = { count: 0, reservedSessions: new Set() };
    pendingInitializations.set(slug, state);
  }
  if (state.count >= maxEntries) return undefined;

  const reservedSessionCount = Array.from(sessions.values()).filter((record) =>
    state.reservedSessions.has(record)
  ).length;
  const projectedSize = sessions.size + state.count - reservedSessionCount;
  let evictionCandidate: [string, SessionRecord] | undefined;
  if (projectedSize >= maxEntries) {
    // Pin a distinct victim without removing it. The session remains usable
    // unless and until this reservation commits a successful replacement.
    evictionCandidate = Array.from(sessions.entries()).find(
      ([, record]) => !state.reservedSessions.has(record)
    );
    if (!evictionCandidate) {
      if (state.count === 0) pendingInitializations.delete(slug);
      return undefined;
    }
    state.reservedSessions.add(evictionCandidate[1]);
  }

  state.count += 1;
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    state.count = Math.max(0, state.count - 1);
    if (evictionCandidate) state.reservedSessions.delete(evictionCandidate[1]);
    if (state.count === 0 && pendingInitializations.get(slug) === state) {
      pendingInitializations.delete(slug);
    }
  };

  return {
    commit: (sessionId, record) => {
      if (!active) throw new Error("Initialization reservation is no longer active");

      const evicted: SessionRecord[] = [];
      if (evictionCandidate && sessions.get(evictionCandidate[0]) === evictionCandidate[1]) {
        sessions.delete(evictionCandidate[0]);
        evicted.push(evictionCandidate[1]);
      }
      sessions.set(sessionId, record);
      release();
      return evicted;
    },
    release
  };
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

async function enforceSessionCapacity(
  sessions: SessionStore,
  maxEntries: number
): Promise<void> {
  const evicted: SessionRecord[] = [];
  const targetSize = Math.max(0, maxEntries);

  // Map iteration order is insertion order, so this always removes the
  // longest-retained initialized session first, including when timestamps tie.
  while (sessions.size > targetSize) {
    const oldest = sessions.entries().next().value as
      | [string, SessionRecord]
      | undefined;
    if (!oldest) break;
    const [sessionId, record] = oldest;
    sessions.delete(sessionId);
    evicted.push(record);
  }

  await Promise.all(evicted.map((record) => closeSession(record)));
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

function positiveIntegerOrDefault(value: number | undefined, defaultValue: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : defaultValue;
}

function resolveAllowedCorsOrigins(configuredOrigins?: string[]): string[] {
  const rawOrigins = configuredOrigins ?? parseCorsAllowedOrigins(process.env[CORS_ALLOWED_ORIGINS_ENV]);
  const normalizedOrigins = Array.from(
    new Set(rawOrigins.map(normalizeCorsOrigin).filter((origin): origin is string => Boolean(origin)))
  );
  return normalizedOrigins;
}

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  return value?.split(",") ?? [];
}

function normalizeCorsOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "*") return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) return undefined;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function createCorsOriginResolver(allowedOrigins: readonly string[]): (origin: string) => string | undefined {
  const allowed = new Set(allowedOrigins);
  return (origin) => {
    const normalizedOrigin = normalizeCorsOrigin(origin);
    return normalizedOrigin && allowed.has(normalizedOrigin) ? normalizedOrigin : undefined;
  };
}

function isCorsOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  const normalizedOrigin = normalizeCorsOrigin(origin);
  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
}

function resolveConfiguredPublicEndpointContext(
  configuredBaseUrl?: string
): { publicOrigin: string; publicPathPrefix?: string } | undefined {
  const baseUrl = parsePublicBaseUrl(configuredBaseUrl ?? process.env[PUBLIC_BASE_URL_ENV]);
  if (!baseUrl) return undefined;

  return {
    publicOrigin: baseUrl.origin,
    publicPathPrefix: baseUrl.pathname
  };
}

function parsePublicBaseUrl(value: string | undefined): URL | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) return undefined;
    if (!url.host || url.username || url.password || url.search || url.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function resolvePublicEndpointContext(request: Request): { publicOrigin?: string; publicPathPrefix?: string } {
  const requestUrl = new URL(request.url);
  const forwarded = parseForwardedHeader(request.headers.get("forwarded"));
  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? forwarded.proto;
  const host = firstHeaderValue(request.headers.get("x-forwarded-host")) ?? forwarded.host;
  const publicOrigin = resolvePublicOrigin(proto, host, requestUrl.origin);

  return {
    publicOrigin,
    publicPathPrefix: firstHeaderValue(request.headers.get("x-forwarded-prefix"))
  };
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

function parseForwardedHeader(value: string | null): { proto?: string; host?: string } {
  const first = firstHeaderValue(value);
  if (!first) return {};

  const parsed: { proto?: string; host?: string } = {};
  for (const part of first.split(";")) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    const headerValue = rawValue.join("=").trim();
    if (!key || !headerValue) continue;

    const unquotedValue = headerValue.startsWith('"') && headerValue.endsWith('"') ? headerValue.slice(1, -1) : headerValue;
    if (key === "proto") parsed.proto = unquotedValue;
    if (key === "host") parsed.host = unquotedValue;
  }
  return parsed;
}

function resolvePublicOrigin(
  proto: string | undefined,
  host: string | undefined,
  fallbackOrigin: string
): string | undefined {
  const safeFallbackOrigin = parseAdvertisedOrigin(fallbackOrigin);
  if (!proto && !host) return safeFallbackOrigin;

  const protocol = normalizeProtocol(proto ?? new URL(fallbackOrigin).protocol);
  if (protocol !== "https:" && protocol !== "http:") return safeFallbackOrigin;
  if (!host) return safeFallbackOrigin;

  return parseAdvertisedOrigin(`${protocol}//${host}`) ?? safeFallbackOrigin;
}

function parseAdvertisedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) return undefined;
    if (!url.host || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function normalizeProtocol(value: string): string {
  return value.endsWith(":") ? value : `${value}:`;
}

function fingerprintBearerToken(token: string): string {
  return createHash("sha256").update("mcp-apps:bearer-token:v1\0").update(token).digest("hex");
}

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

function parseTelnyxApiKey(value: string | undefined): string | undefined {
  const normalized = normalizeCredential(value);
  return normalized && TELNYX_API_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeCredential(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function credentialsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function isLoopbackRequest(request: Request): boolean {
  try {
    const requestHostname = new URL(request.url).hostname;
    if (!isLoopbackHostname(requestHostname)) return false;

    const hostHeader = request.headers.get("host");
    return hostHeader === null || isLoopbackHostHeader(hostHeader);
  } catch {
    return false;
  }
}

function isLoopbackHostHeader(value: string): boolean {
  const host = value.trim();
  if (!host || host !== value || /[\s,@/?#]/.test(host)) return false;

  if (host.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(host);
    return Boolean(match && isValidPort(match[2]) && isLoopbackHostname(match[1] ?? ""));
  }

  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(host);
  return Boolean(match && isValidPort(match[2]) && isLoopbackHostname(match[1] ?? ""));
}

function isValidPort(value: string | undefined): boolean {
  return value === undefined || Number(value) <= 65_535;
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "::1") return true;

  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
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

function payloadTooLargeResponse(maxBytes: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Request body exceeds the ${maxBytes}-byte limit`
      },
      id: null
    }),
    {
      status: 413,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function sessionCapacityResponse(requestBody: unknown): Response {
  const id =
    requestBody && !Array.isArray(requestBody) && typeof requestBody === "object" && "id" in requestBody
      ? ((requestBody as { id?: unknown }).id ?? null)
      : null;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "MCP session capacity reached; retry initialization later"
      },
      id
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "1"
      }
    }
  );
}

function authenticationErrorResponse(
  requestBody: unknown,
  message: string,
  challenge: string
): Response {
  const messages = Array.isArray(requestBody) ? requestBody : [requestBody];
  const responses = messages.map((requestMessage) => ({
    jsonrpc: "2.0",
    id:
      requestMessage && typeof requestMessage === "object" && "id" in requestMessage
        ? ((requestMessage as { id?: unknown }).id ?? null)
        : null,
    result: {
      content: [{ type: "text", text: message }],
      _meta: { "mcp/www_authenticate": [challenge] },
      isError: true
    }
  }));
  const body = Array.isArray(requestBody) ? responses : responses[0];
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": challenge
    }
  });
}
