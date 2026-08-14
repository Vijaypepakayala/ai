import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";

// The HTTP mode is an UNAUTHENTICATED public boundary, so its guards are
// load-bearing. These tests drive the real built binary over real HTTP —
// the same way the transport will be exercised in production.
const PORT = 8391;
const BASE = `http://127.0.0.1:${PORT}/mcp`;
const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }
});
const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const MAX_BODY_BYTES = 180;

let proc: ChildProcess;

beforeAll(async () => {
  proc = spawn("node", [join(process.cwd(), "dist/cli.js"), "--http", String(PORT)], {
    env: {
      ...process.env,
      TELNYX_DOCS_MCP_HOST: "127.0.0.1",
      TELNYX_DOCS_MCP_ALLOWED_ORIGINS: "https://good.example",
      TELNYX_DOCS_MCP_MAX_BODY: String(MAX_BODY_BYTES)
    },
    stdio: "ignore"
  });
  // wait for listen
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE, { method: "POST", headers: HEADERS, body: INIT });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
}, 20_000);

afterAll(() => {
  proc?.kill();
});

describe("unauthenticated HTTP boundary", () => {
  it("rejects a disallowed browser Origin with 403", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { ...HEADERS, Origin: "https://evil.example" },
      body: INIT
    });
    expect(res.status).toBe(403);
  });

  it("rejects unsupported methods before reading their body", async () => {
    const response = await rawIncompleteRequest(
      `PUT /mcp HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${MAX_BODY_BYTES}\r\n` +
        `Connection: keep-alive\r\n\r\n` +
        `x`
    );

    expect(response.status).toBe(405);
    expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
    expect(response.closedAfterMs).toBeLessThan(2_000);
  });

  it.each([
    ["a disallowed Origin", "/mcp", "https://evil.example", 403],
    ["an unknown path", "/not-mcp", "https://good.example", 404]
  ])(
    "closes the socket after rejecting %s before reading its incomplete body",
    async (_caseName, path, origin, expectedStatus) => {
      const response = await rawIncompleteRequest(
        `POST ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${PORT}\r\n` +
          `Origin: ${origin}\r\n` +
          `Content-Type: application/json\r\n` +
          `Accept: application/json, text/event-stream\r\n` +
          `Content-Length: ${MAX_BODY_BYTES + 1}\r\n` +
          `Connection: keep-alive\r\n\r\n` +
          `x`
      );

      expect(response.status).toBe(expectedStatus);
      expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
      expect(response.closedAfterMs).toBeLessThan(2_000);
    }
  );

  it("accepts an allowlisted Origin", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { ...HEADERS, Origin: "https://good.example" },
      body: INIT
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://good.example");
    expect(res.headers.get("access-control-expose-headers")).toContain("www-authenticate");
  });

  it("answers an allowlisted browser CORS preflight", async () => {
    const res = await fetch(BASE, {
      method: "OPTIONS",
      headers: {
        Origin: "https://good.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,mcp-protocol-version,accept"
      }
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://good.example");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it.each([
    ["an incomplete under-limit body", MAX_BODY_BYTES],
    ["a declared oversized body", MAX_BODY_BYTES + 1]
  ])("closes the socket after an allowlisted preflight with %s", async (_caseName, length) => {
    const response = await rawIncompleteRequest(
      `OPTIONS /mcp HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Origin: https://good.example\r\n` +
        `Access-Control-Request-Method: POST\r\n` +
        `Access-Control-Request-Headers: content-type\r\n` +
        `Content-Length: ${length}\r\n` +
        `Connection: keep-alive\r\n\r\n` +
        `x`
    );

    expect(response.status).toBe(204);
    expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
    expect(response.closedAfterMs).toBeLessThan(2_000);
  });

  it("lets browser clients observe the unsupported optional GET stream", async () => {
    const preflight = await fetch(BASE, {
      method: "OPTIONS",
      headers: {
        Origin: "https://good.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "accept,mcp-protocol-version"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("GET");

    const response = await fetch(BASE, {
      method: "GET",
      headers: {
        Origin: "https://good.example",
        Accept: "text/event-stream",
        "Mcp-Protocol-Version": "2025-06-18"
      }
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://good.example"
    );
  });

  it("does not grant CORS to an unapproved browser preflight", async () => {
    const res = await fetch(BASE, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST"
      }
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves non-browser clients that send no Origin", async () => {
    const res = await fetch(BASE, { method: "POST", headers: HEADERS, body: INIT });
    expect(res.status).toBe(200);
  });

  it("rejects a mismatched Host header (DNS rebinding) with 403", async () => {
    // fetch() silently drops a custom Host header (forbidden header name), so
    // drive a raw request to actually exercise the host allowlist.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: PORT,
          path: "/mcp",
          method: "POST",
          headers: { ...HEADERS, Host: "evil.example", "Content-Length": Buffer.byteLength(INIT) }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end(INIT);
    });
    expect(status).toBe(403);
  });

  it("rejects a disallowed Host before reading its incomplete under-limit body", async () => {
    const response = await rawIncompleteRequest(
      `POST /mcp HTTP/1.1\r\n` +
        `Host: evil.example\r\n` +
        `Origin: https://good.example\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: ${MAX_BODY_BYTES}\r\n` +
        `Connection: keep-alive\r\n\r\n` +
        `x`
    );

    expect(response.status).toBe(403);
    expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
    expect(response.closedAfterMs).toBeLessThan(2_000);
  });

  it("closes the socket after rejecting a declared oversized incomplete body", async () => {
    const response = await rawIncompleteRequest(
      `POST /mcp HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: ${MAX_BODY_BYTES + 1}\r\n` +
        `Connection: keep-alive\r\n\r\n` +
        `x`
    );

    expect(response.status).toBe(413);
    expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
    expect(response.closedAfterMs).toBeLessThan(2_000);
  });

  it("closes the socket after a chunked body crosses the cap before ending", async () => {
    const oversizedChunk = "x".repeat(MAX_BODY_BYTES + 1);
    const response = await rawIncompleteRequest(
      `POST /mcp HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PORT}\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Transfer-Encoding: chunked\r\n` +
        `Connection: keep-alive\r\n\r\n` +
        `${oversizedChunk.length.toString(16)}\r\n${oversizedChunk}\r\n`
    );

    expect(response.status).toBe(413);
    expect(response.headers).toMatch(/\r\nconnection:\s*close\r\n/i);
    expect(response.closedAfterMs).toBeLessThan(2_000);
  });

  it("preserves a UTF-8 character split across request chunks", async () => {
    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "🙂",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "0" }
        }
      })
    );
    expect(body.byteLength).toBeLessThanOrEqual(MAX_BODY_BYTES);
    const emojiOffset = body.indexOf(Buffer.from("🙂"));
    expect(emojiOffset).toBeGreaterThanOrEqual(0);

    const response = await rawPost(
      [body.subarray(0, emojiOffset + 2), body.subarray(emojiOffset + 2)],
      { "Content-Length": String(body.byteLength) }
    );

    expect(response.status).toBe(200);
    expect((JSON.parse(response.body) as { id?: unknown }).id).toBe("🙂");
  });

  it("enforces the byte cap without Content-Length", async () => {
    // This is 174 UTF-16 code units but 194 UTF-8 bytes. The old raw.length
    // check accepted it under a 180-byte limit.
    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "🙂".repeat(10),
        method: "ping",
        padding: "x".repeat(100)
      })
    );
    expect(body.toString("utf8").length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(body.byteLength).toBeGreaterThan(MAX_BODY_BYTES);

    const response = await rawPost([body.subarray(0, 100), body.subarray(100)]);
    expect(response.status).toBe(413);
  });

  it("refuses to start with an invalid configured byte limit", async () => {
    const result = await runCliToExit(PORT + 1, {
      TELNYX_DOCS_MCP_MAX_BODY: "180bytes"
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "TELNYX_DOCS_MCP_MAX_BODY must be a positive integer number of bytes"
    );
  });

  it.each(["0", "65536", "8080junk"])(
    "refuses invalid HTTP port %s",
    async (configuredPort) => {
      const result = await runCliToExit(configuredPort, {});
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("--http port must be an integer from 1 through 65535");
    }
  );

  it("refuses an explicitly empty host allowlist even on loopback", async () => {
    const result = await runCliToExit(PORT + 1, {
      TELNYX_DOCS_MCP_HOST: "127.0.0.1",
      TELNYX_DOCS_MCP_ALLOWED_HOSTS: " , "
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("TELNYX_DOCS_MCP_ALLOWED_HOSTS must contain at least one host");
  });

  it.each([
    ["unset", undefined],
    ["empty after normalization", " , "]
  ])("refuses a public bind when allowed hosts are %s", async (_caseName, allowedHosts) => {
    const result = await runCliToExit(PORT + 1, {
      TELNYX_DOCS_MCP_HOST: "0.0.0.0",
      TELNYX_DOCS_MCP_ALLOWED_HOSTS: allowedHosts,
      TELNYX_DOCS_MCP_MAX_BODY: String(MAX_BODY_BYTES)
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("TELNYX_DOCS_MCP_ALLOWED_HOSTS");
  });

  it("still answers a real tool call", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "telnyx__search", arguments: { query: "send sms", limit: 2 } }
      })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
    const results = JSON.parse(body.result.content[0].text).results;
    expect(results.length).toBeGreaterThan(0);
  });
});

