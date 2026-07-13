/**
 * Tests for the Voice API action commands (call-dial, call-control, call-status).
 *
 * Uses a fake `telnyx` binary that logs every invocation to a file and returns
 * canned JSON, so we can assert exactly which Go CLI flags the wrapper passes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const cliBin = join(cliRoot, "bin", "telnyx-agent.ts");

function setupFakeTelnyx(): { logPath: string; env: NodeJS.ProcessEnv } {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-agent-voice-"));
  const binDir = join(tempDir, "bin");
  const logPath = join(tempDir, "args.jsonl");
  mkdirSync(binDir, { recursive: true });

  const fakeTelnyx = join(binDir, "telnyx");
  writeFileSync(
    fakeTelnyx,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TELNYX_FAKE_ARGS_LOG, JSON.stringify(args) + "\\n");

// Strip --format json for command matching (the wrapper always appends it).
const command = args.filter((a) => a !== "--format" && a !== "json");

if (command[0] === "calls" && command[1] === "dial") {
  console.log(JSON.stringify({ data: { call_control_id: "call-dial-123", call_leg_id: "leg-1", call_session_id: "sess-1", is_alive: true } }));
} else if (command[0] === "calls" && command[1] === "retrieve-status") {
  console.log(JSON.stringify({ data: { call_control_id: "call-status-123", call_status: "active", is_alive: true } }));
} else if (command[0] === "calls:actions") {
  console.log(JSON.stringify({ data: { result: "ok", call_control_id: "call-control-123", command: command.slice(2).join(" ") } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}
`,
  );
  chmodSync(fakeTelnyx, 0o755);

  return {
    logPath,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TELNYX_CLI_PATH: fakeTelnyx,
      TELNYX_FAKE_ARGS_LOG: logPath,
    },
  };
}

function readLoggedArgs(logPath: string): string[][] {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("npx", ["tsx", cliBin, ...args], {
    cwd: cliRoot,
    encoding: "utf8",
    env: env ?? { ...process.env },
    timeout: 30000,
  });
}

function assertFlagValue(args: string[], flag: string, value: string): void {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `expected ${flag} in ${args.join(" ")}`);
  assert.equal(args[index + 1], value, `expected ${flag} ${value} in ${args.join(" ")}`);
}

describe("Voice API action commands", () => {
  it("call-dial passes the correct flags to `calls dial`", () => {
    const fake = setupFakeTelnyx();
    const output = run(
      ["call-dial", "--connection-id", "conn-1", "--from", "+13125550000", "--to", "+13125551234", "--json"],
      fake.env,
    );

    const data = JSON.parse(output);
    assert.equal(data.call_control_id, "call-dial-123");

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall, "should invoke `calls dial`");
    assertFlagValue(dialCall!, "--connection-id", "conn-1");
    assertFlagValue(dialCall!, "--from", "+13125550000");
    assertFlagValue(dialCall!, "--to", "+13125551234");
    // Boolean/detection flags should NOT be present when not requested.
    assert.ok(!dialCall!.includes("--answering-machine-detection"));
    assert.ok(!dialCall!.includes("--deepfake-detection"));
  });

  it("call-dial forwards AMD mode, deepfake and record flags in Go CLI syntax", () => {
    const fake = setupFakeTelnyx();
    run(
      [
        "call-dial",
        "--connection-id", "conn-1",
        "--from", "+13125550000",
        "--to", "+13125551234",
        "--answering-machine-detection",
        "--deepfake-detection",
        "--record",
        "--json",
      ],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall, "should invoke `calls dial`");
    // Bare --answering-machine-detection defaults to the "detect" mode value.
    assertFlagValue(dialCall!, "--answering-machine-detection", "detect");
    // deepfake_detection is an object; the Go CLI takes the inner --deepfake-detection.enabled flag.
    assert.ok(dialCall!.includes("--deepfake-detection.enabled"), "must include --deepfake-detection.enabled");
    // --record takes the event to record from, not a boolean.
    assertFlagValue(dialCall!, "--record", "record-from-answer");
  });

  it("call-dial forwards an explicit --answering-machine-detection mode", () => {
    const fake = setupFakeTelnyx();
    run(
      [
        "call-dial",
        "--connection-id", "conn-1",
        "--from", "+13125550000",
        "--to", "+13125551234",
        "--answering-machine-detection", "premium",
        "--json",
      ],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall, "should invoke `calls dial`");
    assertFlagValue(dialCall!, "--answering-machine-detection", "premium");
  });

  it("call-dial rejects an invalid --answering-machine-detection mode", () => {
    const fake = setupFakeTelnyx();
    assert.throws(() =>
      run(
        [
          "call-dial",
          "--connection-id", "conn-1",
          "--from", "+13125550000",
          "--to", "+13125551234",
          "--answering-machine-detection", "bogus",
          "--json",
        ],
        fake.env,
      ),
    );
  });

  it("call-control --action hangup calls `calls:actions hangup`", () => {
    const fake = setupFakeTelnyx();
    const output = run(["call-control", "--action", "hangup", "--call-control-id", "call-1", "--json"], fake.env);

    const data = JSON.parse(output);
    assert.equal(data.action, "hangup");
    assert.equal(data.call_control_id, "call-1");

    const calls = readLoggedArgs(fake.logPath);
    const hangupCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions hangup");
    assert.ok(hangupCall, "should invoke `calls:actions hangup`");
    assertFlagValue(hangupCall!, "--call-control-id", "call-1");
  });

  it("call-control --action transfer calls `calls:actions transfer` with --to", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "transfer", "--call-control-id", "call-1", "--to", "+13125559999", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const transferCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions transfer");
    assert.ok(transferCall, "should invoke `calls:actions transfer`");
    assertFlagValue(transferCall!, "--call-control-id", "call-1");
    assertFlagValue(transferCall!, "--to", "+13125559999");
  });

  it("call-control --action dtmf calls `calls:actions send-dtmf` with --digits", () => {
    const fake = setupFakeTelnyx();
    run(["call-control", "--action", "dtmf", "--call-control-id", "call-1", "--digits", "1234", "--json"], fake.env);

    const calls = readLoggedArgs(fake.logPath);
    const dtmfCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions send-dtmf");
    assert.ok(dtmfCall, "should invoke `calls:actions send-dtmf`");
    assertFlagValue(dtmfCall!, "--call-control-id", "call-1");
    assertFlagValue(dtmfCall!, "--digits", "1234");
  });

  it("call-control --action start-recording calls `calls:actions start-recording` with channels/format", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "start-recording", "--call-control-id", "call-1", "--channels", "dual", "--format", "mp3", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const recCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions start-recording");
    assert.ok(recCall, "should invoke `calls:actions start-recording`");
    assertFlagValue(recCall!, "--call-control-id", "call-1");
    assertFlagValue(recCall!, "--channels", "dual");
    assertFlagValue(recCall!, "--format", "mp3");
  });

  it("call-control --action speak calls `calls:actions speak` with --payload and --voice", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "speak", "--call-control-id", "call-1", "--payload", "Hello world", "--voice", "female", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const speakCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions speak");
    assert.ok(speakCall, "should invoke `calls:actions speak`");
    assertFlagValue(speakCall!, "--call-control-id", "call-1");
    assertFlagValue(speakCall!, "--payload", "Hello world");
    assertFlagValue(speakCall!, "--voice", "female");
  });

  it("call-control --action speak defaults --voice to female when omitted", () => {
    const fake = setupFakeTelnyx();
    run(["call-control", "--action", "speak", "--call-control-id", "call-1", "--payload", "Hi", "--json"], fake.env);

    const calls = readLoggedArgs(fake.logPath);
    const speakCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions speak");
    assert.ok(speakCall);
    assertFlagValue(speakCall!, "--voice", "female");
  });

  it("call-control --action bridge uses --call-control-id-to-bridge / -with flags", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "bridge", "--call-control-id", "call-1", "--call-control-id-2", "call-2", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const bridgeCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions bridge");
    assert.ok(bridgeCall, "should invoke `calls:actions bridge`");
    assertFlagValue(bridgeCall!, "--call-control-id-to-bridge", "call-1");
    assertFlagValue(bridgeCall!, "--call-control-id-to-bridge-with", "call-2");
  });

  it("call-control --action reject forwards --cause (default CALL_REJECTED)", () => {
    const fake = setupFakeTelnyx();
    run(["call-control", "--action", "reject", "--call-control-id", "call-1", "--json"], fake.env);

    const calls = readLoggedArgs(fake.logPath);
    const rejectCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions reject");
    assert.ok(rejectCall, "should invoke `calls:actions reject`");
    assertFlagValue(rejectCall!, "--call-control-id", "call-1");
    // The Reject API requires a cause; default to CALL_REJECTED.
    assertFlagValue(rejectCall!, "--cause", "CALL_REJECTED");
  });

  it("call-control --action reject forwards an explicit --cause and rejects invalid ones", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "reject", "--call-control-id", "call-1", "--cause", "USER_BUSY", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const rejectCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions reject");
    assert.ok(rejectCall);
    assertFlagValue(rejectCall!, "--cause", "USER_BUSY");

    assert.throws(() =>
      run(
        ["call-control", "--action", "reject", "--call-control-id", "call-1", "--cause", "NOT_A_CAUSE", "--json"],
        fake.env,
      ),
    );
  });

  it("call-control --action answer forwards deepfake/record flags in Go CLI syntax", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "answer", "--call-control-id", "call-1", "--deepfake-detection", "--record", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const answerCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions answer");
    assert.ok(answerCall, "should invoke `calls:actions answer`");
    assert.ok(answerCall!.includes("--deepfake-detection.enabled"), "must include --deepfake-detection.enabled");
    assertFlagValue(answerCall!, "--record", "record-from-answer");
  });

  it("call-control dispatches all ten AI/Conversation Relay actions with exact Go CLI flags", () => {
    const cases: Array<{
      action: string;
      flags?: string[];
      expected: Record<string, string | true>;
    }> = [
      {
        action: "add-ai-assistant-messages",
        flags: ["--message", '[{"role":"user","content":"hello"}]'],
        expected: { "--message": '[{"role":"user","content":"hello"}]' },
      },
      {
        action: "gather-using-ai",
        flags: [
          "--parameters", '{"type":"object","properties":{"name":{"type":"string"}}}',
          "--assistant.instructions", "Ask for the caller name",
          "--assistant.model", "openai/gpt-4o-mini",
          "--send-partial-results",
        ],
        expected: {
          "--parameters": '{"type":"object","properties":{"name":{"type":"string"}}}',
          "--assistant.instructions": "Ask for the caller name",
          "--assistant.model": "openai/gpt-4o-mini",
          "--send-partial-results": true,
        },
      },
      {
        action: "gather-using-audio",
        flags: ["--audio-url", "https://example.com/menu.wav", "--maximum-digits", "4"],
        expected: { "--audio-url": "https://example.com/menu.wav", "--maximum-digits": "4" },
      },
      {
        action: "gather-using-speak",
        flags: ["--payload", "Enter your PIN", "--voice", "Telnyx.KokoroTTS.af", "--valid-digits", "0123456789"],
        expected: {
          "--payload": "Enter your PIN",
          "--voice": "Telnyx.KokoroTTS.af",
          "--valid-digits": "0123456789",
        },
      },
      {
        action: "join-ai-assistant",
        flags: ["--conversation-id", "conv-1", "--participant", '{"id":"call-2","role":"user"}'],
        expected: { "--conversation-id": "conv-1", "--participant": '{"id":"call-2","role":"user"}' },
      },
      {
        action: "start-ai-assistant",
        flags: [
          "--assistant-id", "assistant-1",
          "--assistant-instructions", "Be concise",
          "--message-history", '[{"role":"user","content":"context"}]',
        ],
        expected: {
          "--assistant.id": "assistant-1",
          "--assistant.instructions": "Be concise",
          "--message-history": '[{"role":"user","content":"context"}]',
        },
      },
      {
        action: "start-conversation-relay",
        flags: [
          "--url", "wss://relay.example.com/ws",
          "--custom-parameters", '{"account_id":"acct-1"}',
          "--dtmf-detection",
        ],
        expected: {
          "--url": "wss://relay.example.com/ws",
          "--custom-parameters": '{"account_id":"acct-1"}',
          "--dtmf-detection": true,
        },
      },
      {
        action: "stop-ai-assistant",
        flags: ["--command-id", "cmd-stop-ai"],
        expected: { "--command-id": "cmd-stop-ai" },
      },
      {
        action: "stop-conversation-relay",
        flags: ["--client-state", "c3RhdGU="],
        expected: { "--client-state": "c3RhdGU=" },
      },
      {
        action: "switch-supervisor-role",
        flags: ["--role", "whisper"],
        expected: { "--role": "whisper" },
      },
    ];

    for (const testCase of cases) {
      const fake = setupFakeTelnyx();
      run([
        "call-control", "--action", testCase.action, "--call-control-id", "call-ai-1",
        ...(testCase.flags ?? []), "--json",
      ], fake.env);

      const calls = readLoggedArgs(fake.logPath);
      const invocation = calls.find((args) =>
        args[0] === "calls:actions" && args[1] === testCase.action);
      assert.ok(invocation, `should invoke calls:actions ${testCase.action}`);
      assertFlagValue(invocation!, "--call-control-id", "call-ai-1");
      for (const [flag, value] of Object.entries(testCase.expected)) {
        if (value === true) assert.ok(invocation!.includes(flag), `expected bare ${flag}`);
        else assertFlagValue(invocation!, flag, value);
      }
    }
  });

  it("call-control validates upstream-required AI action flags and supervisor roles", () => {
    const fake = setupFakeTelnyx();
    for (const args of [
      ["gather-using-speak"],
      ["join-ai-assistant"],
      ["switch-supervisor-role", "--role", "invalid"],
    ]) {
      assert.throws(() => run([
        "call-control", "--action", ...args, "--call-control-id", "call-1", "--json",
      ], fake.env));
    }
  });

  it("does not reject optional generated fields for AI gather and Conversation Relay", () => {
    for (const action of ["gather-using-ai", "gather-using-audio", "start-conversation-relay"]) {
      const fake = setupFakeTelnyx();
      run(["call-control", "--action", action, "--call-control-id", "call-1", "--json"], fake.env);
      const invocation = readLoggedArgs(fake.logPath).find((args) =>
        args[0] === "calls:actions" && args[1] === action);
      assert.ok(invocation, `should invoke calls:actions ${action}`);
    }
  });

  it("call-status calls `calls retrieve-status`", () => {
    const fake = setupFakeTelnyx();
    const output = run(["call-status", "--call-control-id", "call-1", "--json"], fake.env);

    const data = JSON.parse(output);
    assert.equal(data.call_status, "active");

    const calls = readLoggedArgs(fake.logPath);
    const statusCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls retrieve-status");
    assert.ok(statusCall, "should invoke `calls retrieve-status`");
    assertFlagValue(statusCall!, "--call-control-id", "call-1");
  });

  it("help text includes the voice commands", () => {
    const output = run(["help"]);
    assert.ok(output.includes("call-dial"), "help should list call-dial");
    assert.ok(output.includes("call-control"), "help should list call-control");
    assert.ok(output.includes("call-status"), "help should list call-status");
    assert.ok(output.includes("--answering-machine-detection"), "help should document AMD flag");
    for (const action of [
      "add-ai-assistant-messages", "gather-using-ai", "gather-using-audio",
      "gather-using-speak", "join-ai-assistant", "start-ai-assistant",
      "start-conversation-relay", "stop-ai-assistant", "stop-conversation-relay",
      "switch-supervisor-role",
    ]) {
      assert.ok(output.includes(action), `help should document ${action}`);
    }
    assert.ok(output.includes("--assistant-id"), "help should document agent-friendly assistant flags");
    assert.ok(output.includes("--assistant.id"), "help should document the mapped Go assistant flag");
    assert.ok(output.includes("raw JSON"), "help should document raw JSON inputs");
  });

  it("capabilities lists the voice actions and composite commands", () => {
    const fake = setupFakeTelnyx();
    const output = run(["capabilities", "--json"], fake.env);
    const data = JSON.parse(output);

    const voice = data.api_capabilities["📞 Voice"] as Array<{ name: string; actions: string[] }>;
    assert.ok(voice, "Voice category should exist");
    const actions = voice[0].actions;
    for (const a of [
      "answer_call", "hangup_call", "transfer_call", "send_dtmf", "speak_tts",
      "bridge_calls", "get_call_status", "deepfake_detection",
      "add_ai_assistant_messages", "gather_using_ai", "gather_using_audio",
      "gather_using_speak", "join_ai_assistant", "start_ai_assistant",
      "start_conversation_relay", "stop_ai_assistant", "stop_conversation_relay",
      "switch_supervisor_role",
    ]) {
      assert.ok(actions.includes(a), `Voice actions should include ${a}`);
    }

    const composite = data.composite_commands.map((c: any) => c.name);
    assert.ok(composite.some((c: string) => c.includes("call-dial")));
    assert.ok(composite.some((c: string) => c.includes("call-control")));
    assert.ok(composite.some((c: string) => c.includes("call-status")));
  });

  // === Gap PR tests: number masking + advanced call-control actions ===

  it("call-dial with --privacy id passes number masking flag to Go CLI", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-dial", "--connection-id", "conn-1", "--from", "+13125550000", "--to", "+13125551234", "--privacy", "id", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall, "should invoke `calls dial`");
    // The v0.21 Go CLI exposes --privacy (BodyPath: "privacy").
    assertFlagValue(dialCall!, "--privacy", "id");
  });

  it("call-dial with --from-display-name passes the flag through", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-dial", "--connection-id", "conn-1", "--from", "+13125550000", "--to", "+13125551234", "--from-display-name", "Acme Corp", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall);
    assertFlagValue(dialCall!, "--from-display-name", "Acme Corp");
  });

  it("call-dial with --transcription flag passes through", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-dial", "--connection-id", "conn-1", "--from", "+13125550000", "--to", "+13125551234", "--transcription", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const dialCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls dial");
    assert.ok(dialCall);
    assert.ok(dialCall!.includes("--transcription"), "should include --transcription flag");
  });

  it("call-control --action gather calls `calls:actions gather` and forwards client-state/command-id", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "gather", "--call-control-id", "call-1", "--client-state", "state-1", "--command-id", "cmd-1", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const gatherCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions gather");
    assert.ok(gatherCall, "should invoke `calls:actions gather`");
    assertFlagValue(gatherCall!, "--call-control-id", "call-1");
    assertFlagValue(gatherCall!, "--client-state", "state-1");
    assertFlagValue(gatherCall!, "--command-id", "cmd-1");
  });

  it("call-control --action gather works without --client-state/--command-id (optional)", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "gather", "--call-control-id", "call-1", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const gatherCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions gather");
    assert.ok(gatherCall, "should invoke `calls:actions gather`");
    assertFlagValue(gatherCall!, "--call-control-id", "call-1");
    assert.ok(!gatherCall!.includes("--client-state"), "must not include --client-state when omitted");
    assert.ok(!gatherCall!.includes("--command-id"), "must not include --command-id when omitted");
  });

  it("call-control --action send-sip-info forwards --body and --content-type", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "send-sip-info", "--call-control-id", "call-1", "--body", "Signal=1234", "--content-type", "application/dtmf-relay", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const sipCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions send-sip-info");
    assert.ok(sipCall, "should invoke `calls:actions send-sip-info`");
    assertFlagValue(sipCall!, "--call-control-id", "call-1");
    assertFlagValue(sipCall!, "--body", "Signal=1234");
    assertFlagValue(sipCall!, "--content-type", "application/dtmf-relay");
  });

  it("call-control --action start-playback calls `calls:actions start-playback` with --audio-url", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "start-playback", "--call-control-id", "call-1", "--audio-url", "https://example.com/hello.wav", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const playbackCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions start-playback");
    assert.ok(playbackCall, "should invoke `calls:actions start-playback`");
    assertFlagValue(playbackCall!, "--call-control-id", "call-1");
    assertFlagValue(playbackCall!, "--audio-url", "https://example.com/hello.wav");
  });

  it("call-control --action stop-gather calls `calls:actions stop-gather`", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "stop-gather", "--call-control-id", "call-1", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const stopCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions stop-gather");
    assert.ok(stopCall, "should invoke `calls:actions stop-gather`");
  });

  it("call-control --action pause-recording calls `calls:actions pause-recording`", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "pause-recording", "--call-control-id", "call-1", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const pauseCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions pause-recording");
    assert.ok(pauseCall, "should invoke `calls:actions pause-recording`");
  });

  it("call-control --action start-transcription calls `calls:actions start-transcription`", () => {
    const fake = setupFakeTelnyx();
    run(
      ["call-control", "--action", "start-transcription", "--call-control-id", "call-1", "--json"],
      fake.env,
    );

    const calls = readLoggedArgs(fake.logPath);
    const transCall = calls.find((a) => a.slice(0, 2).join(" ") === "calls:actions start-transcription");
    assert.ok(transCall, "should invoke `calls:actions start-transcription`");
  });

  it("help text includes --privacy flag for number masking", () => {
    const output = run(["help"]);
    assert.ok(output.includes("--privacy"), "help should document --privacy flag");
    assert.ok(output.includes("number masking") || output.includes("Number masking") || output.includes("caller ID"), "help should mention number masking");
  });
});
