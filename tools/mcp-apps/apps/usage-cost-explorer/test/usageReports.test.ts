import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { AUTO_RECHARGE_SETUP_UI_HTML, STORED_PAYMENT_TOP_UP_UI_HTML, USAGE_COST_EXPLORER_UI_HTML } from "../src/ui.js";
import { findMcpApp } from "../../../src/catalog.js";

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

describe("Usage Cost Explorer MCP server", () => {
  it("keeps restart-unsafe create flows fail-closed in hosted mode before any Telnyx request", async () => {
    const oldFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      throw new Error("hosted create gate must run before network access");
    }) as typeof fetch;

    try {
      const server = findMcpApp("usage-cost-explorer")?.createServer();
      expect(server).toBeDefined();
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
      const auth = { authInfo: { token: "KEY_hosted_gate_1234567890" } };
      const attempts = await Promise.all([
        tools.billing_preview_stored_payment_transaction?.handler(
          { amount: "25.00" },
          auth
        ),
        tools.billing_create_stored_payment_transaction?.handler(
          { amount: "25.00", confirmation_token: "unused" },
          auth
        ),
        tools.billing_preview_billing_group_create?.handler(
          { name: "Hosted safety test" },
          auth
        ),
        tools.billing_create_billing_group?.handler(
          { name: "Hosted safety test", confirmation_token: "unused" },
          auth
        )
      ]);

      expect(attempts).toHaveLength(4);
      for (const attempt of attempts) {
        expect(attempt).toMatchObject({ isError: true });
        expect(JSON.stringify(attempt)).toMatch(
          /disabled in hosted mode.*durable shared confirmation coordinator|disabled in hosted mode.*upstream idempotency/i
        );
      }
      expect(requestCount).toBe(0);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("registers the expected tools and beta Usage Reports descriptions", () => {
    const server = createServer();
    const internal = server as unknown as {
      _registeredTools: Record<
        string,
        {
          description?: string;
          inputSchema?: unknown;
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
    for (const tool of Object.values(tools)) {
      expect(tool.outputSchema).toBeDefined();
    }

    expect(Object.keys(tools).sort()).toEqual(
      [
        "billing_create_billing_group",
        "billing_auto_recharge_setup",
        "billing_stored_payment_top_up",
        "billing_create_stored_payment_transaction",
        "billing_overview",
        "billing_get_auto_recharge_preferences",
        "billing_get_balance",
        "billing_get_billing_group",
        "billing_list_billing_groups",
        "billing_preview_auto_recharge_update",
        "billing_preview_billing_group_create",
        "billing_preview_billing_group_update",
        "billing_preview_stored_payment_transaction",
        "billing_query_usage",
        "billing_update_auto_recharge_preferences",
        "billing_update_billing_group",
        "billing_usage_report_options"
      ].sort()
    );
    expect(tools.billing_query_usage?.description).toMatch(/beta/i);
    expect(tools.billing_query_usage?.description).toMatch(/structured JSON/i);
    expect(JSON.stringify(tools.billing_query_usage?.inputSchema)).not.toContain('"csv"');
    expect(JSON.stringify(tools.billing_overview?._meta)).toContain("ui://usage-cost-explorer/index.html");
    expect(JSON.stringify(tools.billing_auto_recharge_setup?._meta)).toContain("ui://usage-cost-explorer/auto-recharge.html");
    expect(JSON.stringify(tools.billing_stored_payment_top_up?._meta)).toContain("ui://usage-cost-explorer/stored-payment-top-up.html");
    expect(JSON.stringify(tools.billing_query_usage?._meta)).not.toContain("resourceUri");
    expect(JSON.stringify(tools.billing_query_usage?._meta)).toContain("app");
    const readOnlyAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    };
    const destructiveAnnotations = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    };
    const previewAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    };
    const additiveAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    };
    for (const name of [
      "billing_overview",
      "billing_auto_recharge_setup",
      "billing_stored_payment_top_up",
      "billing_get_balance",
      "billing_get_auto_recharge_preferences",
      "billing_list_billing_groups",
      "billing_get_billing_group",
      "billing_usage_report_options",
      "billing_query_usage"
    ]) {
      expect(tools[name]?.annotations).toEqual(readOnlyAnnotations);
    }
    for (const name of [
      "billing_preview_auto_recharge_update",
      "billing_preview_stored_payment_transaction",
      "billing_preview_billing_group_update",
      "billing_preview_billing_group_create"
    ]) {
      expect(tools[name]?.annotations).toEqual(previewAnnotations);
    }
    for (const name of [
      "billing_update_auto_recharge_preferences",
      "billing_create_stored_payment_transaction",
      "billing_update_billing_group"
    ]) {
      expect(tools[name]?.annotations).toEqual(destructiveAnnotations);
    }
    expect(tools.billing_create_billing_group?.annotations).toEqual(additiveAnnotations);
    expect(tools.billing_auto_recharge_setup?.description).toMatch(
      /does not enable auto recharge or charge/i
    );
    expect(tools.billing_stored_payment_top_up?.description).toMatch(
      /does not charge a payment method/i
    );
    expect(tools.billing_update_auto_recharge_preferences?.description).toMatch(
      /future automatic charges/i
    );
    expect(tools.billing_create_stored_payment_transaction?.description).toMatch(
      /charges the saved payment method/i
    );
    const expectedCsp = {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: []
    };
    for (const uri of [
      "ui://usage-cost-explorer/index.html",
      "ui://usage-cost-explorer/auto-recharge.html",
      "ui://usage-cost-explorer/stored-payment-top-up.html"
    ]) {
      const resourceUi = internal._registeredResources[uri]?.metadata?._meta?.ui;
      expect(resourceUi?.domain).toBe("https://telnyx-developer-kit.telnyx.com");
      expect(resourceUi?.csp).toEqual(expectedCsp);
    }
  });

  it("publishes exact tool-family schemas and UI metadata on every resource read", async () => {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "usage-cost-explorer-test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
      const expectedProperties: Record<string, string[]> = {
        billing_overview: ["balance", "auto_recharge", "billing_groups", "usage_options", "warnings"],
        billing_auto_recharge_setup: ["balance", "auto_recharge", "warnings"],
        billing_stored_payment_top_up: ["balance"],
        billing_get_balance: ["data", "meta"],
        billing_get_auto_recharge_preferences: ["data", "meta"],
        billing_list_billing_groups: ["data", "meta"],
        billing_get_billing_group: ["data", "meta"],
        billing_usage_report_options: ["data", "meta"],
        billing_query_usage: ["data", "meta"],
        billing_preview_auto_recharge_update: ["action", "before", "after", "diff", "confirmation_token"],
        billing_update_auto_recharge_preferences: ["data", "meta"],
        billing_preview_stored_payment_transaction: ["action", "before", "after", "diff", "confirmation_token"],
        billing_create_stored_payment_transaction: ["data", "meta"],
        billing_preview_billing_group_update: ["action", "before", "after", "diff", "confirmation_token"],
        billing_update_billing_group: ["data", "meta"],
        billing_preview_billing_group_create: ["action", "before", "after", "diff", "confirmation_token"],
        billing_create_billing_group: ["data", "meta"]
      };
      for (const [name, properties] of Object.entries(expectedProperties)) {
        expect(Object.keys((tools[name]?.outputSchema?.properties ?? {}))).toEqual(expect.arrayContaining(properties));
        expectNoUnconstrainedSchemas(tools[name]?.outputSchema, name);
      }

      for (const resource of (await client.listResources()).resources) {
        const content = (await client.readResource({ uri: resource.uri })).contents[0];
        expect(content?._meta).toEqual({
          ui: {
            domain: "https://telnyx-developer-kit.telnyx.com",
            csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }
          }
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("validates provider-specific billing fields against the advertised output schema", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_OUTPUT_SCHEMA";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "arp_1",
            billing_group_id: "bg_keep_for_followup"
          },
          meta: {
            cursor: { before: null, after: "cursor_keep_for_followup" }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "usage-cost-explorer-output-schema-test", version: "1.0.0" },
      { capabilities: {} }
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listedTools = await client.listTools();
      const advertisedSchema = listedTools.tools.find(
        (tool) => tool.name === "billing_get_auto_recharge_preferences"
      )?.outputSchema;
      const result = await client.callTool({
        name: "billing_get_auto_recharge_preferences",
        arguments: {}
      });

      expect(result).toMatchObject({
        structuredContent: {
          data: {
            id: "arp_1",
            billing_group_id: "bg_keep_for_followup"
          },
          meta: {
            cursor: { before: null, after: "cursor_keep_for_followup" }
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

  it("keeps Usage Reports JSON-only at the MCP boundary", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    process.env.TELNYX_API_KEY = "KEY_TEST_JSON_ONLY";
    globalThis.fetch = (async (url) => {
      requestedUrls.push(String(url));
      return new Response(
        JSON.stringify({
          data: [{ product: "voice", cost: "1.25", provider_dimension: "domestic" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client(
      { name: "usage-cost-explorer-json-only-test", version: "1.0.0" },
      { capabilities: {} }
    );
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      await client.listTools();
      const result = await client.callTool({
        name: "billing_query_usage",
        arguments: {
          product: "voice",
          dimensions: ["product"],
          metrics: ["cost"]
        }
      });

      expect(result).toMatchObject({
        structuredContent: {
          data: [{ product: "voice", cost: "1.25", provider_dimension: "domestic" }]
        }
      });
      expect(new URL(requestedUrls[0] ?? "").searchParams.get("format")).toBe("json");

      const csvResult = await client.callTool({
        name: "billing_query_usage",
        arguments: {
          product: "voice",
          dimensions: ["product"],
          metrics: ["cost"],
          format: "csv"
        }
      });
      expect(csvResult).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining('expected "json" at format')
          }
        ]
      });
      expect(requestedUrls).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("fails closed with a bounded message when a usage response exceeds the tool-output limit", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_OUTPUT_BOUND";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: 300 }, (_, index) => ({
            dimension: `${index}:${"x".repeat(4_096)}`
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }
        >;
      })._registeredTools;
      const result = await tools.billing_query_usage?.handler(
        { product: "voice", dimensions: ["product"], metrics: ["cost"] },
        {}
      );

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining("safe size limit")
          }
        ]
      });
      expect(JSON.stringify(result).length).toBeLessThan(1_000);
      expect(result).not.toHaveProperty("structuredContent");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("returns safe tool errors without network when TELNYX_API_KEY is missing", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.billing_get_balance?.handler({}, {});

      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("TELNYX_API_KEY is not set");
      expect(JSON.stringify(result)).not.toContain("Authorization");
    } finally {
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it.each([401, 403])(
    "returns the internal %i marker for direct and dashboard billing reads",
    async (status) => {
      const oldFetch = globalThis.fetch;
      const userSecret = "KEY_TEST_BILLING_SECRET";
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

        for (const toolName of ["billing_get_balance", "billing_overview"]) {
          const result = await tools[toolName]?.handler(
            {},
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

  it("sanitizes successful tool output while preserving operational billing group IDs", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_SECRET";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "arp_1",
            payment_method_id: "pm_fixture_value",
            card_last_four: "4242",
            authorization: "Bearer should-not-leak",
            auth: "opaque-live-secret",
            billing_group_id: "bg_keep_for_followup"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.billing_get_auto_recharge_preferences?.handler({}, {});
      const serialized = JSON.stringify(result);

      expect(serialized).toContain("[redacted-secret]");
      expect(serialized).not.toContain("pm_fixture_value");
      expect(serialized).not.toContain("should-not-leak");
      expect(serialized).not.toContain("opaque-live-secret");
      expect(serialized).toContain("bg_keep_for_followup");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("accepts documented null record_types in direct and dashboard Usage Reports options", async () => {
    const oldFetch = globalThis.fetch;
    const usageOptions = {
      data: [
        {
          product: "sip-trunking",
          product_dimensions: ["date", "direction", "country_code"],
          product_metrics: ["connected", "attempted", "cost"],
          record_types: null
        }
      ]
    };
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/usage_reports/options")) {
        return new Response(JSON.stringify(usageOptions), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (path.endsWith("/balance")) {
        return new Response(JSON.stringify({ data: { balance: "10.00", currency: "USD" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (path.endsWith("/payment/auto_recharge_prefs")) {
        return new Response(JSON.stringify({ data: { enabled: false } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (path.endsWith("/billing_groups")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected fixture URL: ${url}`);
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
      const extra = { authInfo: { token: "KEY_TEST_BILLING_SECRET" } };

      const direct = await tools.billing_usage_report_options?.handler({}, extra);
      const overview = await tools.billing_overview?.handler({}, extra);

      expect(direct).toMatchObject({
        structuredContent: {
          data: [{ product: "sip-trunking", record_types: null }]
        }
      });
      expect(overview).toMatchObject({
        structuredContent: {
          usage_options: {
            data: [{ product: "sip-trunking", record_types: null }]
          },
          warnings: []
        }
      });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("keeps app confirmation tokens usable across preview and update tools", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    const currentPrefs = { id: "arp_1", threshold_amount: "10.00", recharge_amount: "25.00", enabled: true, invoice_enabled: false, preference: "credit_paypal" };
    process.env.TELNYX_API_KEY = "KEY_TEST_SECRET";
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ data: { ...currentPrefs, enabled: false } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: currentPrefs }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const preview = (await tools.billing_preview_auto_recharge_update?.handler({ enabled: false }, {})) as { structuredContent: { confirmation_token: string } };
      expect(preview.structuredContent.confirmation_token).toMatch(/^[a-f0-9]{64}$/);

      const result = await tools.billing_update_auto_recharge_preferences?.handler({ enabled: false, confirmation_token: preview.structuredContent.confirmation_token }, {});
      expect(result).toMatchObject({ structuredContent: { data: { enabled: false } } });
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("binds auto-recharge approval to a one-time credential-scoped preview under concurrency", async () => {
    const oldFetch = globalThis.fetch;
    const currentPrefs = {
      id: "arp_guarded",
      threshold_amount: "10.00",
      recharge_amount: "25.00",
      enabled: true,
      invoice_enabled: false,
      preference: "credit_paypal"
    };
    let patchCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "PATCH") {
        patchCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ data: { ...currentPrefs, enabled: false } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ data: currentPrefs }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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
              ) => Promise<Record<string, unknown>>;
            }
          >;
        }
      )._registeredTools;
      const owner = { authInfo: { token: "KEY_auto_recharge_owner_1234567890" } };
      const peer = { authInfo: { token: "KEY_auto_recharge_peer_1234567890" } };
      const legacyForge = legacyStateToken(
        "billing.update_auto_recharge_preferences",
        currentPrefs,
        { ...currentPrefs, enabled: false },
        "usage-cost-explorer-policy-v1"
      );

      const forged = await tools.billing_update_auto_recharge_preferences?.handler(
        { enabled: false, confirmation_token: legacyForge },
        owner
      );
      expect(forged).toMatchObject({ isError: true });
      expect(patchCount).toBe(0);

      const preview = await tools.billing_preview_auto_recharge_update?.handler(
        { enabled: false },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;

      const duplicatePreview = await tools.billing_preview_auto_recharge_update?.handler(
        { enabled: false, preference: "credit_paypal" },
        owner
      );
      expect(duplicatePreview).toMatchObject({ isError: true });
      expect(JSON.stringify(duplicatePreview)).toMatch(/matching confirmation is already outstanding/i);

      const crossCredential = await tools.billing_update_auto_recharge_preferences?.handler(
        { enabled: false, confirmation_token: confirmationToken },
        peer
      );
      expect(crossCredential).toMatchObject({ isError: true });
      expect(patchCount).toBe(0);

      const concurrent = await Promise.all(
        Array.from({ length: 8 }, () =>
          tools.billing_update_auto_recharge_preferences?.handler(
            { enabled: false, confirmation_token: confirmationToken },
            owner
          )
        )
      );
      expect(concurrent.filter((result) => result?.isError !== true)).toHaveLength(1);
      expect(concurrent.filter((result) => result?.isError === true)).toHaveLength(7);
      expect(patchCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("fails closed with safe guidance when an auto-recharge PATCH outcome is ambiguous", async () => {
    const oldFetch = globalThis.fetch;
    const currentPrefs = {
      id: "arp_ambiguous",
      threshold_amount: "10.00",
      recharge_amount: "25.00",
      enabled: true,
      invoice_enabled: false,
      preference: "credit_paypal"
    };
    let patchCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "PATCH") {
        patchCount += 1;
        throw new Error("socket closed after auto-recharge request write");
      }
      return new Response(JSON.stringify({ data: currentPrefs }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_auto_ambiguous_owner_1234567890" } };
      const preview = await tools.billing_preview_auto_recharge_update?.handler(
        { enabled: false },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const first = await tools.billing_update_auto_recharge_preferences?.handler(
        { enabled: false, confirmation_token: confirmationToken },
        owner
      );
      const replay = await tools.billing_update_auto_recharge_preferences?.handler(
        { enabled: false, confirmation_token: confirmationToken },
        owner
      );
      const duplicatePreview = await tools.billing_preview_auto_recharge_update?.handler(
        { enabled: false },
        owner
      );

      expect(first).toMatchObject({ isError: true });
      expect(JSON.stringify(first)).toMatch(/outcome is unknown/i);
      expect(JSON.stringify(first)).toMatch(/verify current auto-recharge preferences/i);
      expect(JSON.stringify(first)).toMatch(/do not retry automatically/i);
      expect(JSON.stringify(first)).not.toContain("socket closed after auto-recharge request write");
      expect(replay).toMatchObject({ isError: true });
      expect(duplicatePreview).toMatchObject({ isError: true });
      expect(patchCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("consumes a billing-group rename preview before concurrent PATCH attempts", async () => {
    const oldFetch = globalThis.fetch;
    let patchCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "PATCH") {
        patchCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(
          JSON.stringify({ data: { id: "bg_guarded", name: "Renamed" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ data: { id: "bg_guarded", name: "Original" } }),
        { status: 200, headers: { "content-type": "application/json" } }
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
              ) => Promise<Record<string, unknown>>;
            }
          >;
        }
      )._registeredTools;
      const owner = { authInfo: { token: "KEY_billing_group_owner_1234567890" } };
      const preview = await tools.billing_preview_billing_group_update?.handler(
        { id: "bg_guarded", name: "Renamed" },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;

      const duplicatePreview = await tools.billing_preview_billing_group_update?.handler(
        { id: "bg_guarded", name: "Renamed" },
        owner
      );
      expect(duplicatePreview).toMatchObject({ isError: true });

      const concurrent = await Promise.all(
        Array.from({ length: 8 }, () =>
          tools.billing_update_billing_group?.handler(
            {
              id: "bg_guarded",
              name: "Renamed",
              confirmation_token: confirmationToken
            },
            owner
          )
        )
      );
      expect(concurrent.filter((result) => result?.isError !== true)).toHaveLength(1);
      expect(concurrent.filter((result) => result?.isError === true)).toHaveLength(7);
      expect(patchCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("fails closed with safe guidance when a billing-group PATCH outcome is ambiguous", async () => {
    const oldFetch = globalThis.fetch;
    let patchCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "PATCH") {
        patchCount += 1;
        throw new Error("socket closed after billing-group request write");
      }
      return new Response(
        JSON.stringify({ data: { id: "bg_ambiguous", name: "Original" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_group_ambiguous_owner_1234567890" } };
      const preview = await tools.billing_preview_billing_group_update?.handler(
        { id: "bg_ambiguous", name: "Renamed" },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const first = await tools.billing_update_billing_group?.handler(
        {
          id: "bg_ambiguous",
          name: "Renamed",
          confirmation_token: confirmationToken
        },
        owner
      );
      const replay = await tools.billing_update_billing_group?.handler(
        {
          id: "bg_ambiguous",
          name: "Renamed",
          confirmation_token: confirmationToken
        },
        owner
      );
      const duplicatePreview = await tools.billing_preview_billing_group_update?.handler(
        { id: "bg_ambiguous", name: "Renamed" },
        owner
      );

      expect(first).toMatchObject({ isError: true });
      expect(JSON.stringify(first)).toMatch(/outcome is unknown/i);
      expect(JSON.stringify(first)).toMatch(/verify the current billing group/i);
      expect(JSON.stringify(first)).toMatch(/do not retry automatically/i);
      expect(JSON.stringify(first)).not.toContain("socket closed after billing-group request write");
      expect(replay).toMatchObject({ isError: true });
      expect(duplicatePreview).toMatchObject({ isError: true });
      expect(patchCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("keeps stored payment tokens usable across preview and create tools", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    process.env.TELNYX_API_KEY = "KEY_TEST_SECRET";
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return new Response(JSON.stringify({ data: { id: "txn_1", record_type: "transaction", amount_cents: 2500, processor_status: "submitted_for_settlement", amount_currency: "USD" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { record_type: "balance", balance: "10.00", currency: "USD" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const preview = (await tools.billing_preview_stored_payment_transaction?.handler({ amount: "25.00" }, {})) as { structuredContent: { confirmation_token: string } };
      expect(preview.structuredContent.confirmation_token).toMatch(/^[a-f0-9]{64}$/);

      const result = await tools.billing_create_stored_payment_transaction?.handler({ amount: "25.00", confirmation_token: preview.structuredContent.confirmation_token }, {});
      expect(result).toMatchObject({ structuredContent: { data: { id: "txn_1", amount_cents: 2500 } } });

      const replay = await tools.billing_create_stored_payment_transaction?.handler({ amount: "25.00", confirmation_token: preview.structuredContent.confirmation_token }, {});
      expect(replay).toMatchObject({ isError: true });
      expect(JSON.stringify(replay)).toMatch(/already-used.*confirmation token/i);
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("keeps a stored-payment confirmation blocked when a valid upstream success is too large to return", async () => {
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return new Response(
          JSON.stringify({
            data: {
              id: "txn_oversized",
              record_type: "transaction",
              amount_cents: 2500,
              processor_status: "submitted_for_settlement",
              amount_currency: "USD",
              provider_payload: Object.fromEntries(
                Array.from({ length: 300 }, (_, index) => [
                  `field_${index}`,
                  "x".repeat(4096)
                ])
              )
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: { balance: "100.00", currency: "USD" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_stored_oversized_owner_1234567890" } };
      const preview = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const first = await tools.billing_create_stored_payment_transaction?.handler(
        { amount: "25.00", confirmation_token: confirmationToken },
        owner
      );
      const replay = await tools.billing_create_stored_payment_transaction?.handler(
        { amount: "25.00", confirmation_token: confirmationToken },
        owner
      );
      const duplicatePreview = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        owner
      );

      expect(first).toMatchObject({ isError: true });
      expect(JSON.stringify(first)).toMatch(/output exceeded the safe size limit/i);
      expect(replay).toMatchObject({ isError: true });
      expect(duplicatePreview).toMatchObject({ isError: true });
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("rejects a second identical stored-payment preview before it can authorize another charge", async () => {
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return new Response(JSON.stringify({ data: { id: "txn_deduped", amount_cents: 2500 } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ data: { balance: "100.00", currency: "USD" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_stored_dedupe_owner_1234567890" } };
      const first = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        owner
      );
      const duplicate = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "00025.00" },
        owner
      );
      expect(duplicate).toMatchObject({ isError: true });

      const confirmationToken = (
        first.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          tools.billing_create_stored_payment_transaction?.handler(
            { amount: "25.00", confirmation_token: confirmationToken },
            owner
          )
        )
      );
      expect(attempts.filter((result) => result?.isError !== true)).toHaveLength(1);
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("reports an ambiguous stored-payment outcome and blocks automatic retry", async () => {
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        throw new Error("socket closed after request write");
      }
      return new Response(JSON.stringify({ data: { balance: "100.00", currency: "USD" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_stored_ambiguous_owner_1234567890" } };
      const preview = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        owner
      );
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const first = await tools.billing_create_stored_payment_transaction?.handler(
        { amount: "25.00", confirmation_token: confirmationToken },
        owner
      );
      const replay = await tools.billing_create_stored_payment_transaction?.handler(
        { amount: "25.00", confirmation_token: confirmationToken },
        owner
      );
      const anotherPreview = await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        owner
      );

      for (const result of [first, replay]) {
        expect(result).toMatchObject({ isError: true });
        expect(JSON.stringify(result)).toMatch(/outcome may be unknown|outcome is unknown/i);
        expect(JSON.stringify(result)).toMatch(/do not retry automatically/i);
        expect(JSON.stringify(result)).not.toContain("socket closed after request write");
      }
      expect(anotherPreview).toMatchObject({ isError: true });
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("guards billing-group creation with one logical preview and one POST", async () => {
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({ data: { id: "bg_created", name: "Production" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const server = createServer();
      const tools = (server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (
              args: Record<string, unknown>,
              extra?: { authInfo?: { token?: string } }
            ) => Promise<Record<string, unknown>>;
          }
        >;
      })._registeredTools;
      const owner = { authInfo: { token: "KEY_group_create_owner_1234567890" } };
      const preview = await tools.billing_preview_billing_group_create?.handler(
        { name: "Production" },
        owner
      );
      const duplicate = await tools.billing_preview_billing_group_create?.handler(
        { name: "Production" },
        owner
      );
      expect(duplicate).toMatchObject({ isError: true });
      const confirmationToken = (
        preview.structuredContent as { confirmation_token: string }
      ).confirmation_token;
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          tools.billing_create_billing_group?.handler(
            { name: "Production", confirmation_token: confirmationToken },
            owner
          )
        )
      );

      expect(attempts.filter((result) => result?.isError !== true)).toHaveLength(1);
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("atomically rejects a concurrent stored-payment replay before a second POST", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    let resolvePost: ((response: Response) => void) | undefined;
    process.env.TELNYX_API_KEY = "KEY_TEST_SECRET";
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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
                extra?: unknown
              ) => Promise<unknown>;
            }
          >;
        }
      )._registeredTools;

      const preview = (await tools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        {}
      )) as { structuredContent: { confirmation_token: string } };
      const confirmation = {
        amount: "25.00",
        confirmation_token: preview.structuredContent.confirmation_token
      };

      const first = tools.billing_create_stored_payment_transaction?.handler(
        confirmation,
        {}
      );
      const replay = await tools.billing_create_stored_payment_transaction?.handler(
        confirmation,
        {}
      );

      expect(replay).toMatchObject({ isError: true });
      expect(postCount).toBe(1);
      expect(resolvePost).toBeTypeOf("function");
      resolvePost?.(
        new Response(
          JSON.stringify({
            data: {
              id: "txn_1",
              record_type: "transaction",
              amount_cents: 2500,
              processor_status: "submitted_for_settlement",
              amount_currency: "USD"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      await expect(first).resolves.toMatchObject({
        structuredContent: { data: { id: "txn_1", amount_cents: 2500 } }
      });
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("confirms across app server instances only for the credential that created the preview", async () => {
    const oldFetch = globalThis.fetch;
    let postCount = 0;
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return new Response(
          JSON.stringify({
            data: {
              id: "txn_1",
              record_type: "transaction",
              amount_cents: 2500,
              processor_status: "submitted_for_settlement",
              amount_currency: "USD"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const previewServer = createServer();
      const confirmServer = createServer();
      const previewTools = (
        previewServer as unknown as {
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
      const confirmTools = (
        confirmServer as unknown as {
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

      const preview = (await previewTools.billing_preview_stored_payment_transaction?.handler(
        { amount: "25.00" },
        { authInfo: { token: "KEY_preview_owner_1234567890" } }
      )) as { structuredContent: { confirmation_token: string } };
      const confirmation = {
        amount: "25.00",
        confirmation_token: preview.structuredContent.confirmation_token
      };

      const crossCredential = await confirmTools.billing_create_stored_payment_transaction?.handler(
        confirmation,
        { authInfo: { token: "KEY_different_owner_1234567890" } }
      );
      expect(crossCredential).toMatchObject({ isError: true });
      expect(postCount).toBe(0);

      const confirmed = await confirmTools.billing_create_stored_payment_transaction?.handler(
        confirmation,
        { authInfo: { token: "KEY_preview_owner_1234567890" } }
      );
      expect(confirmed).toMatchObject({
        structuredContent: { data: { id: "txn_1", amount_cents: 2500 } }
      });
      expect(postCount).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("validates credentials before issuing previews and caps each credential at three outstanding tokens", async () => {
    const oldFetch = globalThis.fetch;
    let balanceReads = 0;
    globalThis.fetch = (async (_url, init) => {
      balanceReads += 1;
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer KEY_invalid_preview_1234567890") {
        return new Response(
          JSON.stringify({
            errors: [{ title: "Unauthorized", detail: "Invalid credential" }]
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          data: { record_type: "balance", balance: "10.00", currency: "USD" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
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
      const preview = tools.billing_preview_stored_payment_transaction?.handler;
      expect(preview).toBeTypeOf("function");

      const invalid = await preview?.(
        { amount: "25.00" },
        { authInfo: { token: "KEY_invalid_preview_1234567890" } }
      );
      expect(invalid).toMatchObject({ isError: true });
      expect(JSON.stringify(invalid)).toMatch(/authentication failed/i);

      const owner = { authInfo: { token: "KEY_preview_cap_owner_1234567890" } };
      for (let index = 0; index < 3; index += 1) {
        await expect(preview?.({ amount: `${25 + index}.00` }, owner)).resolves.toMatchObject({
          structuredContent: { confirmation_token: expect.stringMatching(/^[a-f0-9]{64}$/) }
        });
      }
      const overCap = await preview?.({ amount: "28.00" }, owner);
      expect(overCap).toMatchObject({ isError: true });
      expect(JSON.stringify(overCap)).toMatch(/too many outstanding confirmations/i);

      const peer = await preview?.(
        { amount: "25.00" },
        { authInfo: { token: "KEY_preview_cap_peer_1234567890" } }
      );
      expect(peer).toMatchObject({
        structuredContent: { confirmation_token: expect.stringMatching(/^[a-f0-9]{64}$/) }
      });
      expect(balanceReads).toBe(6);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("exports a self-contained UI resource that references beta Usage Reports", () => {
    expect(USAGE_COST_EXPLORER_UI_HTML).toContain("Billing Dashboard");
    expect(USAGE_COST_EXPLORER_UI_HTML).toMatch(/Usage Reports.*beta/i);
    expect(AUTO_RECHARGE_SETUP_UI_HTML).toContain("Set Up Auto Recharge");
    expect(AUTO_RECHARGE_SETUP_UI_HTML).toContain("No direct payments");
    expect(STORED_PAYMENT_TOP_UP_UI_HTML).toContain("Top Up Balance");
    expect(STORED_PAYMENT_TOP_UP_UI_HTML).toContain("Submit payment");
  });

  it("includes ORA scanner security metadata on every UI HTML resource", () => {
    for (const html of [USAGE_COST_EXPLORER_UI_HTML, AUTO_RECHARGE_SETUP_UI_HTML, STORED_PAYMENT_TOP_UP_UI_HTML]) {
      expect(html).toMatch(/^<!doctype html>/i);
      for (const marker of SECURITY_META_MARKERS) {
        expect(html).toContain(marker);
      }
      expect(contentSecurityPolicy(html)).not.toMatch(/https?:|wss?:|\*\./i);
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

function contentSecurityPolicy(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] ?? "";
}

function legacyStateToken(
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  policyVersion: string
): string {
  return createHash("sha256")
    .update(stableJson({ action, before, after, policyVersion }))
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
