import { describe, expect, it } from "vitest";

import {
  sanitizeBillingToolOutput,
  sanitizeBillingValue,
  sanitizeError,
  TelnyxBillingClient,
  TelnyxBillingError
} from "../src/telnyxClient.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TelnyxBillingClient", () => {
  it("constructs balance, auto-recharge, and stored payment requests against the /v2 default base URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/balance")) return json({ data: { record_type: "balance", balance: "42.00", currency: "USD" } });
      if (String(url).endsWith("/stored_payment_transactions")) return json({ data: { id: "txn_1", record_type: "transaction", amount_cents: 2500 } });
      return json({ data: { id: "arp_1", record_type: "auto_recharge_pref", enabled: true } });
    };
    const client = new TelnyxBillingClient({ apiKey: "fixture_credential", fetch: fetchImpl });

    await client.getBalance();
    await client.getAutoRechargePreferences();
    await client.createStoredPaymentTransaction({ amount: "25.00" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.telnyx.com/v2/balance",
      "https://api.telnyx.com/v2/payment/auto_recharge_prefs",
      "https://api.telnyx.com/v2/payment/stored_payment_transactions"
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "GET", "POST"]);
    expect(calls.every((call) => call.init?.redirect === "error")).toBe(true);
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ amount: "25.00" }));
    expect(calls.every((call) => (call.init?.headers as Record<string, string>).Authorization === "Bearer fixture_credential")).toBe(true);
  });

  it("constructs billing group CRUD requests without redacting billing_group_id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ data: { id: "bg_keep_for_followup", record_type: "billing_group", name: "Ops" } });
    };
    const client = new TelnyxBillingClient({ apiKey: "fixture_credential", baseUrl: "https://api.telnyx.test/v2", fetch: fetchImpl });

    await client.listBillingGroups({ pageNumber: 2, pageSize: 25 });
    await client.createBillingGroup({ name: "Ops" });
    await client.getBillingGroup("bg_keep_for_followup");
    await client.updateBillingGroup("bg_keep_for_followup", { name: "Ops renamed" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.telnyx.test/v2/billing_groups?page%5Bnumber%5D=2&page%5Bsize%5D=25",
      "https://api.telnyx.test/v2/billing_groups",
      "https://api.telnyx.test/v2/billing_groups/bg_keep_for_followup",
      "https://api.telnyx.test/v2/billing_groups/bg_keep_for_followup"
    ]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ name: "Ops" }));
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(calls[3]?.init?.body).toBe(JSON.stringify({ name: "Ops renamed" }));
  });

  it("constructs usage report option and query requests with arrays, filters, sort, and managed account defaults", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ data: [] });
    };
    const client = new TelnyxBillingClient({ apiKey: "fixture_credential", baseUrl: "https://api.telnyx.test/v2/", fetch: fetchImpl });

    await client.getUsageReportOptions({ product: "messaging" });
    await client.queryUsageReport({
      product: "messaging",
      dimensions: ["direction", "country"],
      metrics: ["cost", "count"],
      startDate: "2026-05-01",
      endDate: "2026-05-07",
      filters: { currency: "USD", billing_group_id: "bg_keep_for_followup" },
      sort: ["-cost"],
      format: "json",
      managedAccounts: false,
      pageNumber: 1,
      pageSize: 100
    });

    expect(calls[0]?.url).toBe("https://api.telnyx.test/v2/usage_reports/options?product=messaging");
    expect(calls[1]?.url).toBe(
      "https://api.telnyx.test/v2/usage_reports?product=messaging&dimensions=direction%2Ccountry&metrics=cost%2Ccount&start_date=2026-05-01&end_date=2026-05-07&filter%5Bcurrency%5D=USD&filter%5Bbilling_group_id%5D=bg_keep_for_followup&sort=-cost&format=json&page%5Bnumber%5D=1&page%5Bsize%5D=100&managed_accounts=false"
    );
  });

  it("redacts authorization secrets from Telnyx errors while preserving operational ids", async () => {
    const fetchImpl: typeof fetch = async () =>
      json(
        {
          errors: [
            {
              title: "Denied",
              detail: "Bearer fixture_credential cannot access billing_group_id bg_keep_for_followup with api_key fixture_api_key"
            }
          ]
        },
        403
      );
    const client = new TelnyxBillingClient({ apiKey: "fixture_credential", fetch: fetchImpl });

    await expect(client.getBalance()).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("[redacted-secret]")
    });
    await expect(client.getBalance()).rejects.toMatchObject({
      message: expect.stringContaining("bg_keep_for_followup")
    });
    try {
      await client.getBalance();
    } catch (error) {
      expect(error).toBeInstanceOf(TelnyxBillingError);
      const serialized = JSON.stringify((error as TelnyxBillingError).details);
      expect(serialized).not.toContain("fixture_credential");
      expect(serialized).not.toContain("fixture_api_key");
      expect(serialized).toContain("bg_keep_for_followup");
    }
  });

  it("sanitizes generic thrown errors", () => {
    const sanitized = sanitizeError(new Error("Authorization: Bearer <fixture-token>; card 4242424242424242 failed"));
    expect(sanitized.message).not.toContain("fixture_credential");
    expect(sanitized.message).not.toContain("4242424242424242");
  });

  it("aborts an upstream request that exceeds the configured timeout", async () => {
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const client = new TelnyxBillingClient({
      apiKey: "fixture_credential",
      fetch: fetchImpl,
      timeoutMs: 5
    });

    await expect(client.getBalance()).rejects.toThrow(
      "Telnyx request timed out after 5 ms"
    );
  });

  it("rejects upstream responses that exceed the configured byte limit", async () => {
    const client = new TelnyxBillingClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response("x".repeat(64), { status: 200 }),
      maxResponseBytes: 32
    });

    await expect(client.getBalance()).rejects.toThrow(
      "Telnyx response exceeded the 32-byte limit"
    );
  });

  it("rejects non-JSON and invalid UTF-8 success bodies instead of returning an empty success", async () => {
    const nonJson = new TelnyxBillingClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response("upstream maintenance", { status: 200 })
    });
    const invalidUtf8 = new TelnyxBillingClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 })
    });

    await expect(nonJson.getBalance()).rejects.toThrow("Telnyx response was not valid JSON");
    await expect(invalidUtf8.getBalance()).rejects.toThrow(
      "Telnyx response was not valid UTF-8 JSON"
    );
  });

  it("redacts camelCase and nested upstream secrets while preserving only app-issued root confirmation tokens", () => {
    const upstreamSanitized = sanitizeBillingValue({
      author: "Telnyx",
      confirmation_token: "app-issued-token",
      cache_hit: true,
      data: {
        confirmation_token: "upstream-token",
        accessToken: "fixture_access",
        clientSecret: "fixture_client_secret",
        privateKey: "fixture_private_key"
      }
    });

    expect(upstreamSanitized).toEqual({
      author: "Telnyx",
      confirmation_token: "[redacted-secret]",
      cache_hit: true,
      data: {
        confirmation_token: "[redacted-secret]",
        accessToken: "[redacted-secret]",
        clientSecret: "[redacted-secret]",
        privateKey: "[redacted-secret]"
      }
    });
    expect(
      sanitizeBillingToolOutput({ confirmation_token: "app-issued-token" })
    ).toEqual({ confirmation_token: "app-issued-token" });
  });

  it("bounds attacker-controlled upstream error messages", async () => {
    const client = new TelnyxBillingClient({
      apiKey: "fixture_credential",
      fetch: async () =>
        json(
          {
            errors: [
              {
                title: "Denied",
                detail: `clientSecret=fixture_client_secret {"accessToken":"quoted_access","privateKey":"quoted_private"} ${"x".repeat(500_000)}`
              }
            ]
          },
          500
        )
    });

    try {
      await client.getBalance();
      throw new Error("expected balance request to fail");
    } catch (error) {
      const caught = error as Error & { details?: unknown };
      expect(caught.message.length).toBeLessThanOrEqual(4_120);
      expect(caught.message).not.toContain("fixture_client_secret");
      expect(caught.message).not.toContain("quoted_access");
      expect(caught.message).not.toContain("quoted_private");
      expect(JSON.stringify(caught.details)).not.toContain("fixture_client_secret");
    }
  });
});
