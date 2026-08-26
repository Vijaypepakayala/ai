import { describe, expect, it } from "vitest";
import { TelnyxNumberLookupClient } from "../src/telnyxClient.js";

describe("TelnyxNumberLookupClient", () => {
  it("constructs a read-only number lookup request with injected fetch", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: { phone_number: "+13125550123" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      baseUrl: "https://api.telnyx.test",
      fetch: fetchImpl
    });

    const result = await client.lookupNumber("+13125550123");

    expect(result.data.phone_number).toBe("+13125550123");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.telnyx.test/v2/number_lookup/%2B13125550123?type=carrier&type=caller-name"
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer test_secret_key");
  });

  it("surfaces Telnyx error details without logging the authorization header", async () => {
    const consoleMessages: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => consoleMessages.push(args.join(" "));
    try {
      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ errors: [{ title: "Invalid number" }] }), {
          status: 422,
          headers: { "content-type": "application/json" }
        });

      const client = new TelnyxNumberLookupClient({ apiKey: "test_secret_key", fetch: fetchImpl });

      await expect(client.lookupNumber("+1 312 555 0123")).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining("Invalid number")
      });
      expect(consoleMessages.join("\n")).not.toContain("test_secret_key");
      expect(consoleMessages.join("\n")).not.toContain("Authorization");
    } finally {
      console.error = originalError;
    }
  });
});
