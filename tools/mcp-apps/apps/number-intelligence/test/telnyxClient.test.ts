import { describe, expect, it } from "vitest";
import {
  sanitizeNumberIntelligenceValue,
  TelnyxNumberLookupClient
} from "../src/telnyxClient.js";

describe("TelnyxNumberLookupClient", () => {
  it("normalizes every supported shared API-base form to exactly one /v2 segment", async () => {
    const cases: Array<readonly [string, string]> = [];
    for (const scheme of ["http", "https"] as const) {
      for (const host of ["api.telnyx.test", "127.0.0.1:8787"] as const) {
        for (const prefix of ["", "/telnyx", "/nested/telnyx"] as const) {
          for (const version of ["", "/v2"] as const) {
            for (const trailing of ["", "/", "///"] as const) {
              for (const padding of ["", "  "] as const) {
                cases.push([
                  `${padding}${scheme}://${host}${prefix}${version}${trailing}${padding}`,
                  `${scheme}://${host}${prefix}/v2`
                ]);
              }
            }
          }
        }
      }
    }
    expect(cases).toHaveLength(144);

    for (const [baseUrl, expectedBase] of cases) {
      const calls: string[] = [];
      const client = new TelnyxNumberLookupClient({
        apiKey: "test_secret_key",
        baseUrl,
        fetch: async (url) => {
          calls.push(String(url));
          return new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      });

      await client.lookupNumber("+13125550123");
      expect(calls).toEqual([
        `${expectedBase}/number_lookup/%2B13125550123?type=carrier&type=caller-name`
      ]);
    }
  });

  it("rejects every unsupported or ambiguous shared API-base form before fetch", () => {
    const cases = [
      "",
      "not-a-url",
      "/v2",
      "//api.telnyx.test/v2",
      "ftp://api.telnyx.test/v2",
      "https://user:secret@api.telnyx.test/v2",
      "https://api.telnyx.test/v2?tenant=one",
      "https://api.telnyx.test/v2#fragment",
      "https://api.telnyx.test/V2",
      "https://api.telnyx.test/v1",
      "https://api.telnyx.test/v3",
      "https://api.telnyx.test/v2/v2",
      "https://api.telnyx.test/v2/proxy",
      "https://api.telnyx.test/proxy//nested",
      "https://api.telnyx.test/v%32",
      "https://api.telnyx.test/proxy%2Fnested",
      "https://api.telnyx.test/%"
    ];
    let fetchCalls = 0;

    for (const baseUrl of cases) {
      expect(
        () =>
          new TelnyxNumberLookupClient({
            apiKey: "test_secret_key",
            baseUrl,
            fetch: async () => {
              fetchCalls += 1;
              return new Response();
            }
          }),
        baseUrl
      ).toThrow(/Telnyx API base URL/);
    }
    expect(fetchCalls).toBe(0);
  });

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
    expect(calls[0]?.init?.redirect).toBe("error");
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
    const client = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      fetch: fetchImpl,
      timeoutMs: 5
    });

    await expect(client.lookupNumber("+13125550123")).rejects.toThrow(
      "Telnyx request timed out after 5 ms"
    );
  });

  it("rejects upstream responses that exceed the configured byte limit", async () => {
    const client = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      fetch: async () => new Response("x".repeat(64), { status: 200 }),
      maxResponseBytes: 32
    });

    await expect(client.lookupNumber("+13125550123")).rejects.toThrow(
      "Telnyx response exceeded the 32-byte limit"
    );
  });

  it("rejects non-JSON and invalid UTF-8 success bodies instead of returning an empty success", async () => {
    const nonJson = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      fetch: async () => new Response("upstream maintenance", { status: 200 })
    });
    const invalidUtf8 = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      fetch: async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 })
    });

    await expect(nonJson.lookupNumber("+13125550123")).rejects.toThrow(
      "Telnyx response was not valid JSON"
    );
    await expect(invalidUtf8.lookupNumber("+13125550123")).rejects.toThrow(
      "Telnyx response was not valid UTF-8 JSON"
    );
  });

  it("redacts camelCase credentials and bounds attacker-controlled error text", async () => {
    const hugeDetail = `accessToken=fixture_access {"clientSecret":"quoted_client_secret"} ${"x".repeat(500_000)}`;
    const client = new TelnyxNumberLookupClient({
      apiKey: "test_secret_key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            errors: [{ title: "Denied", detail: hugeDetail }],
            accessToken: "fixture_access",
            clientSecret: "fixture_client_secret",
            privateKey: "fixture_private_key"
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        )
    });

    try {
      await client.lookupNumber("+13125550123");
      throw new Error("expected lookup to fail");
    } catch (error) {
      const caught = error as Error & { details?: unknown };
      expect(caught.message.length).toBeLessThanOrEqual(4_120);
      expect(caught.message).not.toContain("quoted_client_secret");
      expect(JSON.stringify(caught.details)).not.toContain("fixture_access");
      expect(JSON.stringify(caught.details)).not.toContain("fixture_client_secret");
      expect(JSON.stringify(caught.details)).not.toContain("fixture_private_key");
    }

    expect(
      JSON.stringify(
        sanitizeNumberIntelligenceValue({
          author: "Telnyx",
          accessToken: "fixture_access",
          clientSecret: "fixture_client_secret",
          privateKey: "fixture_private_key"
        })
      )
    ).toBe(
      JSON.stringify({
        author: "Telnyx",
        accessToken: "[redacted-secret]",
        clientSecret: "[redacted-secret]",
        privateKey: "[redacted-secret]"
      })
    );
  });
});