async function rawPost(
  chunks: Buffer[],
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          ...HEADERS,
          Origin: "https://good.example",
          ...headers
        }
      },
      (res) => {
        const responseChunks: Buffer[] = [];
        res.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString("utf8")
          })
        );
      }
    );
    req.once("error", reject);

    const write = (index: number): void => {
      if (index === chunks.length - 1) {
        req.end(chunks[index]);
        return;
      }
      req.write(chunks[index]);
      // Separate writes at the socket boundary so the server must handle a
      // multi-byte code point split across distinct request chunks.
      setTimeout(() => write(index + 1), 10);
    };
    write(0);
  });
}

async function rawIncompleteRequest(
  request: string
): Promise<{ status: number; headers: string; closedAfterMs: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    const responseChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("server did not close rejected request socket promptly"));
    }, 2_000);

    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
    socket.once("close", () => {
      clearTimeout(timer);
      const response = Buffer.concat(responseChunks).toString("utf8");
      const headers = response.split("\r\n\r\n", 1)[0] ?? "";
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(headers)?.[1] ?? 0);
      resolve({ status, headers, closedAfterMs: Date.now() - startedAt });
    });
    socket.once("connect", () => socket.write(request));
  });
}

async function runCliToExit(
  port: number | string,
  overrides: Record<string, string | undefined>
): Promise<{ code: number | null; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
  }
  const child = spawn("node", [join(process.cwd(), "dist/cli.js"), "--http", String(port)], {
    env,
    stdio: ["ignore", "ignore", "pipe"]
  });

  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("invalid-configuration child did not exit"));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}
