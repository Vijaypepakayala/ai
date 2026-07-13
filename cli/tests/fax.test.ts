/**
 * Tests for send-fax — verify the Agent CLI's validation, output, and exact
 * `faxes create` invocation without making real API calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const cliBin = join(cliRoot, "bin", "telnyx-agent.ts");

function setupFakeTelnyx(): { logPath: string; env: NodeJS.ProcessEnv } {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-agent-fax-"));
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

const fmtIdx = args.indexOf("--format");
const command = args.filter((_, i) => i !== fmtIdx && i !== fmtIdx + 1);
function flag(name) {
  const direct = command.indexOf(name);
  if (direct >= 0) return command[direct + 1];
  const assignment = command.find((arg) => arg.startsWith(name + "="));
  return assignment ? assignment.slice(name.length + 1) : undefined;
}

if (command[0] === "faxes" && command[1] === "create") {
  const data = {
    id: "fax-123",
    record_type: "fax",
    status: "queued",
    connection_id: flag("--connection-id"),
    from: flag("--from"),
    to: flag("--to"),
    media_url: flag("--media-url"),
    media_name: flag("--media-name"),
  };
  console.log(JSON.stringify({ data }));
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
      TELNYX_API_KEY: "KEY_fake_test",
    },
  };
}

function runAgent(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("npx", ["tsx", cliBin, ...args], {
    cwd: cliRoot,
    encoding: "utf8",
    env,
    timeout: 30000,
  });
}

function readLoggedArgs(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function faxCall(logPath: string): string[] {
  const call = readLoggedArgs(logPath).find((args) => args[0] === "faxes" && args[1] === "create");
  assert.ok(call, "must invoke faxes create");
  return call;
}

function assertFlagValue(args: string[], name: string, expected: string): void {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `expected ${name} in ${args.join(" ")}`);
  assert.equal(args[index + 1], expected);
}

function runAgentExpectingFailure(args: string[], env: NodeJS.ProcessEnv, expected: RegExp): void {
  try {
    runAgent(args, env);
    assert.fail("expected command to fail");
  } catch (err: any) {
    assert.notEqual(err?.status, 0, "expected a non-zero exit status");
    assert.match(`${err?.stderr ?? ""}${err?.stdout ?? ""}`, expected);
  }
}

describe("send-fax", () => {
  it("sends a hosted document URL with the required faxes create flags", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(
      [
        "send-fax",
        "--connection-id", "conn-123",
        "--from", "+131****0000",
        "--to", "+131****0001",
        "--media-url", "https://example.com/document.pdf",
        "--json",
      ],
      fake.env,
    );

    assert.deepEqual(JSON.parse(output), {
      fax_id: "fax-123",
      status: "queued",
      connection_id: "conn-123",
      from: "+131****0000",
      to: "+131****0001",
      media_url: "https://example.com/document.pdf",
    });

    const call = faxCall(fake.logPath);
    assertFlagValue(call, "--connection-id", "conn-123");
    assertFlagValue(call, "--from", "+131****0000");
    assertFlagValue(call, "--to", "+131****0001");
    assertFlagValue(call, "--media-url", "https://example.com/document.pdf");
    assert.ok(!call.includes("--media-name"));
    assertFlagValue(call, "--format", "json");
  });

  it("sends pre-uploaded media and forwards all optional faxes create flags", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(
      [
        "send-fax",
        "--connection-id", "conn-456",
        "--from", "+131****0000",
        "--to", "sip:fax@example.com",
        "--media-name", "uploaded-document.pdf",
        "--black-threshold", "90",
        "--client-state", "c3RhdGU=",
        "--from-display-name", "Acme Fax",
        "--monochrome",
        "--preview-format", "pdf",
        "--quality", "very_high",
        "--store-preview",
        "--t38-enabled", "false",
        "--webhook-url", "https://example.com/fax-events",
        "--json",
      ],
      fake.env,
    );

    const result = JSON.parse(output);
    assert.equal(result.fax_id, "fax-123");
    assert.equal(result.media_name, "uploaded-document.pdf");
    assert.equal(result.to, "sip:fax@example.com");

    const call = faxCall(fake.logPath);
    assertFlagValue(call, "--media-name", "uploaded-document.pdf");
    assertFlagValue(call, "--black-threshold", "90");
    assertFlagValue(call, "--client-state", "c3RhdGU=");
    assertFlagValue(call, "--from-display-name", "Acme Fax");
    assert.ok(call.includes("--monochrome"));
    assertFlagValue(call, "--preview-format", "pdf");
    assertFlagValue(call, "--quality", "very_high");
    assert.ok(call.includes("--store-preview"));
    assert.ok(call.includes("--t38-enabled=false"));
    assertFlagValue(call, "--webhook-url", "https://example.com/fax-events");
    assert.ok(!call.includes("--media-url"));
  });

  it("supports store-media for URL documents", () => {
    const fake = setupFakeTelnyx();
    runAgent(
      [
        "send-fax",
        "--connection-id", "conn-123",
        "--from", "+131****0000",
        "--to", "+131****0001",
        "--media-url", "https://example.com/document.pdf",
        "--store-media",
        "--json",
      ],
      fake.env,
    );

    assert.ok(faxCall(fake.logPath).includes("--store-media"));
  });

  it("requires a connection, sender, destination, and document source", () => {
    const base = [
      "send-fax",
      "--connection-id", "conn-123",
      "--from", "+131****0000",
      "--to", "+131****0001",
      "--media-url", "https://example.com/document.pdf",
      "--json",
    ];
    const required = [
      ["--connection-id", /--connection-id is required/],
      ["--from", /--from is required/],
      ["--to", /--to is required/],
      ["--media-url", /One document source is required/],
    ] as const;

    for (const [flag, expected] of required) {
      const fake = setupFakeTelnyx();
      const index = base.indexOf(flag);
      const args = [...base.slice(0, index), ...base.slice(index + 2)];
      runAgentExpectingFailure(args, fake.env, expected);
      assert.deepEqual(readLoggedArgs(fake.logPath), [], "validation must happen before invoking telnyx");
    }
  });

  it("rejects mutually exclusive or incompatible media options", () => {
    const both = setupFakeTelnyx();
    runAgentExpectingFailure(
      [
        "send-fax",
        "--connection-id", "conn-123",
        "--from", "+131****0000",
        "--to", "+131****0001",
        "--media-url", "https://example.com/document.pdf",
        "--media-name", "uploaded-document.pdf",
      ],
      both.env,
      /--media-url and --media-name are mutually exclusive/,
    );
    assert.deepEqual(readLoggedArgs(both.logPath), []);

    const storedUpload = setupFakeTelnyx();
    runAgentExpectingFailure(
      [
        "send-fax",
        "--connection-id", "conn-123",
        "--from", "+131****0000",
        "--to", "+131****0001",
        "--media-name", "uploaded-document.pdf",
        "--store-media",
      ],
      storedUpload.env,
      /--store-media is not supported with --media-name/,
    );
    assert.deepEqual(readLoggedArgs(storedUpload.logPath), []);
  });

  it("documents send-fax flags and examples in help", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(["help"], fake.env);
    assert.match(output, /send-fax/);
    assert.match(output, /--connection-id <id>\s+Fax application connection ID/);
    assert.match(output, /--media-url <url>/);
    assert.match(output, /--media-name <name>/);
    assert.match(output, /send-fax --connection-id <id>/);
  });

  it("advertises send-fax as the implementation of the send_fax capability", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(["capabilities", "--json"], fake.env);
    const capabilities = JSON.parse(output);

    assert.ok(capabilities.api_capabilities["📠 Fax"][0].actions.includes("send_fax"));
    assert.ok(
      capabilities.composite_commands.some((command: { name: string }) => command.name === "telnyx-agent send-fax"),
      "send-fax must be listed among executable composite commands",
    );
  });
});
