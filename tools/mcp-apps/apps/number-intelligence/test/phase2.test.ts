import { describe, expect, it } from "vitest";

import { analyzeBatchNumbers, analyzeNumber } from "../src/service.js";
import { TelnyxReadOnlyClient } from "../src/telnyxClient.js";
import type { NumberLookupClient, TelnyxNumberLookupResponse } from "../src/types.js";

const lookupResponse: TelnyxNumberLookupResponse = {
  data: {
    phone_number: "+13125550123",
    national_format: "(312) 555-0123",
    country_code: "US",
    carrier: { name: "Example Wireless", type: "mobile" },
    caller_name: { caller_name: "Example Support" }
  }
};

function lookupClient(response: TelnyxNumberLookupResponse = lookupResponse): NumberLookupClient {
  return {
    async lookupNumber() {
      return response;
    }
  };
}

describe("phase 2 read-only Telnyx source client", () => {
  it("constructs owned, portability, messaging, voice, and cached reputation requests safely", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const requestUrl = String(url);
      if (requestUrl.includes("/phone_numbers/messaging")) {
        return json({ data: [{ id: "pnm_1", messaging_profile_id: "mp_1", features: { sms: { domestic: true } }, health: { success_ratio: 0.99, spam_ratio: 0.01 } }] });
      }
      if (requestUrl.includes("/messaging_profiles/mp_1")) {
        return json({ data: { id: "mp_1", name: "Production", enabled: true, v1_secret: "must-not-surface" } });
      }
      if (requestUrl.includes("/phone_numbers/voice")) {
        return json({ data: [{ id: "pnv_1", connection_id: "conn_1" }] });
      }
      if (requestUrl.includes("/connections/conn_1")) {
        return json({ data: { id: "conn_1", active: true, connection_name: "Voice app" } });
      }
      if (requestUrl.includes("/reputation/numbers/")) {
        return json({ data: { reputation_data: { spam_risk: "low", maturity_score: 94 } } });
      }
      if (requestUrl.includes("/portability_checks")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ phone_numbers: ["+13125550123"] }));
        return json({ data: [{ phone_number: "+13125550123", portable: true, fast_portable: true }] });
      }
      return json({ data: [{ id: "pn_1", phone_number: "+13125550123", status: "active", messaging_profile_id: "mp_1", connection_id: "conn_1" }] });
    };

    const client = new TelnyxReadOnlyClient({ apiKey: "test_secret_key", baseUrl: "https://api.telnyx.test", fetch: fetchImpl });

    await client.getOwnedNumber("+1 (312) 555-0123");
    await client.checkPortability("+1 (312) 555-0123");
    await client.checkMessagingReadiness("+1 (312) 555-0123");
    await client.checkVoiceReadiness("+1 (312) 555-0123");
    const reputation = await client.getCachedReputation("+1 (312) 555-0123");

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.telnyx.test/v2/phone_numbers?filter%5Bphone_number%5D=13125550123&page%5Bsize%5D=1&page%5Bnumber%5D=1&handle_messaging_profile_error=true",
      "https://api.telnyx.test/v2/portability_checks",
      "https://api.telnyx.test/v2/phone_numbers/messaging?filter%5Bphone_number%5D=%2B13125550123&page%5Bsize%5D=1&page%5Bnumber%5D=1",
      "https://api.telnyx.test/v2/messaging_profiles/mp_1",
      "https://api.telnyx.test/v2/phone_numbers/voice?filter%5Bphone_number%5D=13125550123&page%5Bsize%5D=1&page%5Bnumber%5D=1",
      "https://api.telnyx.test/v2/connections/conn_1",
      "https://api.telnyx.test/v2/reputation/numbers/%2B13125550123?fresh=false"
    ]);
    expect(calls.every((call) => (call.init?.headers as Record<string, string>).Authorization === "Bearer test_secret_key")).toBe(true);
    expect(calls.map((call) => call.url).join("\n")).toContain("fresh=false");
    expect(calls.map((call) => call.url).join("\n")).not.toContain("fresh=true");
    expect(JSON.stringify(reputation)).not.toContain("must-not-surface");
  });
});

