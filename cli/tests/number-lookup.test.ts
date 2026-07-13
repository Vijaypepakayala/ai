/**
 * Tests for lookup-number — verify the Agent CLI wraps the generated Go CLI's
 * `number-lookup retrieve` command without making real API calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const cliBin = join(cliRoot, "bin", "telnyx-agent.ts");

function setupFakeTelnyx(): { logPath: string; env: NodeJS.ProcessEnv } {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-agent-number-lookup-"));
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

const formatIndex = args.indexOf("--format");
const command = args.filter((_arg, index) => index !== formatIndex && index !== formatIndex + 1);
if (command[0] !== "number-lookup" || command[1] !== "retrieve") {
  console.error("unexpected command: " + command.join(" "));
  process.exit(2);
}

const phoneIndex = command.indexOf("--phone-number");
const phoneNumber = phoneIndex >= 0 ? command[phoneIndex + 1] : "";
console.log(JSON.stringify({
  data: {
    record_type: "number_lookup",
    phone_number: phoneNumber,
    national_format: "(312) 555-0100",
    country_code: "US",
    carrier: {
      error_code: null,
      mobile_country_code: "310",
      mobile_network_code: "410",
      name: "Example Wireless",
      normalized_carrier: "Example",
      type: "mobile"
    },
    caller_name: { caller_name: "EXAMPLE INC", error_code: "00000" },
    portability: {
      line_type: "wireless",
      ported_status: "Y",
      spid_carrier_name: "Example Wireless",
      state: "IL"
    }
  }
}));
`,
  );
  chmodSync(fakeTelnyx, 0o755);

  return {
    logPath,
    env: {
      ...process.env,
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

describe("lookup-number", () => {
  it("calls the exact Go CLI command and forwards --type", () => {
    const fake = setupFakeTelnyx();
    runAgent(
      ["lookup-number", "--phone-number", "+131****0100", "--type", "caller-name", "--json"],
      fake.env,
    );

    assert.deepEqual(readLoggedArgs(fake.logPath), [[
      "number-lookup",
      "retrieve",
      "--phone-number",
      "+131****0100",
      "--type",
      "caller-name",
      "--format",
      "json",
    ]]);
  });

  it("omits the optional --type flag when it is not provided", () => {
    const fake = setupFakeTelnyx();
    runAgent(["lookup-number", "--phone-number", "+131****0100", "--json"], fake.env);

    assert.deepEqual(readLoggedArgs(fake.logPath), [[
      "number-lookup",
      "retrieve",
      "--phone-number",
      "+131****0100",
      "--format",
      "json",
    ]]);
  });

  it("unwraps and preserves the complete number lookup response data", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(
      ["lookup-number", "--phone-number", "+131****0100", "--type", "carrier", "--json"],
      fake.env,
    );
    const result = JSON.parse(output);

    assert.equal(result.record_type, "number_lookup");
    assert.equal(result.phone_number, "+131****0100");
    assert.equal(result.national_format, "(312) 555-0100");
    assert.equal(result.country_code, "US");
    assert.equal(result.carrier.name, "Example Wireless");
    assert.equal(result.carrier.type, "mobile");
    assert.equal(result.caller_name.caller_name, "EXAMPLE INC");
    assert.equal(result.portability.line_type, "wireless");
    assert.equal(result.portability.ported_status, "Y");
  });

  it("prints a useful human-readable summary", () => {
    const fake = setupFakeTelnyx();
    const output = runAgent(["lookup-number", "--phone-number", "+131****0100"], fake.env);

    assert.match(output, /Number lookup complete/);
    assert.match(output, /Example Wireless/);
    assert.match(output, /EXAMPLE INC/);
    assert.match(output, /wireless/);
  });

  it("requires --phone-number without invoking the Go CLI", () => {
    const fake = setupFakeTelnyx();
    const result = spawnSync("npx", ["tsx", cliBin, "lookup-number", "--json"], {
      cwd: cliRoot,
      encoding: "utf8",
      env: fake.env,
      timeout: 30000,
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /--phone-number is required/);
    assert.deepEqual(readLoggedArgs(fake.logPath), []);
  });

  it("rejects lookup types not supported by the Go API", () => {
    const fake = setupFakeTelnyx();
    const result = spawnSync(
      "npx",
      ["tsx", cliBin, "lookup-number", "--phone-number", "+131****0100", "--type", "fraud"],
      { cwd: cliRoot, encoding: "utf8", env: fake.env, timeout: 30000 },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /Valid: carrier, caller-name/);
    assert.deepEqual(readLoggedArgs(fake.logPath), []);
  });

  it("is documented in help and capabilities", () => {
    const fake = setupFakeTelnyx();
    const help = runAgent(["help"], fake.env);
    assert.match(help, /lookup-number/);
    assert.match(help, /--phone-number <e164>/);
    assert.match(help, /carrier or caller-name/);

    const capabilities = JSON.parse(runAgent(["capabilities", "--json"], fake.env));
    assert.ok(
      capabilities.api_capabilities["🔍 Lookup"][0].actions.includes("lookup_number"),
      "Lookup capability must advertise lookup_number",
    );
    assert.ok(
      capabilities.composite_commands.some((command: { name: string }) => command.name === "telnyx-agent lookup-number"),
      "composite commands must list the executable lookup-number command",
    );
  });
});
