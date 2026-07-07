/**
 * Mock-binary tests for the `telnyx-agent tts` (text-to-speech) command.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const cliBin = join(cliRoot, "bin", "telnyx-agent.ts");

/**
 * Build a fake `telnyx` binary that logs every invocation's args and returns
 * canned JSON for the `text-to-speech generate-speech` subcommand.
 *
 * With `output_type=base64_output`, the real API (POST /text-to-speech/speech)
 * responds `{ "base64_audio": "..." }` with no `data` envelope, which the Go
 * CLI prints as-is with `--format json`.
 */
function setupFakeTelnyx(): { fakeTelnyx: string; logPath: string; env: NodeJS.ProcessEnv } {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-agent-tts-"));
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

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const command = args.filter((a) => a !== "--format" && a !== "json");

if (command[0] === "text-to-speech" && command[1] === "generate-speech") {
  const outputType = flagValue(command, "--output-type");
  if (outputType === "base64_output") {
    console.log(JSON.stringify({ base64_audio: "SGVsbG8gYXVkaW8=" }));
  } else {
    // The real API rejects anything other than binary_output/base64_output,
    // and binary_output would be raw audio bytes — emit an error marker so a
    // test forwarding the wrong enum fails loudly.
    console.error("unexpected --output-type: " + outputType);
    process.exit(1);
  }
} else if (command[0] === "text-to-speech" && command[1] === "list-voices") {
  const provider = flagValue(command, "--provider") || "telnyx";
  console.log(JSON.stringify({ data: [
    { voice_id: "voice-1", name: "Voice One", language: "en-US", gender: "female", provider },
    { voice_id: "voice-2", name: "Voice Two", language: "en-GB", gender: "male", provider },
  ] }));
} else if (command[0] === "text-to-speech" && command[1] === "retrieve-speech") {
  const id = flagValue(command, "--id");
  console.log(JSON.stringify({ data: { id, status: "completed", text: "Hello world", voice: "voice-1", provider: "telnyx", audio_url: "https://example.com/audio.mp3" } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}
`,
  );
  chmodSync(fakeTelnyx, 0o755);

  return {
    fakeTelnyx,
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

function assertFlagValue(args: string[], flag: string, value: string): void {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `expected ${flag} in ${args.join(" ")}`);
  assert.equal(args[index + 1], value, `expected ${flag} ${value} in ${args.join(" ")}`);
}

function assertNoFlag(args: string[], flag: string): void {
  assert.equal(args.indexOf(flag), -1, `did not expect ${flag} in ${args.join(" ")}`);
}

function runCli(args: string[], env: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", cliBin, ...args], {
      cwd: cliRoot,
      encoding: "utf8",
      env,
      timeout: 30000,
    });
    return { stdout, status: 0 };
  } catch (err: any) {
    return { stdout: err.stdout?.toString() ?? "", status: err.status ?? 1 };
  }
}

describe("tts (text-to-speech) command", () => {
  it("defaults to base64_output and surfaces the base64_audio response field", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["tts", "--text", "Hello world", "--json"], fake.env);

    assert.equal(status, 0, `expected exit 0, got ${status}`);
    const data = JSON.parse(stdout);
    assert.equal(data.text, "Hello world");
    assert.equal(data.output_type, "base64_output");
    assert.equal(data.audio_data, "SGVsbG8gYXVkaW8=");
    assert.equal(data.has_audio_data, true);

    const calls = readLoggedArgs(fake.logPath);
    const ttsCall = calls.find((a) => a.slice(0, 2).join(" ") === "text-to-speech generate-speech");
    assert.ok(ttsCall, "expected a text-to-speech generate-speech call");
    assertFlagValue(ttsCall, "--text", "Hello world");
    assertFlagValue(ttsCall, "--output-type", "base64_output");
  });

  it("forwards --provider and --voice flags when supplied", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(
      ["tts", "--text", "Hello", "--provider", "aws", "--voice", "Amy", "--json"],
      fake.env,
    );

    assert.equal(status, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.provider, "aws");
    assert.equal(data.voice, "Amy");

    const ttsCall = readLoggedArgs(fake.logPath).find(
      (a) => a.slice(0, 2).join(" ") === "text-to-speech generate-speech",
    );
    assert.ok(ttsCall);
    assertFlagValue(ttsCall, "--provider", "aws");
    assertFlagValue(ttsCall, "--voice", "Amy");
  });

  it("accepts the xai provider", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(
      ["tts", "--text", "Hello", "--provider", "xai", "--json"],
      fake.env,
    );

    assert.equal(status, 0, `expected exit 0, got ${status}`);
    const data = JSON.parse(stdout);
    assert.equal(data.provider, "xai");

    const ttsCall = readLoggedArgs(fake.logPath).find(
      (a) => a.slice(0, 2).join(" ") === "text-to-speech generate-speech",
    );
    assert.ok(ttsCall);
    assertFlagValue(ttsCall, "--provider", "xai");
  });

  it("maps the friendly base64 alias to the base64_output API enum", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(
      ["tts", "--text", "Hello", "--output-type", "base64", "--json"],
      fake.env,
    );

    assert.equal(status, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.output_type, "base64_output");
    assert.equal(data.has_audio_data, true);

    const ttsCall = readLoggedArgs(fake.logPath).find(
      (a) => a.slice(0, 2).join(" ") === "text-to-speech generate-speech",
    );
    assert.ok(ttsCall);
    assertFlagValue(ttsCall, "--output-type", "base64_output");
    assertNoFlag(ttsCall, "--disable-cache");
  });

  it("rejects unsupported output types without invoking the telnyx CLI", () => {
    const fake = setupFakeTelnyx();
    for (const bad of ["url", "binary_output"]) {
      const { status } = runCli(["tts", "--text", "Hello", "--output-type", bad, "--json"], fake.env);
      assert.notEqual(status, 0, `expected non-zero exit for --output-type ${bad}`);
    }
    if (existsSync(fake.logPath)) {
      assert.equal(readLoggedArgs(fake.logPath).length, 0, "expected no telnyx CLI invocations");
    }
  });

  it("fails when --text is not provided", () => {
    const fake = setupFakeTelnyx();
    const { status, stdout } = runCli(["tts", "--json"], fake.env);

    assert.notEqual(status, 0, "expected non-zero exit when --text is missing");
    // No telnyx CLI call should have been made — the fake binary only creates
    // the log file when it is actually invoked, so a missing file means zero
    // invocations, which is exactly what we want.
    if (existsSync(fake.logPath)) {
      const calls = readLoggedArgs(fake.logPath);
      assert.equal(calls.length, 0, "expected no telnyx CLI invocations");
    }
    // JSON error path should still emit structured output.
    if (stdout.trim()) {
      const data = JSON.parse(stdout);
      assert.ok(data.error, "expected an error field in JSON output");
    }
  });

  it("lists the tts command in the help text", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["help"], fake.env);

    assert.equal(status, 0);
    assert.match(stdout, /tts\b/);
    assert.match(stdout, /--text/);
    assert.match(stdout, /--output-type/);
    assert.match(stdout, /--provider/);
  });

  it("tts-voices calls text-to-speech list-voices and returns the voice list", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["tts-voices", "--json"], fake.env);

    assert.equal(status, 0, `expected exit 0, got ${status}`);
    const data = JSON.parse(stdout);
    assert.equal(data.count, 2);
    assert.ok(Array.isArray(data.voices));
    assert.equal(data.voices[0].voice_id, "voice-1");

    const calls = readLoggedArgs(fake.logPath);
    const voicesCall = calls.find((a) => a.slice(0, 2).join(" ") === "text-to-speech list-voices");
    assert.ok(voicesCall, "expected a text-to-speech list-voices call");
    assertNoFlag(voicesCall, "--provider");
  });

  it("tts-voices forwards the --provider flag when supplied", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["tts-voices", "--provider", "aws", "--json"], fake.env);

    assert.equal(status, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.provider, "aws");
    assert.equal(data.voices[0].provider, "aws");

    const voicesCall = readLoggedArgs(fake.logPath).find(
      (a) => a.slice(0, 2).join(" ") === "text-to-speech list-voices",
    );
    assert.ok(voicesCall);
    assertFlagValue(voicesCall, "--provider", "aws");
  });

  it("tts-retrieve calls text-to-speech retrieve-speech with --id", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["tts-retrieve", "--id", "speech-123", "--json"], fake.env);

    assert.equal(status, 0, `expected exit 0, got ${status}`);
    const data = JSON.parse(stdout);
    assert.equal(data.id, "speech-123");
    assert.equal(data.status, "completed");
    assert.equal(data.audio_url, "https://example.com/audio.mp3");
    assert.equal(data.has_audio_data, false);

    const calls = readLoggedArgs(fake.logPath);
    const retrieveCall = calls.find((a) => a.slice(0, 2).join(" ") === "text-to-speech retrieve-speech");
    assert.ok(retrieveCall, "expected a text-to-speech retrieve-speech call");
    assertFlagValue(retrieveCall, "--id", "speech-123");
  });

  it("tts-retrieve fails when --id is not provided", () => {
    const fake = setupFakeTelnyx();
    const { status, stdout } = runCli(["tts-retrieve", "--json"], fake.env);

    assert.notEqual(status, 0, "expected non-zero exit when --id is missing");
    if (existsSync(fake.logPath)) {
      const calls = readLoggedArgs(fake.logPath);
      assert.equal(calls.length, 0, "expected no telnyx CLI invocations");
    }
    if (stdout.trim()) {
      const data = JSON.parse(stdout);
      assert.ok(data.error, "expected an error field in JSON output");
    }
  });

  it("lists the tts-voices and tts-retrieve commands in the help text", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["help"], fake.env);

    assert.equal(status, 0);
    assert.match(stdout, /tts-voices\b/);
    assert.match(stdout, /tts-retrieve\b/);
  });
});