describe("phase 2 source integration", () => {
  it("consults requested read-only sources and maps them into summaries, signals, and actions", async () => {
    const result = await analyzeNumber(
      { phone_number: "+1 (312) 555-0123", sources: ["owned", "portability", "messaging", "voice", "reputation"] },
      {
        lookupClient: lookupClient(),
        sources: {
          owned: { async getOwnedNumber() { return { owned: true, numberId: "pn_1", reason: "Owned number found." }; } },
          portability: { async checkPortability() { return { portable: false, status: "not_portable", reason: "Carrier rejected portability." }; } },
          messaging: { async checkMessagingReadiness() { return { configured: false, capable: true, reason: "No messaging profile is attached." }; } },
          voice: { async checkVoiceReadiness() { return { configured: true, reason: "Active connection assigned." }; } },
          reputation: { async getCachedReputation() { return { status: "bad", reason: "Cached spam risk is high." }; } }
        }
      }
    );

    expect(result.summary).toMatchObject({
      ownership: "owned",
      portability: "not_portable",
      messaging: "misconfigured",
      voice: "ready",
      reputation: "bad"
    });
    expect(result.health.status).toBe("bad");
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "telnyx.owned_numbers", status: "consulted" }),
        expect.objectContaining({ id: "telnyx.portability", status: "consulted" }),
        expect.objectContaining({ id: "telnyx.messaging", status: "consulted" }),
        expect.objectContaining({ id: "telnyx.voice", status: "consulted" }),
        expect.objectContaining({ id: "telnyx.reputation", status: "consulted" })
      ])
    );
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "portability.status", status: "action_required" }),
        expect.objectContaining({ id: "messaging.configuration", status: "action_required" }),
        expect.objectContaining({ id: "reputation.cached", status: "action_required" })
      ])
    );
    expect(result.recommended_actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["review_portability_block", "attach_messaging_profile", "investigate_reputation"])
    );
  });

  it("continues analysis when a source errors and redacts phone numbers in source details", async () => {
    const result = await analyzeNumber(
      { phone_number: "+1 (312) 555-0123", sources: ["messaging", "voice"] },
      {
        lookupClient: lookupClient(),
        sources: {
          messaging: { async checkMessagingReadiness() { throw new Error("Telnyx failed for +13125550123"); } },
          voice: { async checkVoiceReadiness() { return { configured: true, reason: "Active connection assigned." }; } }
        }
      }
    );

    expect(result.summary.voice).toBe("ready");
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "telnyx.messaging", status: "error", detail: expect.stringContaining("+1312******23") }),
        expect.objectContaining({ id: "telnyx.voice", status: "consulted" })
      ])
    );
    expect(result.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "source.telnyx.messaging.error", status: "warning" })])
    );
    expect(JSON.stringify(result)).not.toContain("+13125550123");
  });
});

describe("phase 2 batch analysis", () => {
  it("parses pasted CSV/newline input, redacts results, and aggregates health/action counts", async () => {
    const result = await analyzeBatchNumbers(
      { numbers: "phone_number\n+1 (312) 555-0123\n+1 (415) 555-2671\n", sources: ["owned"] },
      {
        lookupClient: lookupClient(),
        sources: { owned: { async getOwnedNumber() { return { owned: true, reason: "Owned number found." }; } } }
      },
      { maxBatchSize: 5 }
    );

    expect(result.total).toBe(2);
    expect(result.aggregate.health_status_counts.good).toBe(2);
    expect(result.aggregate.action_required_count).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("+13125550123");
    expect(JSON.stringify(result)).not.toContain("+14155552671");
  });

  it("enforces a conservative max batch size before making lookups", async () => {
    let lookupCalls = 0;
    await expect(
      analyzeBatchNumbers(
        { numbers: ["+13125550123", "+14155552671", "+12125550199"] },
        { lookupClient: { async lookupNumber() { lookupCalls += 1; return lookupResponse; } } },
        { maxBatchSize: 2 }
      )
    ).rejects.toThrow("at most 2 numbers");
    expect(lookupCalls).toBe(0);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
