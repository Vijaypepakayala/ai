import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "telnyx-agent.ts");

function withFakeEdgeCli(
  mode: "none" | "oauth" | "api_key" | "expired_oauth" = "api_key",
  release: "v0.2.3" | "current-main" = "v0.2.3",
) {
  const tempDir = mkdtempSync(join(tmpdir(), "telnyx-edge-fake-"));
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const fakeEdge = join(binDir, "telnyx-edge");
  const logFile = join(tempDir, "calls.jsonl");
  writeFileSync(
    fakeEdge,
    `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.EDGE_FAKE_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--version')) {
  console.log('telnyx-edge v0.2.3');
  process.exit(0);
}
if (args[0] === 'new-func' && args.includes('--help')) {
  console.log(['Create a new edge computing function', '', 'Flags:', '      --actor             Scaffold a StatefulActor (telnyx.toml) project — TypeScript only', '      --from-dir string   Copy files from existing directory', '  -h, --help              help for new-func', '  -l, --language string   Language runtime (go, js, ts, python, quarkus)', '  -n, --name string       Name of the function to create'].join('\\n'));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'api-key' && args[2] === 'set' && args.includes('--help')) {
  console.log('credential setup help in a non-English or future wording');
  process.exit(0);
}
if (args.length === 1 && args[0] === '--help') {
  console.log(['Telnyx Edge CLI v0.2.3', '', 'Available Commands:', '  actors', '  auth', '  bindings', '  reset-func', '  revisions', '  rollback', '  secrets', '  storage', '  types'].join('\\n'));
  process.exit(0);
}
const helpPath = args.slice(0, -1).join(' ');
if (args.at(-1) === '--help' && ['reset-func', 'storage kv', 'revisions', 'rollback', 'bindings', 'secrets'].includes(helpPath)) {
  console.log('help for ' + helpPath);
  process.exit(0);
}
if (args.at(-1) === '--help' && helpPath === 'types') {
  // The v0.2.4/current-main implementation supports Cloud Storage even though
  // its help text may still list only KV, so the doctor must behavior-probe it.
  console.log('Generate binding types for [storage.kv.NAME]');
  process.exit(0);
}
if (args.at(-1) === '--help' && helpPath === 'inspect') {
  console.log('Inspect a deployed function');
  process.exit(0);
}
if (args[0] === 'types' && args[1] === '--from-dir') {
  writeFileSync(
    join(args[2], 'telnyx-env.d.ts'),
    '${release}' === 'current-main'
      ? 'interface Env { EDGE_DOCTOR_PROBE: CloudStorageBucket }'
      : 'interface Env {}',
  );
  console.log('generated types');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if ('${mode}' === 'none') {
    console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: None', 'Status: ❌ Not authenticated', "Run 'telnyx-edge auth login' or 'telnyx-edge auth api-key set <api_key>' to authenticate"].join('\\n'));
    process.exit(0);
  }
  if ('${mode}' === 'expired_oauth') {
    console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: OAuth 2.0', 'Token Type: Bearer', 'Scopes: admin', 'Expires: 2026-06-22 18:35:42 IST', 'Status: ⚠️ Token expired - run telnyx-edge auth login to refresh'].join('\\n'));
    process.exit(0);
  }
  if ('${mode}' === 'oauth') {
    console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: OAuth 2.0', 'Token Type: Bearer', 'Scopes: admin', 'Expires: 2026-07-06 12:11:42 IST', 'Status: ✅ Authenticated'].join('\\n'));
    process.exit(0);
  }
  console.log(['API Endpoint: https://api.telnyx.com', '', 'Authentication Status: API Key', 'Status: ✅ Authenticated'].join('\\n'));
  process.exit(0);
}
console.error('unsupported fake command: ' + JSON.stringify(args));
process.exit(2);
`,
  );
  chmodSync(fakeEdge, 0o755);
  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TELNYX_EDGE_PATH: fakeEdge,
      EDGE_FAKE_LOG: logFile,
    },
    logFile,
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
    const commands = data.composite_commands.map((c: any) => c.name || c.command || c);
    assert.ok(commands.some((c: string) => c.includes("edge-doctor")));
    assert.ok(commands.some((c: string) => c.includes("setup-edge-mcp")));
    assert.ok(commands.some((c: string) => c.includes("setup-edge-webhook")));
  });

  it("capabilities JSON includes stateful actors entry", () => {
    const output = run(["capabilities", "--json"]);
    const data = JSON.parse(output);
    const category = Object.keys(data.api_capabilities || {}).find((k) => k.includes("Edge Compute"));
    assert.ok(category);
    const caps = data.api_capabilities[category] as Array<{ name: string; description: string }>;
    const actorCap = caps.find((c) => c.name === "Stateful Actors");
    assert.ok(actorCap, "Stateful Actors capability should be listed");
    assert.ok(actorCap!.description.toLowerCase().includes("per-entity"));
  });

  it("edge-doctor reports API-key auth support, capabilities, and readiness", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, true);
    assert.equal(data.telnyx_edge_installed, true);
    assert.equal(data.authenticated, true);
    assert.equal(data.auth_mode, "api_key");
    assert.equal(data.api_key_auth_supported, true);
    assert.equal(data.stateful_actors_supported, true);
    assert.equal(data.reset_func_supported, true);
    assert.equal(data.types_supported, true);
    assert.equal(data.storage_kv_supported, true);
    assert.equal(data.revisions_supported, true);
    assert.equal(data.rollback_supported, true);
    assert.equal(data.bindings_supported, true);
    assert.equal(data.secrets_supported, true);
    assert.equal(data.inspect_supported, true);
    assert.equal(data.cloud_storage_supported, false);
    assert.ok(Array.isArray(data.next_steps));

    const rawLog = readFileSync(fake.logFile, "utf8");
    assert.ok(rawLog.endsWith("\n"), "fake CLI log must be newline-terminated JSONL");
    const calls = rawLog.trimEnd().split("\n").map((line) => JSON.parse(line) as string[]);
    assert.equal(
      calls.filter((args) => args.length === 1 && args[0] === "--help").length,
      1,
      "edge-doctor should not duplicate the install/root-help probe",
    );
  });

  it("edge-doctor feature-detects current-main inspect and Cloud Storage", () => {
    const fake = withFakeEdgeCli("api_key", "current-main");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.inspect_supported, true);
    assert.equal(data.cloud_storage_supported, true);
    assert.ok(data.next_steps.some((s: string) => s.includes("inspect")));
    assert.ok(data.next_steps.some((s: string) => s.includes("Cloud Storage")));
  });

  it("edge-doctor shows unauthenticated but installable state", () => {
    const fake = withFakeEdgeCli("none");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.telnyx_edge_installed, true);
    assert.equal(data.authenticated, false);
    assert.equal(data.api_key_auth_supported, true);
    assert.equal(data.stateful_actors_supported, true);
    assert.ok(data.next_steps.some((s: string) => s.includes("auth api-key set")));
  });

  it("edge-doctor detects expired OAuth token as not authenticated", () => {
    const fake = withFakeEdgeCli("expired_oauth");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.telnyx_edge_installed, true);
    assert.equal(data.authenticated, false, "expired token should not be authenticated");
    assert.equal(data.auth_mode, "oauth");
    assert.equal(data.stateful_actors_supported, true);
  });

  it("edge-doctor suggests a complete stateful actor flow when supported", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["edge-doctor", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, true);
    assert.ok(
      data.next_steps.some((s: string) => s.includes("--actor") && s.includes("--name") && s.includes("types")),
      "next_steps should provide a named actor scaffold and type-generation command",
    );
  });

  it("setup-edge-mcp returns API-key auth handoff when unauthenticated", () => {
    const fake = withFakeEdgeCli("none");
    const output = run(["setup-edge-mcp", "--json", "--name", "demo-mcp"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, false);
    assert.equal(data.api_key_auth_supported, true);
    assert.equal(data.stateful_actors_supported, true);
    assert.equal(data.auth_command, "telnyx-edge auth api-key set <your-api-key>");
    assert.equal(data.example, "docs/examples/ts/mcp-server");
    assert.ok(data.deploy_command.includes("git clone https://github.com/team-telnyx/edge-compute.git"));
    assert.ok(data.deploy_command.includes("cd edge-compute"));
    assert.ok(data.deploy_command.includes("demo-mcp"));
    assert.ok(data.prerequisites.some((p: string) => p.includes("TELNYX_API_KEY")));
    assert.ok(data.prerequisites.some((p: string) => p.includes("SHARED_SECRET")));
    assert.ok(data.setup_commands.some((s: string) => s.includes("secrets add TELNYX_API_KEY")));
    assert.ok(data.setup_commands.some((s: string) => s.includes("secrets add SHARED_SECRET")));
    assert.equal(data.setup_commands.at(-1), "telnyx-edge ship");
  });

  it("setup-edge-webhook returns concrete deploy handoff", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["setup-edge-webhook", "--json", "--name", "demo-webhook"], fake.env);
    const data = JSON.parse(output);
    assert.equal(data.ready, true);
    assert.equal(data.auth_mode, "api_key");
    assert.equal(data.stateful_actors_supported, true);
    assert.equal(data.example, "docs/examples/js/webhook-receiver");
    assert.ok(data.deploy_command.includes("git clone https://github.com/team-telnyx/edge-compute.git"));
    assert.ok(data.deploy_command.includes("cd edge-compute"));
    assert.ok(data.deploy_command.includes("demo-webhook"));
    assert.ok(data.prerequisites.some((p: string) => p.includes("WEBHOOK_SECRET")));
    assert.ok(data.setup_commands.some((s: string) => s.includes("secrets add WEBHOOK_SECRET")));
    assert.equal(data.setup_commands.at(-1), "telnyx-edge ship");
    assert.ok(data.notes.some((n: string) => n.includes("KV") && n.includes("Stateful Actor")));
  });

  it("setup-edge-mcp notes mention stateful actors when supported", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["setup-edge-mcp", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.ok(
      data.notes.some((n: string) => n.includes("--actor") && n.includes("--name") && n.includes("types")),
      "notes should provide a named actor scaffold and type-generation command",
    );
  });

  it("setup-edge-webhook notes mention stateful actors when supported", () => {
    const fake = withFakeEdgeCli("api_key");
    const output = run(["setup-edge-webhook", "--json"], fake.env);
    const data = JSON.parse(output);
    assert.ok(
      data.notes.some((n: string) => n.includes("--actor") && n.includes("--name") && n.includes("types")),
      "notes should provide a named actor scaffold and type-generation command",
    );
  });
});
