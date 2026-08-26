import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { AUTO_RECHARGE_SETUP_UI_HTML, STORED_PAYMENT_TOP_UP_UI_HTML, USAGE_COST_EXPLORER_UI_HTML } from "../src/ui.js";

describe("Usage Cost Explorer MCP server", () => {
  it("registers the expected tools and beta Usage Reports descriptions", () => {
    const server = createServer();
    const tools = (server as unknown as { _registeredTools: Record<string, { description?: string; _meta?: unknown; annotations?: Record<string, boolean> }> })._registeredTools;

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
        "billing_preview_billing_group_update",
        "billing_preview_stored_payment_transaction",
        "billing_query_usage",
        "billing_update_auto_recharge_preferences",
        "billing_update_billing_group",
        "billing_usage_report_options"
      ].sort()
    );
    expect(tools.billing_query_usage?.description).toMatch(/beta/i);
    expect(JSON.stringify(tools.billing_overview?._meta)).toContain("ui://usage-cost-explorer/index.html");
    expect(JSON.stringify(tools.billing_auto_recharge_setup?._meta)).toContain("ui://usage-cost-explorer/auto-recharge.html");
    expect(JSON.stringify(tools.billing_stored_payment_top_up?._meta)).toContain("ui://usage-cost-explorer/stored-payment-top-up.html");
    expect(JSON.stringify(tools.billing_query_usage?._meta)).not.toContain("resourceUri");
    expect(JSON.stringify(tools.billing_query_usage?._meta)).toContain("app");
    expect(tools.billing_get_balance?.annotations?.readOnlyHint).toBe(true);
    expect(tools.billing_update_auto_recharge_preferences?.annotations?.readOnlyHint).toBe(false);
    expect(tools.billing_create_stored_payment_transaction?.annotations?.readOnlyHint).toBe(false);
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

  it("keeps stored payment tokens usable across preview and create tools", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "KEY_TEST_SECRET";
    globalThis.fetch = (async (_url, init) => {
      if (init?.method === "POST") {
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
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
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
});
