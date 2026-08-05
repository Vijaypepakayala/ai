import { describe, expect, it } from "vitest";

import { TelnyxVoiceMonitorClient, TelnyxVoiceMonitorError, sanitizeVoiceMonitorValue } from "../src/telnyxClient.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TelnyxVoiceMonitorClient", () => {
  it("constructs read-only voice monitoring requests against the /v2 base URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ data: [] });
    };
    const client = new TelnyxVoiceMonitorClient({ apiKey: "fixture_credential", fetch: fetchImpl });

    await client.listConnections({ pageNumber: 2, pageSize: 25 });
    await client.listCallControlApplications({ pageNumber: 1, pageSize: 10 });
    await client.listPhoneNumbers({ pageNumber: 1, pageSize: 10 });
    await client.listActiveCalls("conn_keep_for_followup", { pageNumber: 1, pageSize: 5 });
    await client.getCallStatus("call_control_keep_for_followup");

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.telnyx.com/v2/connections?page%5Bnumber%5D=2&page%5Bsize%5D=25",
      "https://api.telnyx.com/v2/call_control_applications?page%5Bnumber%5D=1&page%5Bsize%5D=10",
      "https://api.telnyx.com/v2/phone_numbers/voice?page%5Bnumber%5D=1&page%5Bsize%5D=10",
      "https://api.telnyx.com/v2/connections/conn_keep_for_followup/active_calls?page%5Bnumber%5D=1&page%5Bsize%5D=5",
      "https://api.telnyx.com/v2/calls/call_control_keep_for_followup"
    ]);
    expect(calls.every((call) => call.init?.method === "GET")).toBe(true);
    expect(calls.every((call) => call.init?.redirect === "error")).toBe(true);
    expect(calls.every((call) => (call.init?.headers as Record<string, string>).Authorization === "Bearer fixture_credential")).toBe(true);
  });

  it("serializes call event and recording deepObject filters without mutating calls", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ data: [] });
    };
    const client = new TelnyxVoiceMonitorClient({ apiKey: "fixture_credential", baseUrl: "https://api.telnyx.test/v2/", fetch: fetchImpl });

    await client.listCallEvents({
      callLegId: "leg_keep_for_followup",
      applicationSessionId: "session_keep_for_followup",
      connectionId: "conn_keep_for_followup",
      product: "call_control",
      failed: false,
      from: "+15551234567",
      occurredAtGte: "2026-05-20T00:00:00.000Z",
      occurredAtLte: "2026-05-20T01:00:00.000Z",
      status: "delivered",
      pageNumber: 1,
      pageSize: 20
    });
    await client.listRecordings({
      callControlId: "call_control_keep_for_followup",
      callLegId: "leg_keep_for_followup",
      connectionId: "conn_keep_for_followup",
      createdAtGte: "2026-05-20T00:00:00.000Z",
      pageNumber: 1,
      pageSize: 5
    });

    expect(calls[0]?.url).toBe(
      "https://api.telnyx.test/v2/call_events?filter%5Bleg_id%5D=leg_keep_for_followup&filter%5Bapplication_session_id%5D=session_keep_for_followup&filter%5Bconnection_id%5D=conn_keep_for_followup&filter%5Bproduct%5D=call_control&filter%5Bfailed%5D=false&filter%5Bfrom%5D=%2B15551234567&filter%5Boccurred_at%5D%5Bgte%5D=2026-05-20T00%3A00%3A00.000Z&filter%5Boccurred_at%5D%5Blte%5D=2026-05-20T01%3A00%3A00.000Z&filter%5Bstatus%5D=delivered&page%5Bnumber%5D=1&page%5Bsize%5D=20"
    );
    expect(calls[1]?.url).toBe(
      "https://api.telnyx.test/v2/recordings?filter%5Bcall_control_id%5D=call_control_keep_for_followup&filter%5Bcall_leg_id%5D=leg_keep_for_followup&filter%5Bconnection_id%5D=conn_keep_for_followup&filter%5Bcreated_at%5D%5Bgte%5D=2026-05-20T00%3A00%3A00.000Z&page%5Bnumber%5D=1&page%5Bsize%5D=5"
    );
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "GET"]);
  });

  it("redacts phone numbers, recording URLs, transcripts, metadata, and secrets while preserving operational IDs", async () => {
    const sensitive = {
      data: {
        id: "9999888877776666",
        value: "123456789012345",
        summary: { connection_count: 3 },
        author: "Telnyx",
        connection_id: "conn_keep_for_followup",
        call_control_id: "call_control_keep_for_followup",
        call_leg_id: "leg_keep_for_followup",
        call_session_id: "session_keep_for_followup",
        from: "+15551234567",
        to: "+15557654321",
        recording_url: "https://recordings.example.test/secret.wav?token=abc123",
        download_url: "https://recordings.example.test/download/secret.wav",
        download_urls: {
          mp3: "https://recordings.example.test/download/secret.mp3",
          wav: "https://recordings.example.test/download/secret.wav"
        },
        client_state: "base64-user-supplied-private-state",
        transcript: "Customer said card 4242424242424242",
        metadata: { api_key: "fixture_api_key", customer_phone_number: "+15550001111" },
        authorization: "Bearer should-not-leak",
        accessToken: "fixture_access",
        clientSecret: "fixture_client_secret",
        privateKey: "fixture_private_key"
      }
    };

    const sanitized = JSON.stringify(sanitizeVoiceMonitorValue(sensitive));

    expect(sanitized).toContain("conn_keep_for_followup");
    expect(sanitized).not.toContain("123456789012345");
    expect(sanitized).not.toContain("9999888877776666");
    expect(sanitized).toContain("connection_count");
    expect(sanitized).toContain("Telnyx");
    expect(sanitized).toContain("call_control_keep_for_followup");
    expect(sanitized).toContain("leg_keep_for_followup");
    expect(sanitized).toContain("session_keep_for_followup");
    expect(sanitized).toContain("[redacted-phone]");
    expect(sanitized).toContain("[redacted-recording-url]");
    expect(sanitized).toContain("[redacted-transcript]");
    expect(sanitized).toContain("[redacted-metadata]");
    expect(sanitized).toContain("[redacted-secret]");
    expect(sanitized).not.toContain("15551234567");
    expect(sanitized).not.toContain("secret.wav");
    expect(sanitized).not.toContain("secret.mp3");
    expect(sanitized).not.toContain("base64-user-supplied-private-state");
    expect(sanitized).not.toContain("4242424242424242");
    expect(sanitized).not.toContain("fixture_access");
    expect(sanitized).not.toContain("fixture_client_secret");
    expect(sanitized).not.toContain("fixture_private_key");
  });

  it("preserves sanitized top-level response pagination metadata", () => {
    const sanitized = sanitizeVoiceMonitorValue({
      data: [],
      meta: {
        total_pages: 2,
        total_results: 25,
        page_number: 1,
        page_size: 20,
        authorization: "Bearer should-not-leak"
      }
    });

    expect(sanitized).toMatchObject({
      meta: {
        total_pages: 2,
        total_results: 25,
        page_number: 1,
        page_size: 20,
        authorization: "[redacted-secret]"
      }
    });
  });

  it("throws sanitized Telnyx errors", async () => {
    const client = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: async () => json({ errors: [{ title: "Denied", detail: "Bearer fixture_credential cannot access +15551234567" }] }, 403)
    });

    await expect(client.listConnections()).rejects.toBeInstanceOf(TelnyxVoiceMonitorError);
    await expect(client.listConnections()).rejects.toMatchObject({ status: 403, message: expect.not.stringContaining("fixture_credential") });
    await expect(client.listConnections()).rejects.toMatchObject({ message: expect.not.stringContaining("15551234567") });
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
    const client = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: fetchImpl,
      timeoutMs: 5
    });

    await expect(client.listConnections()).rejects.toThrow(
      "Telnyx request timed out after 5 ms"
    );
  });

  it("rejects upstream responses that exceed the configured byte limit", async () => {
    const client = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response("x".repeat(64), { status: 200 }),
      maxResponseBytes: 32
    });

    await expect(client.listConnections()).rejects.toThrow(
      "Telnyx response exceeded the 32-byte limit"
    );
  });

  it("rejects non-JSON and invalid UTF-8 success bodies instead of returning an empty success", async () => {
    const nonJson = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response("upstream maintenance", { status: 200 })
    });
    const invalidUtf8 = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 })
    });

    await expect(nonJson.listConnections()).rejects.toThrow("Telnyx response was not valid JSON");
    await expect(invalidUtf8.listConnections()).rejects.toThrow(
      "Telnyx response was not valid UTF-8 JSON"
    );
  });

  it("bounds attacker-controlled upstream error messages", async () => {
    const client = new TelnyxVoiceMonitorClient({
      apiKey: "fixture_credential",
      fetch: async () =>
        json(
          {
            errors: [
              {
                title: "Denied",
                detail: `accessToken=fixture_access {"privateKey":"quoted_private_key"} ${"x".repeat(500_000)}`
              }
            ]
          },
          500
        )
    });

    try {
      await client.listConnections();
      throw new Error("expected voice request to fail");
    } catch (error) {
      const caught = error as Error & { details?: unknown };
      expect(caught.message.length).toBeLessThanOrEqual(4_120);
      expect(caught.message).not.toContain("fixture_access");
      expect(caught.message).not.toContain("quoted_private_key");
      expect(JSON.stringify(caught.details)).not.toContain("fixture_access");
    }
  });
});
