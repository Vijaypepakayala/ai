/**
 * telnyx-agent edge-doctor — Validate local Edge Compute prerequisites.
 *
 * Thin handoff only: this does not deploy or manage Edge Compute directly.
 * It checks that the dedicated `telnyx-edge` CLI is available and whether
 * it is authenticated, preferring API-key auth for agent use.
 */

import { outputJson, printError, printSuccess, printWarning } from "../utils/output.ts";
import { getEdgeAuthStatus, getEdgeHelp, hasEdgeCli, supportsApiKeyAuth } from "../edge-cli.ts";

interface EdgeDoctorResult {
  ready: boolean;
  telnyx_edge_installed: boolean;
  telnyx_edge_version: string | null;
  authenticated: boolean;
  auth_mode: "api_key" | "oauth" | "none" | "unknown";
  api_key_auth_supported: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  next_steps: string[];
}

export async function edgeDoctorCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;

  const checks: EdgeDoctorResult["checks"] = [];
  let installed = false;
  let version: string | null = null;
  let authenticated = false;
  let authMode: EdgeDoctorResult["auth_mode"] = "none";
  let apiKeyAuthSupported = false;

  try {
    const out = getEdgeHelp();
    installed = hasEdgeCli();
    version = extractVersion(out) ?? "installed";
    checks.push({ name: "telnyx-edge installed", ok: true, detail: version });
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
      detail: apiKeyAuthSupported ? "auth api-key set is available" : "no auth api-key set support detected",
    });

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
      "Then authenticate with the upstream-documented flow: telnyx-edge auth login",
      "If your installed telnyx-edge build exposes auth api-key set, agents can use that non-interactive path instead.",
      "Then start from a real example such as examples/ts/mcp-server, examples/ts/call-event-router, or examples/js/webhook-receiver.",
    ];
  } else if (!authenticated) {
    nextSteps = apiKeyAuthSupported
      ? [
          "Authenticate non-interactively: telnyx-edge auth api-key set <your-api-key>",
          "Verify with: telnyx-edge auth status",
          "Check CLI and connectivity with: telnyx-edge status",
          "Then start from a real example and deploy with telnyx-edge ship.",
        ]
      : [
          "Authenticate with: telnyx-edge auth login",
          "Verify with: telnyx-edge auth status",
          "Check CLI and connectivity with: telnyx-edge status",
          "Then start from a real example and deploy with telnyx-edge ship.",
        ];
  } else {
    nextSteps = [
      "Start from a real example: telnyx-edge new-func --from-dir=examples/ts/mcp-server --name=my-mcp-server",
      "Or scaffold directly with the upstream language templates: telnyx-edge new-func --language=js|ts|python|go|quarkus --name=<name>",
      "For the MCP example, add both TELNYX_API_KEY and SHARED_SECRET before shipping.",
      "Typed webhook/event routing starts well from: telnyx-edge new-func --from-dir=examples/ts/call-event-router --name=my-call-event-router",
      "Manage your Telnyx API binding with the zero-arg create flow: telnyx-edge bindings create, then telnyx-edge bindings update, telnyx-edge bindings delete, telnyx-edge bindings validate, and telnyx-edge bindings get",
      "Deploy with: telnyx-edge ship",
      "Provision KV resources directly in telnyx-edge when needed: telnyx-edge storage kv create --name <name> and telnyx-edge storage kv key put <kv-id> <key> <value> --ttl 30m",
      "Inspect or clean up lifecycle with: telnyx-edge list, telnyx-edge status, telnyx-edge revisions list <name>, telnyx-edge rollback <name> <revision-id>, or telnyx-edge delete-func <name>",
      "Then connect the exposed HTTP or MCP boundary back into your AI workflow.",
    ];
  }

  const result: EdgeDoctorResult = {
    ready,
    telnyx_edge_installed: installed,
    telnyx_edge_version: version,
    authenticated,
    auth_mode: authMode,
    api_key_auth_supported: apiKeyAuthSupported,
    checks,
    next_steps: nextSteps,
  };

  if (jsonOutput) {
    outputJson(result);
    return;
  }

  if (ready) {
    printSuccess("Edge Compute handoff is ready", {
      "telnyx-edge": version ?? "installed",
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

function extractVersion(text: string): string | null {
  const match = text.match(/v?\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}
