/**
 * Mock-binary tests for Telnyx AI inference commands.
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
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-agent-ai-"));
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

if (args[0] === "ai:openai:chat" && args[1] === "create-completion") {
  console.log(JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion",
    model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    choices: [{ index: 0, message: { role: "assistant", content: "SIP establishes and manages real-time communication sessions." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: 8, total_tokens: 17 }
  }));
} else if (args[0] === "ai:openai:embeddings" && args[1] === "create-embeddings") {
  console.log(JSON.stringify({
    object: "list",
    model: "intfloat/multilingual-e5-large",
    data: [
      { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
      { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] }
    ],
    usage: { prompt_tokens: 4, total_tokens: 4 }
  }));
} else if (args[0] === "ai:openai" && args[1] === "list-models") {
  console.log(JSON.stringify({ object: "list", data: [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", object: "model", owned_by: "telnyx" },
    { id: "intfloat/multilingual-e5-large", object: "model", owned_by: "telnyx" }
  ] }));
} else {
  console.error("unexpected command: " + args.join(" "));
  process.exit(2);
}
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

function readLoggedArgs(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertFlagValue(args: string[], flag: string, value: string): void {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `expected ${flag} in ${args.join(" ")}`);
  assert.equal(args[index + 1], value);
}

function valuesForFlag(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
}

describe("AI inference commands", () => {
  it("ai-chat uses the current ai:openai:chat path and serializes the user message", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["ai-chat", "--message", "Explain SIP", "--json"], fake.env);

    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    assert.equal(output.content, "SIP establishes and manages real-time communication sessions.");
    assert.equal(output.choices[0].finish_reason, "stop");
    assert.equal(output.usage.total_tokens, 17);

    const args = readLoggedArgs(fake.logPath)[0];
    assert.deepEqual(args.slice(0, 2), ["ai:openai:chat", "create-completion"]);
    assert.ok(!args.includes("ai:chat"), "must not use the deprecated ai:chat command");
    assert.deepEqual(JSON.parse(valuesForFlag(args, "--message")[0]), {
      role: "user",
      content: "Explain SIP",
    });
    assertFlagValue(args, "--format", "json");
  });

  it("ai-chat prepends --system and forwards common completion flags", () => {
    const fake = setupFakeTelnyx();
    const { status } = runCli(
      [
        "ai-chat",
        "--system", "Be concise",
        "--message", "What is WebRTC?",
        "--model", "meta-llama/Meta-Llama-3.1-8B-Instruct",
        "--max-tokens", "64",
        "--temperature", "0.2",
        "--top-p", "0.9",
        "--enable-thinking", "false",
        "--json",
      ],
      fake.env,
    );

    assert.equal(status, 0);
    const args = readLoggedArgs(fake.logPath)[0];
    const messages = valuesForFlag(args, "--message").map((message) => JSON.parse(message));
    assert.deepEqual(messages, [
      { role: "system", content: "Be concise" },
      { role: "user", content: "What is WebRTC?" },
    ]);
    assertFlagValue(args, "--model", "meta-llama/Meta-Llama-3.1-8B-Instruct");
    assertFlagValue(args, "--max-tokens", "64");
    assertFlagValue(args, "--temperature", "0.2");
    assertFlagValue(args, "--top-p", "0.9");
    assertFlagValue(args, "--enable-thinking", "false");
  });

  it("ai-chat expands a --messages JSON conversation into repeated Go CLI flags", () => {
    const fake = setupFakeTelnyx();
    const conversation = JSON.stringify([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "Explain SIP" },
    ]);
    const { status } = runCli(["ai-chat", "--messages", conversation, "--json"], fake.env);

    assert.equal(status, 0);
    const args = readLoggedArgs(fake.logPath)[0];
    assert.deepEqual(valuesForFlag(args, "--message").map((value) => JSON.parse(value)), JSON.parse(conversation));
  });

  it("ai-chat rejects missing or malformed messages before invoking telnyx", () => {
    for (const args of [["ai-chat", "--json"], ["ai-chat", "--messages", "not-json", "--json"]]) {
      const fake = setupFakeTelnyx();
      const result = runCli(args, fake.env);
      assert.notEqual(result.status, 0);
      assert.ok(JSON.parse(result.stdout).error);
      assert.deepEqual(readLoggedArgs(fake.logPath), []);
    }
  });

  it("ai-embed uses ai:openai:embeddings and forwards the exact embedding flags", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(
      [
        "ai-embed",
        "--input", "[\"first\",\"second\"]",
        "--model", "intfloat/multilingual-e5-large",
        "--dimensions", "3",
        "--encoding-format", "float",
        "--user", "agent-test",
        "--json",
      ],
      fake.env,
    );

    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    assert.equal(output.count, 2);
    assert.equal(output.model, "intfloat/multilingual-e5-large");
    assert.deepEqual(output.embeddings[0].embedding, [0.1, 0.2, 0.3]);
    assert.equal(output.usage.total_tokens, 4);

    const args = readLoggedArgs(fake.logPath)[0];
    assert.deepEqual(args.slice(0, 2), ["ai:openai:embeddings", "create-embeddings"]);
    assertFlagValue(args, "--input", "[\"first\",\"second\"]");
    assertFlagValue(args, "--model", "intfloat/multilingual-e5-large");
    assertFlagValue(args, "--dimensions", "3");
    assertFlagValue(args, "--encoding-format", "float");
    assertFlagValue(args, "--user", "agent-test");
  });

  it("ai-embed requires both --input and --model", () => {
    for (const args of [
      ["ai-embed", "--model", "intfloat/multilingual-e5-large", "--json"],
      ["ai-embed", "--input", "hello", "--json"],
    ]) {
      const fake = setupFakeTelnyx();
      const result = runCli(args, fake.env);
      assert.notEqual(result.status, 0);
      assert.ok(JSON.parse(result.stdout).error);
      assert.deepEqual(readLoggedArgs(fake.logPath), []);
    }
  });

  it("ai-models uses ai:openai list-models and normalizes the model list", () => {
    const fake = setupFakeTelnyx();
    const { stdout, status } = runCli(["ai-models", "--json"], fake.env);

    assert.equal(status, 0);
    const output = JSON.parse(stdout);
    assert.equal(output.count, 2);
    assert.equal(output.models[0].id, "meta-llama/Meta-Llama-3.1-8B-Instruct");

    const args = readLoggedArgs(fake.logPath)[0];
    assert.deepEqual(args.slice(0, 2), ["ai:openai", "list-models"]);
    assertFlagValue(args, "--format", "json");
  });

  it("help and capabilities expose all three executable AI commands", () => {
    const fake = setupFakeTelnyx();
    const help = runCli(["help"], fake.env);
    assert.equal(help.status, 0);
    for (const command of ["ai-chat", "ai-embed", "ai-models"]) {
      assert.ok(help.stdout.includes(command), `help must include ${command}`);
    }
    assert.ok(help.stdout.includes("--messages"));
    assert.ok(help.stdout.includes("--dimensions"));

    const capabilities = runCli(["capabilities", "--json"], fake.env);
    assert.equal(capabilities.status, 0);
    const data = JSON.parse(capabilities.stdout);
    const compositeNames = data.composite_commands.map((entry: { name: string }) => entry.name);
    for (const command of ["telnyx-agent ai-chat", "telnyx-agent ai-embed", "telnyx-agent ai-models"]) {
      assert.ok(compositeNames.includes(command), `capabilities must include ${command}`);
    }
    const aiActions = data.api_capabilities["🤖 AI"].flatMap((entry: { actions: string[] }) => entry.actions);
    assert.ok(aiActions.includes("ai_chat"));
    assert.ok(aiActions.includes("ai_embed"));
    assert.ok(aiActions.includes("list_ai_models"));
  });
});
