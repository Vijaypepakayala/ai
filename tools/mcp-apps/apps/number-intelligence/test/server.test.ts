import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

describe("Number Intelligence MCP server metadata", () => {
  it("discloses billable lookup side effects on single and batch tools", () => {
    const server = createServer();
    const internal = server as unknown as {
      _registeredTools: Record<
        string,
        {
          description?: string;
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

    for (const name of [
      "number_intelligence_analyze",
      "number_intelligence_batch_analyze"
    ]) {
      expect(tools[name]?.description).toMatch(/billable/i);
      expect(tools[name]?.description).toMatch(/incur lookup charges/i);
      expect(tools[name]?.description).toMatch(/affect account balance/i);
      expect(tools[name]?.description).toMatch(/additional Telnyx API requests/i);
      expect(tools[name]?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      });
      expect(tools[name]?.outputSchema).toBeDefined();
    }
    const resourceUi = internal._registeredResources["ui://number-intelligence/index.html"]?.metadata?._meta?.ui;
    expect(resourceUi?.domain).toBe("https://telnyx-developer-kit.telnyx.com");
    expect(resourceUi?.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: []
    });
  });

  it("publishes distinct constrained schemas and read-response UI metadata", async () => {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "number-intelligence-test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
      expect(Object.keys((tools.number_intelligence_analyze?.outputSchema?.properties ?? {}))).toEqual(
        expect.arrayContaining(["input", "normalized", "health", "signals", "recommended_actions"])
      );
      expect(Object.keys((tools.number_intelligence_batch_analyze?.outputSchema?.properties ?? {}))).toEqual(
        expect.arrayContaining([
          "requested_total",
          "queried_total",
          "total",
          "truncated",
          "warnings",
          "aggregate",
          "results"
        ])
      );
      for (const tool of Object.values(tools)) {
        expectNoUnconstrainedSchemas(tool.outputSchema, tool.name);
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

  it("validates nested provider fields against the advertised output schema", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_OUTPUT_SCHEMA";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            record_type: "number_lookup",
            phone_number: "+13125550123",
            national_format: "(312) 555-0123",
            country_code: "US",
            carrier: {
              name: "Example Carrier",
              type: "mobile",
              provider_network: "example-network"
            },
            caller_name: {
              caller_name: "Example Caller",
              provider_confidence: "high"
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "number-intelligence-output-schema-test", version: "1.0.0" },
      { capabilities: {} }
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listedTools = await client.listTools();
      const advertisedSchema = listedTools.tools.find(
        (tool) => tool.name === "number_intelligence_analyze"
      )?.outputSchema;
      const result = await client.callTool({
        name: "number_intelligence_analyze",
        arguments: {
          phone_number: "+13125550123",
          include_raw: true,
          sources: ["lookup"]
        }
      });

      expect(result).toMatchObject({
        structuredContent: {
          raw: {
            telnyx_number_lookup: {
              data: {
                record_type: "number_lookup",
                carrier: { provider_network: "example-network" },
                caller_name: { provider_confidence: "high" }
              }
            }
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

  it.each([401, 403])(
    "returns the internal %i marker without exposing upstream auth details",
    async (status) => {
      const oldFetch = globalThis.fetch;
      const userSecret = "KEY_TEST_NUMBER_INTELLIGENCE_SECRET";
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

        const result = await tools.number_intelligence_analyze.handler(
          {
            phone_number: "+15551234567",
            sources: ["lookup"]
          },
          { authInfo: { token: userSecret } }
        );
        const serialized = JSON.stringify(result);

        expect(result).toMatchObject({
          isError: true,
          _meta: { "telnyx/internal-http-status": status }
        });
        expect(serialized).not.toContain(userSecret);
        expect(serialized).not.toContain("Authorization failed");
      } finally {
        globalThis.fetch = oldFetch;
      }
    }
  );

  it("does not downgrade an enrichment authorization failure into a partial success", async () => {
    const oldFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            data: {
              phone_number: "+15551234567",
              country_code: "US",
              carrier: { name: "Example", type: "mobile" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          errors: [{ title: "Forbidden", detail: "insufficient scope" }]
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

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

      const result = await tools.number_intelligence_analyze.handler(
        {
          phone_number: "+15551234567",
          sources: ["lookup", "owned"]
        },
        { authInfo: { token: "KEY_TEST_ENRICHMENT_SCOPE" } }
      );

      expect(requestCount).toBe(2);
      expect(result).toMatchObject({
        isError: true,
        _meta: { "telnyx/internal-http-status": 403 }
      });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("returns a safe ambiguous-outcome error for retryable upstream failures", async () => {
    const oldFetch = globalThis.fetch;
    const userSecret = "KEY_abcdefghijklmnopqrstuv";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              title: "Temporary upstream failure",
              detail: `Authorization: Bearer ${userSecret}`
            }
          ]
        }),
        { status: 500, headers: { "content-type": "application/json" } }
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

      const result = await tools.number_intelligence_analyze.handler(
        {
          phone_number: "+15551234567",
          sources: ["lookup"]
        },
        { authInfo: { token: userSecret } }
      );
      const serialized = JSON.stringify(result);

      expect(result).toMatchObject({
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringMatching(/outcome is unknown.*may have been billed.*do not retry automatically/i)
          })
        ]
      });
      expect(serialized).not.toContain(userSecret);
      expect(serialized).not.toContain("KEY_abcdefghijklmnopqrstuv");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("rejects a final tool result that exceeds the serialized output cap", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            phone_number: "+15551234567",
            country_code: "US",
            carrier: { name: "Example", type: "mobile" },
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

      const result = await tools.number_intelligence_analyze.handler(
        { phone_number: "+15551234567", include_raw: true, sources: ["lookup"] },
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

  it("measures duplicated content plus structured output and uses a bounded text fallback", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            phone_number: "+15551234567",
            country_code: "US",
            carrier: { name: "Example", type: "mobile" },
            provider_fragments: Array.from({ length: 130 }, () => "x".repeat(4096))
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

      const result = await tools.number_intelligence_analyze.handler(
        { phone_number: "+15551234567", include_raw: true, sources: ["lookup"] },
        { authInfo: { token: "KEY_TEST_DUPLICATED_OUTPUT_LIMIT" } }
      );

      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: JSON.stringify({ notice: "The full result is available in structuredContent." })
          }
        ],
        structuredContent: {
          raw: {
            telnyx_number_lookup: {
              data: { provider_fragments: expect.any(Array) }
            }
          }
        }
      });
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1024 * 1024);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

function expectNoUnconstrainedSchemas(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  expect(Object.keys(value), `${label} contains an unconstrained schema`).not.toHaveLength(0);
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    expectNoUnconstrainedSchemas(nested, label);
  }
}
