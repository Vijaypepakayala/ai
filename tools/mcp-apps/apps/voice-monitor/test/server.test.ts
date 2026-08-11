import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { VOICE_MONITOR_UI_HTML } from "../src/ui.js";

const SECURITY_META_MARKERS = [
  '<meta name="color-scheme" content="light dark" />',
  '<meta http-equiv="Content-Security-Policy"',
  "default-src 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'"
];

describe("Voice Monitor MCP server", () => {
  it("registers read-only tools with the Voice Monitor UI resource", () => {
    const server = createServer();
    const internal = server as unknown as {
      _registeredTools: Record<
        string,
        {
          description?: string;
          _meta?: unknown;
          annotations?: Record<string, boolean>;
          outputSchema?: unknown;
        }
      >;
      _registeredResources: Record<
        string,
        {
          metadata?: {
            _meta?: { ui?: { domain?: string; csp?: unknown } };
          };
        }
      >;
    };
    const tools = internal._registeredTools;

    expect(Object.keys(tools).sort()).toEqual(
      [
        "voice_monitor_dashboard",
        "voice_monitor_active_calls",
        "voice_monitor_call_status",
        "voice_monitor_call_timeline",
        "voice_monitor_list_options",
        "voice_monitor_recordings"
      ].sort()
    );
    for (const tool of Object.values(tools)) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
    }
    expect(JSON.stringify(tools.voice_monitor_dashboard?._meta)).toContain("ui://voice-monitor/index.html");
    expect(JSON.stringify(tools.voice_monitor_active_calls?._meta)).not.toContain("resourceUri");
    expect(JSON.stringify(tools.voice_monitor_active_calls?._meta)).toContain("app");
    expect(tools.voice_monitor_active_calls?.description).toMatch(/Call Control Application/i);
    expect(tools.voice_monitor_list_options?.description).toMatch(/dropdown/i);
    const resourceUi = internal._registeredResources["ui://voice-monitor/index.html"]?.metadata?._meta?.ui;
    expect(resourceUi?.domain).toBe("https://telnyx-developer-kit.telnyx.com");
    expect(resourceUi?.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: []
    });
  });

  it("publishes tool-specific schemas and read-response UI metadata", async () => {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "voice-monitor-test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
      const expectedProperties: Record<string, string[]> = {
        voice_monitor_dashboard: ["options", "active_calls"],
        voice_monitor_list_options: ["options", "summary", "warnings", "limits"],
        voice_monitor_active_calls: [
          "connections_consulted",
          "truncated_output",
          "total_active_calls",
          "active_calls",
          "per_connection"
        ],
        voice_monitor_call_timeline: ["data", "filters_notice", "applied_filters"],
        voice_monitor_call_status: ["data", "meta"],
        voice_monitor_recordings: ["data", "applied_filters"]
      };
      for (const [name, properties] of Object.entries(expectedProperties)) {
        expect(Object.keys((tools[name]?.outputSchema?.properties ?? {}))).toEqual(expect.arrayContaining(properties));
        expectNoUnconstrainedSchemas(tools[name]?.outputSchema, name);
      }

      const resource = (await client.listResources()).resources[0];
      const content = (await client.readResource({ uri: resource.uri })).contents[0];
      expect(content?._meta).toEqual({
        ui: {
          domain: "https://telnyx-developer-kit.telnyx.com",
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }
        }
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a final tool result that exceeds the serialized output cap", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "call_oversized",
            call_control_id: "call_control_oversized",
            provider_fragments: Array.from({ length: 300 }, () => "x".repeat(4096))
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const server = createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<
            string,
            {
              handler: (
                args: Record<string, unknown>,
                extra?: { authInfo?: { token?: string } }
              ) => Promise<unknown>;
            }
          >;
        }
      )._registeredTools;

      const result = await tools.voice_monitor_call_status.handler(
        { call_control_id: "call_control_oversized" },
        { authInfo: { token: "KEY_TEST_OUTPUT_LIMIT" } }
      );

      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: "Tool output exceeded the safe size limit. Narrow the request and try again."
          }
        ]
      });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(1024);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("keeps the combined dashboard response within the serialized output cap", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      const data = path.endsWith("/call_control_applications")
        ? Array.from({ length: 100 }, (_, index) => ({
            id: `app_output_cap_${index}`,
            application_name: `Output cap app ${index} ${"x".repeat(7000)}`
          }))
        : path.endsWith("/connections")
          ? Array.from({ length: 100 }, (_, index) => ({
              id: `connection_output_cap_${index}`,
              connection_name: `Output cap connection ${index} ${"y".repeat(7000)}`
            }))
        : path.includes("/active_calls")
          ? []
          : [];
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<string, {
          handler: (
            args: Record<string, unknown>,
            extra?: { authInfo?: { token?: string } }
          ) => Promise<Record<string, unknown>>;
        }>;
      })._registeredTools;
      const result = await tools.voice_monitor_dashboard.handler(
        { page_size: 100 },
        { authInfo: { token: "KEY_TEST_DASHBOARD_OUTPUT_LIMIT" } }
      );

      expect(result).not.toHaveProperty("isError");
      expect(result).toMatchObject({
        structuredContent: {
          active_calls: {
            truncated_output: true,
            total_active_calls: 0,
            active_calls: [],
            connections_consulted: expect.arrayContaining(["app_output_cap_0"]),
            per_connection: expect.arrayContaining([
              { connection_id: "app_output_cap_0", active_call_count: 0 }
            ])
          }
        }
      });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
        1024 * 1024
      );
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("validates provider-specific voice fields against the advertised output schema", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_OUTPUT_SCHEMA";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "call_1",
            call_control_id: "call_control_keep_for_followup",
            client_state: "provider-state"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "voice-monitor-output-schema-test", version: "1.0.0" },
      { capabilities: {} }
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listedTools = await client.listTools();
      const advertisedSchema = listedTools.tools.find(
        (tool) => tool.name === "voice_monitor_call_status"
      )?.outputSchema;
      const result = await client.callTool({
        name: "voice_monitor_call_status",
        arguments: { call_control_id: "call_control_keep_for_followup" }
      });

      expect(result).toMatchObject({
        structuredContent: {
          data: {
            id: "call_1",
            call_control_id: "call_control_keep_for_followup",
            client_state: "[redacted-metadata]"
          }
        }
      });
      expect(advertisedSchema).toBeDefined();
      const validate = new Ajv({ strict: false }).compile(advertisedSchema as object);
      expect(
        validate(result.structuredContent),
        JSON.stringify(validate.errors)
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("returns a safe tool error without network when TELNYX_API_KEY is missing", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.voice_monitor_list_options.handler({}, {});

      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("TELNYX_API_KEY is not set");
      expect(JSON.stringify(result)).not.toContain("Authorization");
    } finally {
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it.each([401, 403])(
    "returns the internal %i marker for direct, aggregate, and per-connection voice reads",
    async (status) => {
      const oldFetch = globalThis.fetch;
      const userSecret = "KEY_TEST_VOICE_SECRET";
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                title: "Authorization failed",
                detail: `Bearer ${userSecret}`
              }
            ]
          }),
          { status, headers: { "content-type": "application/json" } }
        )) as typeof fetch;

      try {
        const server = createServer();
        const tools = (
          server as unknown as {
            _registeredTools: Record<
              string,
              {
                handler: (
                  args: Record<string, unknown>,
                  extra?: { authInfo?: { token?: string } }
                ) => Promise<unknown>;
              }
            >;
          }
        )._registeredTools;
        const calls: Array<[string, Record<string, unknown>]> = [
          ["voice_monitor_call_status", { call_control_id: "call-control-id" }],
          ["voice_monitor_list_options", {}],
          ["voice_monitor_active_calls", { connection_id: "connection-id" }]
        ];

        for (const [toolName, args] of calls) {
          const result = await tools[toolName]?.handler(
            args,
            { authInfo: { token: userSecret } }
          );
          const serialized = JSON.stringify(result);

          expect(result).toMatchObject({
            isError: true,
            _meta: { "telnyx/internal-http-status": status }
          });
          expect(serialized).not.toContain(userSecret);
          expect(serialized).not.toContain("Authorization failed");
        }
      } finally {
        globalThis.fetch = oldFetch;
      }
    }
  );

  it("sanitizes successful tool output while preserving operational call IDs", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            connection_id: "conn_keep_for_followup",
            call_control_id: "call_control_keep_for_followup",
            call_leg_id: "leg_keep_for_followup",
            call_session_id: "session_keep_for_followup",
            client_state: "base64-user-supplied-private-state",
            from: "+15551234567",
            recording_url: "https://recordings.example.test/secret.wav?token=abc123",
            authorization: "Bearer should-not-leak"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.voice_monitor_call_status.handler({ call_control_id: "call_control_keep_for_followup" }, {});
      const serialized = JSON.stringify(result);

      expect(serialized).toContain("conn_keep_for_followup");
      expect(serialized).toContain("call_control_keep_for_followup");
      expect(serialized).toContain("[redacted-phone]");
      expect(serialized).toContain("[redacted-recording-url]");
      expect(serialized).toContain("[redacted-secret]");
      expect(serialized).not.toContain("15551234567");
      expect(serialized).not.toContain("base64-user-supplied-private-state");
      expect(serialized).not.toContain("secret.wav");
      expect(serialized).not.toContain("should-not-leak");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it.each([
    {
      toolName: "voice_monitor_call_timeline",
      args: { call_leg_id: "leg_keep_for_followup" },
      data: [{ id: "event_1", call_leg_id: "leg_keep_for_followup", metadata: { private: "value" } }]
    },
    {
      toolName: "voice_monitor_call_status",
      args: { call_control_id: "call_control_keep_for_followup" },
      data: { id: "call_control_keep_for_followup", status: "answered" }
    },
    {
      toolName: "voice_monitor_recordings",
      args: { call_control_id: "call_control_keep_for_followup" },
      data: [{
        id: "recording_1",
        download_urls: {
          mp3: "https://recordings.example.test/private.mp3",
          wav: "https://recordings.example.test/private.wav"
        }
      }]
    }
  ])("preserves bounded object pagination metadata for $toolName", async ({ toolName, args, data }) => {
    const oldFetch = globalThis.fetch;
    const responseMeta = {
      total_pages: 3,
      total_results: 55,
      page_number: 2,
      page_size: 25,
      cursor: { before: null, after: "cursor_keep_for_followup" }
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data, meta: responseMeta }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;

    try {
      const server = createServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<
            string,
            {
              handler: (
                args: Record<string, unknown>,
                extra?: { authInfo?: { token?: string } }
              ) => Promise<unknown>;
            }
          >;
        }
      )._registeredTools;

      const result = await tools[toolName]?.handler(
        args,
        { authInfo: { token: "KEY_TEST_VOICE_SECRET" } }
      );

      expect(result).toMatchObject({
        structuredContent: { meta: responseMeta }
      });
      expect(JSON.stringify(result)).not.toContain("private.wav");
      expect(JSON.stringify(result)).not.toContain("private.mp3");
      if (toolName === "voice_monitor_recordings") {
        expect(JSON.stringify(result)).toContain("[redacted-recording-url]");
      }
      if (toolName === "voice_monitor_call_timeline") {
        expect(JSON.stringify(result)).toContain("[redacted-metadata]");
      }
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("exports a self-contained UI that loads options into dropdowns and has JSON fallback", () => {
    expect(VOICE_MONITOR_UI_HTML).toContain("Voice Monitor");
    expect(VOICE_MONITOR_UI_HTML).toContain("voice_monitor_dashboard");
    expect(VOICE_MONITOR_UI_HTML).toContain("voice_monitor_list_options");
    expect(VOICE_MONITOR_UI_HTML).toContain("connectionSelect");
    expect(VOICE_MONITOR_UI_HTML).toContain("sipConnectionSelect");
    expect(VOICE_MONITOR_UI_HTML).toContain("idTypeSelect");
    expect(VOICE_MONITOR_UI_HTML).toMatch(/manual JSON fallback/i);
  });

  it("includes ORA scanner security metadata on the UI HTML resource", () => {
    expect(VOICE_MONITOR_UI_HTML).toMatch(/^<!doctype html>/i);
    for (const marker of SECURITY_META_MARKERS) {
      expect(VOICE_MONITOR_UI_HTML).toContain(marker);
    }
    expect(contentSecurityPolicy(VOICE_MONITOR_UI_HTML)).not.toMatch(/https?:|wss?:|\*\./i);
  });
});

function expectNoUnconstrainedSchemas(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  expect(Object.keys(value), `${label} contains an unconstrained schema`).not.toHaveLength(0);
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    expectNoUnconstrainedSchemas(nested, label);
  }
}

function contentSecurityPolicy(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] ?? "";
}
