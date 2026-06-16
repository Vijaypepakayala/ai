/**
 * telnyx-agent setup-edge-mcp — Thin executable handoff for MCP-on-Edge.
 */

import { outputJson, printError, printSuccess, printWarning } from "../utils/output.ts";
import { getEdgeAuthStatus, hasEdgeCli, supportsApiKeyAuth } from "../edge-cli.ts";

interface SetupEdgeMcpResult {
  ready: boolean;
  authenticated: boolean;
  auth_mode: "api_key" | "oauth" | "none" | "unknown";
  api_key_auth_supported: boolean;
  example: string;
  scaffold_commands: string[];
  auth_command: string;
  deploy_command: string;
  secret_commands: string[];
  validation_commands: string[];
  prerequisites: string[];
  notes: string[];
}

const MCP_EXAMPLE = "examples/ts/mcp-server";

export async function setupEdgeMcpCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const name = (flags.name as string) || "my-mcp-server";

  const hasEdge = hasEdgeCli();
  const apiKeyAuthSupported = hasEdge ? supportsApiKeyAuth() : false;
  const authStatus = hasEdge ? safeAuthStatus() : { authenticated: false, mode: "none" as const };
  const authCommand = apiKeyAuthSupported
    ? "telnyx-edge auth api-key set <your-api-key>"
    : "telnyx-edge auth login";
  const deployCommand = `telnyx-edge new-func --from-dir=${MCP_EXAMPLE} --name=${name} && cd ${name} && telnyx-edge ship`;

  const result: SetupEdgeMcpResult = {
    ready: hasEdge && authStatus.authenticated,
    authenticated: authStatus.authenticated,
    auth_mode: authStatus.mode,
    api_key_auth_supported: apiKeyAuthSupported,
    example: MCP_EXAMPLE,
    scaffold_commands: [
      "telnyx-edge new-func --language=js --name=<name>",
      "telnyx-edge new-func --language=ts --name=<name>",
      "telnyx-edge new-func --language=python --name=<name>",
      "telnyx-edge new-func --language=go --name=<name>",
      "telnyx-edge new-func --language=quarkus --name=<name>",
    ],
    auth_command: authCommand,
    deploy_command: deployCommand,
    secret_commands: [
      "telnyx-edge secrets add TELNYX_API_KEY <your-api-key>",
      "telnyx-edge secrets add SHARED_SECRET \"$(openssl rand -hex 32)\"",
    ],
    validation_commands: [
      "telnyx-edge auth status",
      "telnyx-edge status",
      "telnyx-edge bindings create",
      "telnyx-edge bindings update",
      "telnyx-edge bindings delete",
      "telnyx-edge bindings validate",
      "telnyx-edge bindings get",
    ],
    prerequisites: [
      "Install telnyx-edge",
      `Authenticate with ${authCommand}`,
      "Use a real Edge Compute example as the starting point",
    ],
    notes: [
      "team-telnyx/ai provides the integration pattern, not the Edge lifecycle.",
      "Use telnyx-edge for auth, status, deploy, revisions, rollback, delete, secrets, bindings, and lifecycle management.",
      "The upstream MCP example currently expects both TELNYX_API_KEY and SHARED_SECRET before telnyx-edge ship.",
      "Bindings create, update, delete, validate, and get live upstream as telnyx-edge commands; this helper only points to them.",
      "KV/storage commands live in telnyx-edge as well, including TTL-enabled writes such as telnyx-edge storage kv key put <kv-id> <key> <value> --ttl 30m, but this bridge does not wrap them directly today.",
      "After deploy, connect the exposed MCP or HTTP boundary back into your AI workflow.",
    ],
  };

  if (jsonOutput) {
    outputJson(result);
    return;
  }

  if (result.ready) {
    printSuccess("Edge MCP handoff is ready", {
      Example: MCP_EXAMPLE,
      Auth: authStatus.mode,
      Ready: "✓",
    });
  } else {
    printError(hasEdge ? "telnyx-edge is not authenticated." : "telnyx-edge is not installed.");
    printWarning(hasEdge
      ? `Authenticate first with: ${authCommand}`
      : "This command is a handoff helper — it depends on the dedicated Edge Compute CLI.");
  }

  console.log(`  Example template: ${MCP_EXAMPLE}`);
  console.log(`  Auth step: ${authCommand}`);
  console.log(`  Suggested flow: ${deployCommand}`);
  console.log("  Scaffold alternatives:");
  for (const command of result.scaffold_commands) {
    console.log(`    - ${command}`);
  }
  console.log("  Required secrets:");
  for (const command of result.secret_commands) {
    console.log(`    - ${command}`);
  }
  console.log("  Validation commands:");
  for (const command of result.validation_commands) {
    console.log(`    - ${command}`);
  }
  console.log("\n  Notes:");
  for (const note of result.notes) {
    console.log(`    - ${note}`);
  }
  console.log();
}

function safeAuthStatus(): { authenticated: boolean; mode: "api_key" | "oauth" | "none" | "unknown" } {
  try {
    const status = getEdgeAuthStatus();
    return { authenticated: status.authenticated, mode: status.mode };
  } catch {
    return { authenticated: false, mode: "unknown" };
  }
}
