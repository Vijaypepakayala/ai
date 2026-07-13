/**
 * telnyx-agent edge-doctor — Validate local Edge Compute prerequisites.
 *
 * Thin handoff only: this does not deploy or manage Edge Compute directly.
 * It checks that the dedicated `telnyx-edge` CLI is available and whether
 * it is authenticated, preferring API-key auth for agent use.
 */

import { outputJson, printError, printSuccess, printWarning } from "../utils/output.ts";
import {
  type EdgeCapabilities,
  getEdgeAuthStatus,
  getEdgeCapabilities,
  getEdgeHelp,
  getEdgeVersion,
  supportsApiKeyAuth,
} from "../edge-cli.ts";

interface EdgeDoctorResult extends EdgeCapabilities {
  ready: boolean;
  telnyx_edge_installed: boolean;
  telnyx_edge_version: string | null;
  authenticated: boolean;
  auth_mode: "api_key" | "oauth" | "none" | "unknown";
  api_key_auth_supported: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  next_steps: string[];
}

const NO_CAPABILITIES: EdgeCapabilities = {
  reset_func_supported: false,
  types_supported: false,
  storage_kv_supported: false,
  revisions_supported: false,
  rollback_supported: false,
  inspect_supported: false,
  bindings_supported: false,
  secrets_supported: false,
  cloud_storage_supported: false,
  stateful_actors_supported: false,
};

export async function edgeDoctorCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;

  const checks: EdgeDoctorResult["checks"] = [];
  let installed = false;
  let version: string | null = null;
  let authenticated = false;
  let authMode: EdgeDoctorResult["auth_mode"] = "none";
  let apiKeyAuthSupported = false;
  let capabilities = { ...NO_CAPABILITIES };

  try {
    const rootHelp = getEdgeHelp();
    installed = true;
    version = getEdgeVersion(rootHelp);
    checks.push({
      name: "telnyx-edge installed",
      ok: true,
      detail: version ?? "installed (version unknown)",
    });
  } catch (err: any) {
    const detail = err?.code === "ENOENT"
      ? "telnyx-edge not found on PATH"
      : (err?.stderr?.toString?.() || err?.message || "failed to execute telnyx-edge");
    checks.push({ name: "telnyx-edge installed", ok: false, detail });
  }

  if (installed) {
    apiKeyAuthSupported = supportsApiKeyAuth();
    checks.push({
      name: "API-key auth supported",
      ok: apiKeyAuthSupported,
      detail: apiKeyAuthSupported ? "auth api-key set help succeeded" : "auth api-key set help failed",
    });

    capabilities = getEdgeCapabilities();
    addCapabilityChecks(checks, capabilities);

    try {
      const status = getEdgeAuthStatus();
      authenticated = status.authenticated;
      authMode = status.mode;
      checks.push({
        name: "Authenticated",
        ok: authenticated,
        detail: authenticated ? `mode: ${authMode}` : "not authenticated",
      });
    } catch (err: any) {
      checks.push({
        name: "Authenticated",
        ok: false,
        detail: err?.stderr?.toString?.() || err?.message || "failed to read auth status",
      });
    }
  }

  const ready = installed && authenticated;

  let nextSteps: string[];
  if (!installed) {
    nextSteps = [
      "Install the dedicated Edge Compute CLI from team-telnyx/edge-compute releases.",
      "Then authenticate: telnyx-edge auth api-key set <your-api-key> (preferred) or telnyx-edge auth login",
      "Clone the examples: git clone https://github.com/team-telnyx/edge-compute.git && cd edge-compute",
    ];
  } else if (!authenticated) {
    nextSteps = apiKeyAuthSupported
      ? [
          "Authenticate non-interactively: telnyx-edge auth api-key set <your-api-key>",
          "Verify with: telnyx-edge auth status",
          "Then clone https://github.com/team-telnyx/edge-compute.git and use an example under docs/examples/.",
        ]
      : [
          "Authenticate with: telnyx-edge auth login",
          "Verify with: telnyx-edge auth status",
          "Then clone https://github.com/team-telnyx/edge-compute.git and use an example under docs/examples/.",
        ];
  } else {
    nextSteps = [
      "Clone examples: git clone https://github.com/team-telnyx/edge-compute.git && cd edge-compute",
      "Scaffold: telnyx-edge new-func --from-dir=docs/examples/ts/mcp-server --name=my-mcp-server",
      "Deploy: cd my-mcp-server && telnyx-edge ship",
      "Then connect the exposed HTTP or MCP boundary back into your AI workflow.",
    ];
    if (capabilities.stateful_actors_supported) {
      nextSteps.push("For stateful workloads: telnyx-edge new-func --actor --language ts --name my-actor && cd my-actor && telnyx-edge types");
    }
    if (capabilities.inspect_supported) {
      nextSteps.push("Inspect a deployment (feature-detected): telnyx-edge inspect <function-name>");
    }
    if (capabilities.cloud_storage_supported) {
      nextSteps.push("Cloud Storage TOML/type support was feature-detected; consult the installed CLI help before using it.");
    }
  }

  const result: EdgeDoctorResult = {
    ready,
    telnyx_edge_installed: installed,
    telnyx_edge_version: version,
    authenticated,
    auth_mode: authMode,
    api_key_auth_supported: apiKeyAuthSupported,
    ...capabilities,
    checks,
    next_steps: nextSteps,
  };

  if (jsonOutput) {
    outputJson(result);
    return;
  }

  if (ready) {
    printSuccess("Edge Compute handoff is ready", {
      "telnyx-edge": version ?? "installed (version unknown)",
      Auth: authMode,
      Ready: "✓",
    });
  } else {
    printError("Edge Compute handoff is not ready yet.");
    if (!installed) {
      printWarning("Install telnyx-edge first — team-telnyx/ai does not own Edge lifecycle directly.");
    } else if (!authenticated) {
      printWarning(apiKeyAuthSupported
        ? "telnyx-edge is installed but not authenticated. Prefer API-key auth for agents."
        : "telnyx-edge is installed but not authenticated.");
    }
  }

  console.log("  Checks:");
  for (const check of checks) {
    console.log(`    ${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }
  console.log("\n  Next steps:");
  for (const step of nextSteps) {
    console.log(`    - ${step}`);
  }
  console.log();
}

function addCapabilityChecks(
  checks: EdgeDoctorResult["checks"],
  capabilities: EdgeCapabilities,
): void {
  const detected: Array<[keyof EdgeCapabilities, string, string]> = [
    ["reset_func_supported", "reset-func", "reset-func --help"],
    ["types_supported", "TypeScript binding types", "types --help"],
    ["storage_kv_supported", "KV storage/key operations", "storage kv --help"],
    ["revisions_supported", "revisions", "revisions --help"],
    ["rollback_supported", "rollback", "rollback --help"],
    ["inspect_supported", "inspect (feature-detected)", "inspect --help"],
    ["bindings_supported", "bindings", "bindings --help"],
    ["secrets_supported", "secrets", "secrets --help"],
    ["cloud_storage_supported", "Cloud Storage bindings (feature-detected)", "types help advertises Cloud Storage"],
    ["stateful_actors_supported", "Stateful actors", "new-func help advertises --actor"],
  ];

  for (const [key, name, probe] of detected) {
    checks.push({
      name,
      ok: capabilities[key],
      detail: capabilities[key] ? `${probe} succeeded` : `${probe} not detected`,
    });
  }
}
