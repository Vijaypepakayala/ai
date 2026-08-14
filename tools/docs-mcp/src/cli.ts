#!/usr/bin/env node
// Entry point. Default: stdio (Claude Code / Claude Desktop). With
// --http <port>: a stateless streamable-HTTP endpoint at /mcp — the same
// deployment shape as a claude.ai remote connector (read-only, no auth).
import {
  createServer as createHttpServer,
  type ServerResponse
} from "node:http";
import type { Socket } from "node:net";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer, loadIndex } from "./server.js";

const CORS_ALLOW_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "mcp-protocol-version"
] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const httpIdx = args.indexOf("--http");
  const index = loadIndex();

  if (httpIdx >= 0) {
    const rawPort = args[httpIdx + 1] ?? "8080";
    if (!/^[1-9]\d*$/.test(rawPort)) {
      throw new Error("--http port must be an integer from 1 through 65535");
    }
    const port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port > 65_535) {
      throw new Error("--http port must be an integer from 1 through 65535");
    }
    // Bind loopback by default: a local dev run must not expose an
    // unauthenticated server on every interface. Production deployments set
    // TELNYX_DOCS_MCP_HOST=0.0.0.0 explicitly (behind a gateway/TLS).
    const host = process.env.TELNYX_DOCS_MCP_HOST ?? "127.0.0.1";
    // DNS-rebinding / cross-origin protection. Browser origins must be
    // allowlisted explicitly; the MCP Streamable HTTP spec requires invalid
    // Origins to be rejected rather than served.
    const allowedOrigins = (process.env.TELNYX_DOCS_MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const configuredAllowedHosts = process.env.TELNYX_DOCS_MCP_ALLOWED_HOSTS;
    const allowedHosts = (configuredAllowedHosts ?? `127.0.0.1:${port},localhost:${port}`)
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (configuredAllowedHosts !== undefined && allowedHosts.length === 0) {
      throw new Error("TELNYX_DOCS_MCP_ALLOWED_HOSTS must contain at least one host");
    }
    // Cap the request body before the SDK parses it — an unauthenticated
    // public endpoint must not buffer unbounded input.
    const maxBodyBytes = positiveSafeIntegerEnv(
      "TELNYX_DOCS_MCP_MAX_BODY",
      1_048_576
    );

    const http = createHttpServer(async (req, res) => {
      // Retain the socket before any early return or request-body iteration;
      // abandoning the async iterator may clear req.socket.
      const requestSocket = req.socket;
      if (req.url?.split("?")[0] !== "/mcp") {
        rejectRequest(requestSocket, res, 404, "");
        return;
      }
      // Deny-by-default Origin policy. Validate before method dispatch so an
      // approved browser can complete its OPTIONS preflight without reaching
      // the MCP transport, while unapproved origins receive no CORS grant.
      const originHeader = req.headers.origin;
      const origin = Array.isArray(originHeader) ? undefined : originHeader;
      if (originHeader && (!origin || !allowedOrigins.includes(origin))) {
        rejectRequest(
          requestSocket,
          res,
          403,
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: `Invalid Origin header: ${String(originHeader)}` },
            id: null
          })
        );
        return;
      }
      if (req.method === "OPTIONS") {
        const requestedMethod = req.headers["access-control-request-method"];
        const requestedHeaders = String(
          req.headers["access-control-request-headers"] ?? ""
        )
          .split(",")
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          !origin ||
          !["GET", "POST"].includes(requestedMethod?.toUpperCase() ?? "") ||
          requestedHeaders.some(
            (header) => !CORS_ALLOW_HEADERS.includes(header as (typeof CORS_ALLOW_HEADERS)[number])
          )
        ) {
          rejectRequest(requestSocket, res, 403, "");
          return;
        }
        // A preflight has no application body. Close the connection after the
        // response so an attacker cannot attach a slow or oversized unread
        // request body to this early-return path.
        res.shouldKeepAlive = false;
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS.join(", "),
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
          "Cache-Control": "no-store",
          Connection: "close"
        });
        res.end(() => requestSocket.destroy());
        return;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
          "Access-Control-Expose-Headers",
          "mcp-session-id, www-authenticate"
        );
        res.setHeader("Vary", "Origin");
      }
      // This deployment is deliberately stateless and JSON-response only.
      // Streamable HTTP permits a server that does not offer an SSE listening
      // stream to reject GET, and there are no sessions for DELETE to close.
      // Reject every non-POST method before reading an attacker-controlled body
      // so an unsupported slow request cannot occupy the process until timeout.
      if (req.method !== "POST") {
        rejectRequest(requestSocket, res, 405, "");
        return;
      }
      // Match the SDK's Host allowlist semantics before touching the request
      // body. Leaving this check to handleRequest below lets a disallowed Host
      // hold the socket open indefinitely by sending an incomplete body that
      // remains under the configured size cap.
      if (allowedHosts.length > 0) {
        const hostHeader = req.headers.host;
        if (!hostHeader || !allowedHosts.includes(hostHeader)) {
          rejectRequest(
            requestSocket,
            res,
            403,
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: `Invalid Host header: ${hostHeader}` },
              id: null
            })
          );
          return;
        }
      }

      const declaredHeader = req.headers["content-length"];
      if (declaredHeader !== undefined) {
        const declared = Number(declaredHeader);
        if (
          Array.isArray(declaredHeader) ||
          !/^(0|[1-9]\d*)$/.test(String(declaredHeader)) ||
          !Number.isSafeInteger(declared)
        ) {
          rejectRequest(
            requestSocket,
            res,
            400,
            JSON.stringify({ error: "invalid Content-Length" })
          );
          return;
        }
        if (declared > maxBodyBytes) {
          rejectRequest(
            requestSocket,
            res,
            413,
            JSON.stringify({ error: "request body too large" })
          );
          return;
        }
      }
      // Enforce the byte cap on the stream too (a missing/lying
      // Content-Length must not bypass it). Read the body ourselves and hand
      // the parsed value to handleRequest — attaching a 'data' listener and
      // ALSO letting the transport read the stream consumes it twice, which
      // surfaces as a bogus JSON parse error.
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      let tooLarge = false;
      try {
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const nextSize = bytesRead + buffer.byteLength;
          if (nextSize > maxBodyBytes) {
            tooLarge = true;
            break;
          }
          chunks.push(buffer);
          bytesRead = nextSize;
        }
      } catch {
        rejectRequest(
          requestSocket,
          res,
          400,
          JSON.stringify({ error: "could not read request body" })
        );
        return;
      }
      if (tooLarge) {
        rejectRequest(
          requestSocket,
          res,
          413,
          JSON.stringify({ error: "request body too large" })
        );
        return;
      }
      // Decode once after all byte chunks have been joined. Decoding individual
      // chunks can replace a multi-byte UTF-8 character split at a chunk edge.
      const raw = Buffer.concat(chunks, bytesRead).toString("utf8");
      let parsedBody: unknown;
      if (raw.length > 0) {
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: Invalid JSON" }, id: null }));
          return;
        }
      }

      // Stateless mode: a fresh server+transport per request, no sessions —
      // the right shape for a read-only public docs endpoint.
      const server = createServer(index);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts,
        allowedOrigins
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    });
    // Deployment guard: binding a non-loopback interface while the host
    // allowlist still only contains loopback would 403 every real request.
    // Fail loudly at startup instead of serving a silently-broken endpoint.
    if (
      host !== "127.0.0.1" &&
      host !== "localhost" &&
      configuredAllowedHosts === undefined
    ) {
      console.error(
        `[telnyx-docs] refusing to start: TELNYX_DOCS_MCP_HOST=${host} exposes a non-loopback interface but ` +
          `TELNYX_DOCS_MCP_ALLOWED_HOSTS is unset or empty, so host validation would be disabled. ` +
          `Set TELNYX_DOCS_MCP_ALLOWED_HOSTS to the public hostname(s) this server answers on.`
      );
      process.exit(2);
    }

    http.listen(port, host, () => {
      console.error(
        `[telnyx-docs] streamable HTTP on ${host}:${port}/mcp (${index.size} docs, read-only, no auth) ` +
          `| allowed hosts: ${allowedHosts.join(",")} | allowed origins: ${allowedOrigins.join(",") || "(none — non-browser clients only)"} ` +
          `| max body: ${maxBodyBytes}B`
      );
    });
    return;
  }

  const server = createServer(index);
  await server.connect(new StdioServerTransport());
  console.error(`[telnyx-docs] ready (stdio, ${index.size} docs)`);
}

main().catch((err) => {
  console.error("[telnyx-docs] fatal:", err);
  process.exit(1);
});

function positiveSafeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer number of bytes`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer number of bytes`);
  }
  return parsed;
}

function rejectRequest(
  socket: Socket,
  res: ServerResponse,
  status: 400 | 403 | 404 | 405 | 413,
  body: string
): void {
  // Never leave an attacker-controlled, incomplete request attached to a
  // keep-alive socket after an early rejection. Flush the bounded response
  // first, then tear down the connection.
  res.shouldKeepAlive = false;
  res.writeHead(status, {
    ...(body ? { "Content-Type": "application/json" } : {}),
    Connection: "close"
  });
  res.end(body, () => socket.destroy());
}
