/**
 * telnyx-agent setup-edge-webhook — Thin executable handoff for webhook-on-Edge.
 */

import { outputJson, printError, printSuccess, printWarning } from "../utils/output.ts";
import { getEdgeAuthStatus, hasEdgeCli, supportsApiKeyAuth, supportsStatefulActors } from "../edge-cli.ts";

interface SetupEdgeWebhookResult {
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
const WEBHOOK_EXAMPLE = "docs/examples/js/webhook-receiver";

export async function setupEdgeWebhookCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const name = (flags.name as string) || "my-webhook-receiver";

  const hasEdge = hasEdgeCli();
  const apiKeyAuthSupported = hasEdge ? supportsApiKeyAuth() : false;
  const statefulActorsSupported = hasEdge ? supportsStatefulActors() : false;
  const authStatus = hasEdge ? safeAuthStatus() : { authenticated: false, mode: "none" as const };
  const authCommand = apiKeyAuthSupported
    ? "telnyx-edge auth api-key set <your-api-key>"
    : "telnyx-edge auth login";
  const deployCommand = `git clone ${EDGE_REPO} && cd edge-compute && telnyx-edge new-func --from-dir=${WEBHOOK_EXAMPLE} --name=${name} && cd ${name} && telnyx-edge ship`;

  const notes = [
    "Use this when your AI workflow needs an HTTP ingress point at the edge.",
    "The deployed function lifecycle is still owned by telnyx-edge.",
    "Set WEBHOOK_SECRET as an Edge secret to enable HMAC verification; never print or commit its value.",
    "The example buffer is in-memory; use KV or a Stateful Actor when webhook persistence must survive restarts.",
    "After deploy, point your webhook-producing system at the Edge endpoint and let team-telnyx/ai handle orchestration guidance.",
  ];
  if (statefulActorsSupported) {
    notes.push("For actor-backed webhook state: telnyx-edge new-func --actor --language ts --name my-webhook-actor && cd my-webhook-actor && telnyx-edge types");
  }

  const result: SetupEdgeWebhookResult = {
    ready: hasEdge && authStatus.authenticated,
    authenticated: authStatus.authenticated,
    auth_mode: authStatus.mode,
    api_key_auth_supported: apiKeyAuthSupported,
    stateful_actors_supported: statefulActorsSupported,
    example: WEBHOOK_EXAMPLE,
    auth_command: authCommand,
    deploy_command: deployCommand,
    setup_commands: [
      `git clone ${EDGE_REPO}`,
      "cd edge-compute",
      `telnyx-edge new-func --from-dir=${WEBHOOK_EXAMPLE} --name=${name}`,
      `cd ${name}`,
      "telnyx-edge secrets add WEBHOOK_SECRET <webhook-signing-secret>",
      "telnyx-edge ship",
    ],
    prerequisites: [
      "Install telnyx-edge",
      `Authenticate with ${authCommand}`,
      `Clone the example repository: git clone ${EDGE_REPO} && cd edge-compute`,
      "Configure WEBHOOK_SECRET as an Edge secret without exposing its value",
    ],
    notes,
  };

  if (jsonOutput) {
    outputJson(result);
    return;
  }

  if (result.ready) {
    printSuccess("Edge webhook handoff is ready", {
      Example: WEBHOOK_EXAMPLE,
      Auth: authStatus.mode,
      Ready: "✓",
    });
  } else {
    printError(hasEdge ? "telnyx-edge is not authenticated." : "telnyx-edge is not installed.");
    printWarning(hasEdge
      ? `Authenticate first with: ${authCommand}`
      : "This command is a handoff helper — it depends on the dedicated Edge Compute CLI.");
  }

  console.log(`  Example template: ${WEBHOOK_EXAMPLE}`);
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
