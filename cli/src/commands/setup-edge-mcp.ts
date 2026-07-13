/**
 * telnyx-agent setup-edge-mcp — Thin executable handoff for MCP-on-Edge.
 */

import { outputJson, printError, printSuccess, printWarning } from "../utils/output.ts";
import { getEdgeAuthStatus, hasEdgeCli, supportsApiKeyAuth, supportsStatefulActors } from "../edge-cli.ts";

interface SetupEdgeMcpResult {
  ready: boolean;
  authenticated: boolean;
  auth_mode: "api_key" | "oauth" | "none" | "unknown";
  api_key_auth_supported: boolean;
  stateful_actors_supported: boolean;
  example: string;
  auth_command: string;
  deploy_command: string;
  setup_commands: string[];
  prerequisites: string[];
  notes: string[];
}

const EDGE_REPO = "https://github.com/team-telnyx/edge-compute.git";
const MCP_EXAMPLE = "docs/examples/ts/mcp-server";

export async function setupEdgeMcpCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const name = (flags.name as string) || "my-mcp-server";

  const hasEdge = hasEdgeCli();
  const apiKeyAuthSupported = hasEdge ? supportsApiKeyAuth() : false;
  const statefulActorsSupported = hasEdge ? supportsStatefulActors() : false;
  const authStatus = hasEdge ? safeAuthStatus() : { authenticated: false, mode: "none" as const };
  const authCommand = apiKeyAuthSupported
    ? "telnyx-edge auth api-key set <your-api-key>"
    : "telnyx-edge auth login";
  const deployCommand = `git clone ${EDGE_REPO} && cd edge-compute && telnyx-edge new-func --from-dir=${MCP_EXAMPLE} --name=${name} && cd ${name} && telnyx-edge ship`;

  const notes = [
    "team-telnyx/ai provides the integration pattern, not the Edge lifecycle.",
    "Use telnyx-edge for auth, deploy, secrets, bindings, and lifecycle management.",
    "Set TELNYX_API_KEY and a separate SHARED_SECRET as Edge secrets before deploying; never print or commit either value.",
    "After deploy, connect the exposed MCP or HTTP boundary back into your AI workflow.",
  ];
  if (statefulActorsSupported) {
    notes.push("For stateful MCP sessions: telnyx-edge new-func --actor --language ts --name my-mcp-actor && cd my-mcp-actor && telnyx-edge types");
  }

  const result: SetupEdgeMcpResult = {
    ready: hasEdge && authStatus.authenticated,
    authenticated: authStatus.authenticated,
    auth_mode: authStatus.mode,
    api_key_auth_supported: apiKeyAuthSupported,
    stateful_actors_supported: statefulActorsSupported,
    example: MCP_EXAMPLE,
    auth_command: authCommand,
    deploy_command: deployCommand,
    setup_commands: [
      `git clone ${EDGE_REPO}`,
      "cd edge-compute",
      `telnyx-edge new-func --from-dir=${MCP_EXAMPLE} --name=${name}`,
      `cd ${name}`,
      "telnyx-edge secrets add TELNYX_API_KEY <telnyx-api-key>",
      "telnyx-edge secrets add SHARED_SECRET <independent-random-secret>",
      "telnyx-edge ship",
    ],
    prerequisites: [
      "Install telnyx-edge",
      `Authenticate with ${authCommand}`,
      `Clone the example repository: git clone ${EDGE_REPO} && cd edge-compute`,
      "Configure TELNYX_API_KEY as an Edge secret without exposing its value",
      "Configure a separate SHARED_SECRET as an Edge secret without exposing its value",
    ],
    notes,
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
  console.log("  Setup steps:");
  for (const command of result.setup_commands) console.log(`    ${command}`);
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
