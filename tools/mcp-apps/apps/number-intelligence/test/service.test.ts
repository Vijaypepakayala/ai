import { describe, expect, it } from "vitest";
import { analyzeNumber } from "../src/service.js";
import type { NumberLookupClient, TelnyxNumberLookupResponse } from "../src/types.js";

const lookupResponse: TelnyxNumberLookupResponse = {
  data: {
    phone_number: "+13125550123",
    national_format: "(312) 555-0123",
    country_code: "US",
    carrier: {
      name: "Verizon Wireless",
      type: "mobile",
      mobile_country_code: "311",
      mobile_network_code: "480"
    },
    caller_name: {
      caller_name: "ACME Support",
      error_code: null
    }
  }
};

function lookupClient(response: TelnyxNumberLookupResponse): NumberLookupClient {
  return {
    async lookupNumber() {
      return response;
    }
  };
}

describe("analyzeNumber", () => {
  it("summarizes a normal lookup and returns stable recommendations", async () => {
    const result = await analyzeNumber(
      { phone_number: "+1 (312) 555-0123" },
      { lookupClient: lookupClient(lookupResponse) }
    );

    expect(result.input.phone_number).toBe("+1312******23");
    expect(result.normalized.e164).toBe("+1312******23");
    expect(result.normalized.e164_validated).toBe(false);
    expect(result.normalized.national_format).toBe("+1312******23");
    expect(result.display.redacted).toBe("+1312******23");
    expect(result.display.label).toBe("+1312******23");
    expect(result.summary).toMatchObject({
      type: "mobile",
      carrier: "Verizon Wireless",
      country: "US",
      ownership: "ACME Support",
      messaging: "likely_supported",
      voice: "likely_supported",
      reputation: "unknown"
    });
    expect(result.health.status).toBe("good");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lookup.carrier", status: "info" }),
        expect.objectContaining({ id: "messaging.capability", status: "info" })
      ])
    );
    expect(result.recommended_actions.map((action) => action.id)).toContain("confirm_messaging_profile");
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "telnyx.number_lookup", status: "consulted" })
      ])
    );
    expect(result.raw).toBeUndefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("+1 (312) 555-0123");
    expect(serialized).not.toContain("+13125550123");
    expect(serialized).not.toContain("(312) 555-0123");
  });

  it("adds action-required signals for non-portable and messaging-misconfigured optional inputs", async () => {
    const result = await analyzeNumber(
      { phone_number: "+13125550123" },
      {
        lookupClient: lookupClient(lookupResponse),
        optionalSignals: {
          portability: { portable: false, reason: "Current provider blocks porting" },
          messaging: { configured: false, reason: "No messaging profile is attached" },
          ownership: { owned: true, numberId: "123" }
        }
      }
    );

    expect(result.summary.portability).toBe("not_portable");
    expect(result.summary.messaging).toBe("misconfigured");
    expect(result.summary.ownership).toBe("owned");
    expect(result.health.status).toBe("bad");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "portability.status", status: "action_required" }),
        expect.objectContaining({ id: "messaging.configuration", status: "action_required" })
      ])
    );
    expect(result.recommended_actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["review_portability_block", "attach_messaging_profile"])
    );
  });

  it("still reports voice misconfiguration when messaging is also misconfigured", async () => {
    const result = await analyzeNumber(
      { phone_number: "+13125550123" },
      {
        lookupClient: lookupClient(lookupResponse),
        optionalSignals: {
          messaging: { configured: false, reason: "No messaging profile is attached" },
          voice: { configured: false, reason: "No connection assigned" }
        }
      }
    );

    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "messaging.configuration", status: "action_required" }),
        expect.objectContaining({ id: "voice.configuration", status: "action_required" })
      ])
    );
    expect(result.recommended_actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["attach_messaging_profile", "fix_voice_configuration"])
    );
    expect(result.summary.voice).toBe("misconfigured");
  });

  it("gracefully handles lookup errors and keeps the result useful", async () => {
    const result = await analyzeNumber(
      { phone_number: "+14155550199" },
      {
        lookupClient: {
          async lookupNumber() {
            throw Object.assign(new Error("Telnyx rejected lookup"), { status: 422 });
          }
        }
      }
    );

    expect(result.normalized.e164).toBe("+1415******99");
    expect(result.normalized.e164_validated).toBe(false);
    expect(result.summary.carrier).toBe("unknown");
    expect(result.health.status).toBe("unknown");
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "telnyx.number_lookup", status: "error" })
      ])
    );
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lookup.error", status: "warning" })
      ])
    );
    expect(result.recommended_actions.map((action) => action.id)).toContain("retry_lookup");
  });

  it("omits raw by default and includes only redacted raw when explicitly requested", async () => {
    const withoutRaw = await analyzeNumber(
      { phone_number: "+14155552671" },
      {
        lookupClient: lookupClient({
          data: {
            ...lookupResponse.data,
            phone_number: "+14155552671",
            national_format: "(415) 555-2671"
          }
        })
      }
    );

    expect(withoutRaw.raw).toBeUndefined();
    expect(withoutRaw.display.redacted).toBe("+1415******71");

    const withRaw = await analyzeNumber(
      { phone_number: "+14155552671", include_raw: true },
      {
        lookupClient: lookupClient({
          data: {
            ...lookupResponse.data,
            phone_number: "+14155552671",
            national_format: "(415) 555-2671"
          }
        })
      }
    );

    expect(withRaw.raw?.telnyx_number_lookup).toBeDefined();
    expect(JSON.stringify(withRaw.raw)).toContain("+1415******71");
    expect(JSON.stringify(withRaw.raw)).not.toContain("+14155552671");
  });
});
