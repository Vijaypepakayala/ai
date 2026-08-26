import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { VOICE_MONITOR_UI_HTML } from "../src/ui.js";

describe("Voice Monitor MCP server", () => {
  it("registers read-only tools with the Voice Monitor UI resource", () => {
    const server = createServer();
    const tools = (server as unknown as { _registeredTools: Record<string, { description?: string; _meta?: unknown; annotations?: Record<string, boolean> }> })._registeredTools;

    expect(Object.keys(tools).sort()).toEqual(
      [
        "voice_monitor_dashboard",
        "voice_monitor_active_calls",
        "voice_monitor_call_status",
        "voice_monitor_call_timeline",
        "voice_monitor_list_options",
        "voice_monitor_recordings"
      ].sort()
    );
    for (const tool of Object.values(tools)) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
    expect(JSON.stringify(tools.voice_monitor_dashboard?._meta)).toContain("ui://voice-monitor/index.html");
    expect(JSON.stringify(tools.voice_monitor_active_calls?._meta)).not.toContain("resourceUri");
    expect(JSON.stringify(tools.voice_monitor_active_calls?._meta)).toContain("app");
    expect(tools.voice_monitor_active_calls?.description).toMatch(/Call Control Application/i);
    expect(tools.voice_monitor_list_options?.description).toMatch(/dropdown/i);
  });

  it("returns a safe tool error without network when TELNYX_API_KEY is missing", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.voice_monitor_list_options.handler({}, {});

      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("TELNYX_API_KEY is not set");
      expect(JSON.stringify(result)).not.toContain("Authorization");
    } finally {
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("sanitizes successful tool output while preserving operational call IDs", async () => {
    const oldKey = process.env.TELNYX_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.TELNYX_API_KEY = "test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            connection_id: "conn_keep_for_followup",
            call_control_id: "call_control_keep_for_followup",
            call_leg_id: "leg_keep_for_followup",
            call_session_id: "session_keep_for_followup",
            from: "+15551234567",
            recording_url: "https://recordings.example.test/secret.wav?token=abc123",
            authorization: "Bearer should-not-leak"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    try {
      const server = createServer();
      const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> })._registeredTools;

      const result = await tools.voice_monitor_call_status.handler({ call_control_id: "call_control_keep_for_followup" }, {});
      const serialized = JSON.stringify(result);

      expect(serialized).toContain("conn_keep_for_followup");
      expect(serialized).toContain("call_control_keep_for_followup");
      expect(serialized).toContain("[redacted-phone]");
      expect(serialized).toContain("[redacted-recording-url]");
      expect(serialized).toContain("[redacted-secret]");
      expect(serialized).not.toContain("15551234567");
      expect(serialized).not.toContain("secret.wav");
      expect(serialized).not.toContain("should-not-leak");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.TELNYX_API_KEY;
      else process.env.TELNYX_API_KEY = oldKey;
    }
  });

  it("exports a self-contained UI that loads options into dropdowns and has JSON fallback", () => {
    expect(VOICE_MONITOR_UI_HTML).toContain("Voice Monitor");
    expect(VOICE_MONITOR_UI_HTML).toContain("voice_monitor_dashboard");
    expect(VOICE_MONITOR_UI_HTML).toContain("voice_monitor_list_options");
    expect(VOICE_MONITOR_UI_HTML).toContain("connectionSelect");
    expect(VOICE_MONITOR_UI_HTML).toContain("sipConnectionSelect");
    expect(VOICE_MONITOR_UI_HTML).toContain("idTypeSelect");
    expect(VOICE_MONITOR_UI_HTML).toMatch(/manual JSON fallback/i);
  });
});
