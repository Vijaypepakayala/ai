import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "telnyx-agent.ts");

function withFakeEdgeCli(mode: "none" | "oauth" | "api_key" = "api_key") {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-edge-fake-"));
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const fakeEdge = join(binDir, "telnyx-edge");
  writeFileSync(
    fakeEdge,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'api-key' && args[2] === 'set' && args.includes('--help')) {
  console.log('Set API key for authentication. The API key must be provided as an argument.');
  process.exit(0);
}
if (args[0] === 'status') {
  console.log('CLI status: connected');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log(['telnyx-edge v0.1.0', 'Commands: auth login, auth api-key set, status, ship, list, delete-func, secrets, bindings, storage'].join('\\n'));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if ('${mode}' === 'none') {
    console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: None', 'Status: ❌ Not authenticated', "Run 'telnyx-edge auth login' or 'telnyx-edge auth api-key set <api_key>' to authenticate"].join('\\n'));
    process.exit(0);
  }
  if ('${mode}' === 'oauth') {
    console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: OAuth', 'Status: ✅ Authenticated'].join('\\n'));
    process.exit(0);
  }
  console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: API Key', 'Status: ✅ Authenticated'].join('\\n'));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'api-key' && args[2] === 'clear' && args.includes('--help')) {
  console.log('Remove the stored API key from the configuration');
  process.exit(0);
}
console.log('ok');
`,
  );
  chmodSync(fakeEdge, 0o755);
  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TELNYX_EDGE_PATH: fakeEdge,
    },
  };
}

function run(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    timeout: 30000,
    env: env ?? { ...process.env },
  });
}

describe("CLI — Edge Compute handoff", () => {
  it("help lists edge handoff commands", () => {
    const output = run(["help"]);
    assert.ok(output.includes("edge-doctor"));
    assert.ok(output.includes("setup-edge-mcp"));
    assert.ok(output.includes("setup-edge-webhook"));
  });

  it("capabilities JSON includes edge handoff entries", () => {
    const output = run(["capabilities", "--json"]);
    const data = JSON.parse(output);
    const category = Object.keys(data.api_capabilities || {}).find((k) => k.includes("Edge Compute"));
    assert.ok(category);
    const edgeCapabilities = data.api_capabilities[category];
    assert.ok(edgeCapabilities.some((c: any) => c.actions.includes("telnyx_edge_status")));
    assert.ok(edgeCapabilities.some((c: any) => c.actions.includes("telnyx_edge_storage_kv")));
    const commands = data.composite_commands.map((c: any) => c.name || c.command || c);
    assert.ok(commands.some((c: string) => c.includes("telnyx-edge status")));
    assert.ok(commands.some((c: string) => c.includes("telnyx-edge delete-func")));
    assert.ok(commands.some((c: string) => c.includes("edge-doctor")));
    assert.ok(commands.some((c: string) => c.includes("setup-edge-mcp")));
    assert.ok(commands.some((c: string) => c.includes("setup-edge-webhook")));
  });

  it("edge-doctor reports API-key auth support and readiness", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, true);
    assert.equal(data.telnyx_edge_installed, true);
    assert.equal(data.authenticated, true);
    assert.equal(data.auth_mode, "api_key");
    assert.equal(data.api_key_auth_supported, true);
    assert.ok(Array.isArray(data.next_steps));
    assert.ok(data.next_steps.some((s: string) => s.includes("SHARED_SECRET")));
    assert.ok(data.next_steps.some((s: string) => s.includes("bindings create")));
    assert.ok(data.next_steps.some((s: string) => s.includes("zero-arg create flow")));
    assert.ok(data.next_steps.some((s: string) => s.includes("bindings update")));
    assert.ok(data.next_steps.some((s: string) => s.includes("bindings delete")));
    assert.ok(data.next_steps.some((s: string) => s.includes("bindings validate")));
    assert.ok(data.next_steps.some((s: string) => s.includes("bindings get")));
    assert.ok(data.next_steps.some((s: string) => s.includes("storage kv key put")));
    assert.ok(data.next_steps.some((s: string) => s.includes("--ttl 30m")));
    assert.ok(data.next_steps.some((s: string) => s.includes("telnyx-edge status")));
    assert.ok(data.next_steps.some((s: string) => s.includes("revisions list")));
    assert.ok(data.next_steps.some((s: string) => s.includes("rollback")));
    assert.ok(data.next_steps.some((s: string) => s.includes("call-event-router")));
    assert.ok(data.next_steps.some((s: string) => s.includes("--language=js|ts|python|go|quarkus")));
  });

  it("edge-doctor shows unauthenticated but installable state", () => {
    const fake = withFakeEdgeCli("none");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.telnyx_edge_installed, true);
    assert.equal(data.authenticated, false);
    assert.equal(data.api_key_auth_supported, true);
    assert.ok(data.next_steps.some((s: string) => s.includes("auth api-key set")));
  });

  it("edge-doctor uses login-first guidance when telnyx-edge is not installed", () => {
    const output = run(["edge-doctor", "--json"], {
      ...process.env,
      PATH: process.env.PATH,
      TELNYX_EDGE_PATH: join(tmpdir(), "missing-telnyx-edge"),
    });
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.telnyx_edge_installed, false);
    assert.equal(data.api_key_auth_supported, false);
    assert.ok(data.next_steps.some((s: string) => s.includes("auth login")));
    assert.ok(data.next_steps.some((s: string) => s.includes("auth api-key set")));
  });

  it("setup-edge-mcp returns API-key auth handoff when unauthenticated", () => {
    const fake = withFakeEdgeCli("none");
    const output = run(["setup-edge-mcp", "--json", "--name", "demo-mcp"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.api_key_auth_supported, true);
    assert.equal(data.auth_command, "telnyx-edge auth api-key set <your-api-key>");
    assert.equal(data.example, "examples/ts/mcp-server");
    assert.ok(data.deploy_command.includes("demo-mcp"));
    assert.ok(data.scaffold_commands.some((command: string) => command.includes("--language=ts")));
    assert.ok(data.secret_commands.some((command: string) => command.includes("SHARED_SECRET")));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings create"));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings update"));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings delete"));
    assert.ok(data.validation_commands.some((command: string) => command.includes("bindings validate")));
    assert.ok(data.validation_commands.some((command: string) => command.includes("bindings get")));
    assert.ok(data.notes.some((note: string) => note.includes("--ttl 30m")));
    assert.ok(data.notes.some((note: string) => note.includes("zero-arg")));
    assert.ok(data.notes.some((note: string) => note.includes("temporary binding token")));
  });

  it("setup-edge-webhook returns concrete deploy handoff", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["setup-edge-webhook", "--json", "--name", "demo-webhook"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, true);
    assert.equal(data.auth_mode, "api_key");
    assert.equal(data.example, "examples/js/webhook-receiver");
    assert.ok(data.deploy_command.includes("demo-webhook"));
    assert.ok(data.scaffold_commands.some((command: string) => command.includes("--language=js")));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings create"));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings update"));
    assert.ok(data.validation_commands.some((command: string) => command === "telnyx-edge bindings delete"));
    assert.ok(data.validation_commands.some((command: string) => command.includes("bindings get")));
    assert.ok(data.kv_handoff_commands.some((command: string) => command.includes("storage kv key put")));
    assert.ok(data.kv_handoff_commands.some((command: string) => command.includes("--ttl 30m")));
    assert.ok(data.notes.some((note: string) => note.includes("zero-arg upstream flow")));
    assert.ok(data.notes.some((note: string) => note.includes("call-event-router")));
    assert.ok(data.notes.some((note: string) => note.includes("rollback")));
  });

  it("edge guide documents the current upstream handoff contract", () => {
    const guide = readFileSync(join(__dirname, "..", "..", "guides", "edge-compute.md"), "utf8");
    assert.ok(guide.includes("telnyx-edge auth login"));
    assert.ok(guide.includes("auth api-key set"));
    assert.ok(guide.includes("telnyx-edge status"));
    assert.ok(guide.includes("telnyx-edge bindings create"));
    assert.ok(guide.includes("zero-arg"));
    assert.ok(guide.includes("temporary binding token"));
    assert.ok(guide.includes("telnyx-edge bindings update"));
    assert.ok(guide.includes("telnyx-edge bindings delete"));
    assert.ok(guide.includes("telnyx-edge bindings validate"));
    assert.ok(guide.includes("telnyx-edge bindings get"));
    assert.ok(guide.includes("telnyx-edge revisions list"));
    assert.ok(guide.includes("telnyx-edge rollback"));
    assert.ok(guide.includes("SHARED_SECRET"));
    assert.ok(guide.includes("--language=js"));
    assert.ok(guide.includes("--language=ts"));
    assert.ok(guide.includes("telnyx-edge storage kv key put"));
    assert.ok(guide.includes("--ttl 30m"));
  });
});
