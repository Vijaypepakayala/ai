import { describe, expect, it } from "vitest";

import { createVoiceMonitorService } from "../src/service.js";
import type { VoiceMonitorClient } from "../src/types.js";

function fakeClient(overrides: Partial<VoiceMonitorClient> = {}): VoiceMonitorClient {
  return {
    listConnections: async () => ({ data: [] }),
    listCallControlApplications: async () => ({ data: [] }),
    listPhoneNumbers: async () => ({ data: [] }),
    listActiveCalls: async () => ({ data: [] }),
    listCallEvents: async () => ({ data: [] }),
    getCallStatus: async () => ({ data: {} }),
    listRecordings: async () => ({ data: [] }),
    ...overrides
  };
}

describe("Voice Monitor service", () => {
  it("discovers app-friendly dropdown options while redacting phone numbers", async () => {
    const service = createVoiceMonitorService(
      fakeClient({
        listConnections: async () => ({
          data: [
            { id: "conn_keep_for_followup", connection_name: "Production Voice", active: true, outbound: { outbound_voice_profile_id: "ovp_1" } },
            { connection_name: "Missing identifier" }
          ]
        }),
        listCallControlApplications: async () => ({ data: [{ id: "app_keep_for_followup", application_name: "Support IVR", active: true }] }),
        listPhoneNumbers: async () => ({
          data: [
            { id: "pn_1", phone_number: "+15551234567", connection_id: "conn_keep_for_followup", status: "active" },
            { id: "pn_2", phone_number: "+15557654321", connection_id: "conn_keep_for_followup", status: "active" }
          ]
        })
      })
    );

    const result = await service.listOptions({ pageSize: 500 });

    expect(result.options.connections).toEqual([
      expect.objectContaining({
        kind: "connection",
        label: "Production Voice",
        value: "conn_keep_for_followup",
        active: true,
        associated_number_count: 2
      })
    ]);
    expect(result.options.call_control_applications[0]).toMatchObject({ kind: "call_control_application", value: "app_keep_for_followup", label: "Support IVR" });
    expect(result.options.active_call_targets[0]).toMatchObject({ kind: "call_control_application", value: "app_keep_for_followup", label: "Support IVR" });
    expect(result.options.voice_numbers[0]).toMatchObject({ kind: "voice_number", label: expect.stringContaining("[redacted-phone]"), connection_id: "conn_keep_for_followup" });
    expect(JSON.stringify(result)).not.toContain("15551234567");
    expect(result.limits.page_size).toBe(100);
  });

  it("lists active calls for discovered bounded call-control applications when connection_id is omitted", async () => {
    const consulted: string[] = [];
    const service = createVoiceMonitorService(
      fakeClient({
        listCallControlApplications: async () => ({
          data: [
            { id: "app_1", application_name: "One" },
            { id: "app_2", application_name: "Two" },
            { id: "app_3", application_name: "Three" }
          ]
        }),
        listActiveCalls: async (connectionId) => {
          consulted.push(connectionId);
          return {
            data: [
              {
                call_control_id: `call_${connectionId}`,
                connection_id: "untrusted_upstream_value",
                from: "+15551234567"
              }
            ]
          };
        }
      }),
      { maxDiscoveryConnections: 2 }
    );

    const result = await service.activeCalls({ pageSize: 5 });

    expect(consulted).toEqual(["app_1", "app_2"]);
    expect(result.connections_consulted).toEqual(["app_1", "app_2"]);
    expect(result.truncated_connections).toBe(true);
    expect(result.truncated_output).toBe(false);
    expect(result.total_active_calls).toBe(2);
    expect(result.per_connection).toEqual([
      { connection_id: "app_1", active_call_count: 1 },
      { connection_id: "app_2", active_call_count: 1 }
    ]);
    expect(result.per_connection.every((entry) => !("data" in entry))).toBe(true);
    expect(result.active_calls.map((call) => call.connection_id)).toEqual([
      "app_1",
      "app_2"
    ]);
    expect(JSON.stringify(result)).toContain("call_app_1");
    expect(JSON.stringify(result)).not.toContain("15551234567");
  });

  it("lists active calls for a provided connection without discovery", async () => {
    const calls: string[] = [];
    const service = createVoiceMonitorService(
      fakeClient({
        listConnections: async () => {
          throw new Error("discovery should not run");
        },
        listActiveCalls: async (connectionId, input) => {
          calls.push(`${connectionId}:${input.pageSize}`);
          return { data: [{ call_control_id: "call_keep_for_followup" }] };
        }
      })
    );

    const result = await service.activeCalls({ connectionId: " conn_keep_for_followup ", pageSize: 500 });

    expect(calls).toEqual(["conn_keep_for_followup:100"]);
    expect(result.connections_consulted).toEqual(["conn_keep_for_followup"]);
  });

  it("bounds aggregate active-call output and stops querying later connections", async () => {
    const consulted: string[] = [];
    const connectionIds = ["app_1", "app_2", "app_3", "app_4", "app_5"];
    const maxOutputBytes = 20 * 1024;
    const service = createVoiceMonitorService(
      fakeClient({
        listCallControlApplications: async () => ({
          data: connectionIds.map((id) => ({ id, application_name: id }))
        }),
        listActiveCalls: async (connectionId) => {
          consulted.push(connectionId);
          return {
            data: [
              {
                call_control_id: `call_${connectionId}`,
                provider_fragments: Array.from({ length: 3 }, () => "x".repeat(4096))
              }
            ]
          };
        }
      }),
      { maxDiscoveryConnections: 5, maxAggregateOutputBytes: maxOutputBytes }
    );

    const result = await service.activeCalls({ pageSize: 100 });

    expect(result.truncated_output).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "active_calls", message: expect.stringMatching(/output byte limit/i) })
      ])
    );
    expect(consulted.length).toBeGreaterThan(0);
    expect(consulted.length).toBeLessThan(connectionIds.length);
    expect(result.connections_consulted).toEqual(consulted);
    expect(result.per_connection.every((entry) => !("data" in entry))).toBe(true);
    expect(result.total_active_calls).toBe(result.active_calls.length);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(maxOutputBytes);
  });

  it("normalizes call timeline filters and defaults connection-only searches to a bounded last-24-hour window", async () => {
    const inputs: unknown[] = [];
    const service = createVoiceMonitorService(
      fakeClient({
        listCallEvents: async (input) => {
          inputs.push(input);
          return { data: [{ id: "event_1", from: "+15551234567" }] };
        }
      }),
      { now: () => new Date("2026-05-20T12:00:00.000Z") }
    );

    const result = await service.callTimeline({ connectionId: "conn_keep_for_followup", pageSize: 500 });

    expect(inputs[0]).toMatchObject({
      connectionId: "conn_keep_for_followup",
      occurredAtGte: "2026-05-19T12:00:00.000Z",
      occurredAtLte: "2026-05-20T12:00:00.000Z",
      pageSize: 100
    });
    expect(result.filters_notice).toMatch(/last 24 hours/i);
    expect(JSON.stringify(result)).not.toContain("15551234567");
  });

  it("enforces timeline windows across every lower and upper bound operator", async () => {
    const service = createVoiceMonitorService(fakeClient());
    const contexts = [{}, { callLegId: "leg_1" }, { applicationSessionId: "session_1" }];
    const lowerBounds = ["occurredAtGt", "occurredAtGte"] as const;
    const upperBounds = ["occurredAtLt", "occurredAtLte"] as const;
    let checkedCases = 0;

    for (const context of contexts) {
      for (const lowerBound of lowerBounds) {
        for (const upperBound of upperBounds) {
          checkedCases += 1;
          await expect(
            service.callTimeline({
              ...context,
              [lowerBound]: "2026-05-01T00:00:00.000Z",
              [upperBound]: "2026-05-10T00:00:00.000Z"
            })
          ).rejects.toThrow(/capped/i);
        }
      }
    }

    expect(checkedCases).toBe(12);
  });

  it("adds a complementary timeline bound for every one-sided time operator", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const service = createVoiceMonitorService(
      fakeClient({
        listCallEvents: async (input) => {
          inputs.push(input as unknown as Record<string, unknown>);
          return { data: [] };
        }
      })
    );
    const contexts = [
      { input: {}, maxHours: 24 },
      { input: { callLegId: "leg_1" }, maxHours: 168 },
      { input: { applicationSessionId: "session_1" }, maxHours: 168 }
    ] as const;
    const oneSidedInputs = [
      { input: { occurredAtGt: "2026-05-01T00:00:00.000Z" }, synthesized: "occurredAtLte" },
      { input: { occurredAtGte: "2026-05-01T00:00:00.000Z" }, synthesized: "occurredAtLte" },
      { input: { occurredAtLt: "2026-05-10T00:00:00.000Z" }, synthesized: "occurredAtGte" },
      { input: { occurredAtLte: "2026-05-10T00:00:00.000Z" }, synthesized: "occurredAtGte" }
    ] as const;

    for (const context of contexts) {
      for (const { input, synthesized } of oneSidedInputs) {
        const result = await service.callTimeline({ ...context.input, ...input });
        expect(result.filters_notice).toMatch(/missing time bound/i);
        const applied = inputs.at(-1);
        expect(applied?.[synthesized]).toEqual(expect.any(String));
        const start = String(applied?.occurredAtGt ?? applied?.occurredAtGte);
        const end = String(applied?.occurredAtLt ?? applied?.occurredAtLte);
        expect((Date.parse(end) - Date.parse(start)) / 3_600_000).toBe(context.maxHours);
      }
    }

    expect(inputs).toHaveLength(12);
  });

  it("adds a complementary bound to one-sided recording searches", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const service = createVoiceMonitorService(
      fakeClient({
        listRecordings: async (input) => {
          inputs.push(input as unknown as Record<string, unknown>);
          return { data: [] };
        }
      })
    );

    for (const context of [{}, { connectionId: "conn_1" }]) {
      await service.recordings({ ...context, occurredAtGte: "2026-05-01T00:00:00.000Z" });
      await service.recordings({ ...context, occurredAtLte: "2026-05-10T00:00:00.000Z" });
    }

    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect(input.createdAtGte).toEqual(expect.any(String));
      expect(input.createdAtLte).toEqual(expect.any(String));
      expect(
        (Date.parse(String(input.createdAtLte)) - Date.parse(String(input.createdAtGte))) /
          3_600_000
      ).toBe(168);
    }
  });

  it("rejects blank call status IDs and caps recording search windows", async () => {
    const service = createVoiceMonitorService(fakeClient(), { now: () => new Date("2026-05-20T12:00:00.000Z") });

    await expect(service.callStatus({ callControlId: "   " })).rejects.toThrow(/call_control_id/i);
    await expect(
      service.recordings({ occurredAtGte: "2026-05-01T00:00:00.000Z", occurredAtLte: "2026-05-20T00:00:00.000Z" })
    ).rejects.toThrow(/capped/i);
  });
});
