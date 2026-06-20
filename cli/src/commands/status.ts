/**
 * telnyx-agent status — Account health at a glance.
 * All queries via telnyx CLI.
 */

import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { outputJson, printWarning } from "../utils/output.ts";
import { buildSetupAiCostGovernanceGuide, type SetupAiCostGovernanceGuide } from "./setup-ai.ts";

interface StatusResult {
  balance: { amount: string; currency: string; credit_limit: string };
  phone_numbers: { total: number; active: number };
  messaging_profiles: { total: number };
  connections: { total: number };
  ai_assistants: { total: number };
  cost_governance: StatusCostGovernanceGuide;
  warnings: string[];
}

export interface StatusCostGovernanceGuide {
  focus: "long_running_ai_workflows";
  summary: string;
  operator_actions: readonly string[];
  telnyx_controls: readonly string[];
  external_controls: readonly string[];
  tracking: SetupAiCostGovernanceGuide["usage_attribution"];
  boundary: string;
}

export function buildStatusCostGovernanceGuide(): StatusCostGovernanceGuide {
  const setupAiGuide = buildSetupAiCostGovernanceGuide();

  return {
    focus: "long_running_ai_workflows",
    summary: "Before widening voice-agent or assistant traffic, define a budget envelope, preserve usage IDs, and place alerts where telecom spend and model/tool spend can both stop safely.",
    operator_actions: [
      "Set a daily pilot budget and a monthly production ceiling before routing live traffic.",
      "Track spend by assistant, phone number or campaign, environment, and customer or billing group.",
      "Review unusually long calls, transfer loops, and downstream retry storms as cost incidents, not only quality incidents.",
    ],
    telnyx_controls: [
      "Check account balance before live rollout with `telnyx-agent status`.",
      "Use Telnyx billing groups, usage reports, and auto-recharge policies for account-level spend controls.",
      "Use `tools/mcp-apps/apps/usage-cost-explorer` when the operator needs a governed billing view.",
    ],
    external_controls: [
      "Apply provider-side quotas or alerts for models, vector stores, and external tools so failures stop the whole workflow cleanly.",
      "Keep alert thresholds aligned with the same pilot and monthly envelope used for telecom spend.",
    ],
    tracking: setupAiGuide.usage_attribution,
    boundary: "This guidance covers cost ownership and preflight checks. It does not replace the broader governed-execution and discovery work tracked in TEL-421, TEL-430, and TEL-482.",
  };
}

export async function statusCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;
  const costGovernance = buildStatusCostGovernanceGuide();

  const results: StatusResult = {
    balance: { amount: "0.00", currency: "USD", credit_limit: "0.00" },
    phone_numbers: { total: 0, active: 0 },
    messaging_profiles: { total: 0 },
    connections: { total: 0 },
    ai_assistants: { total: 0 },
    cost_governance: costGovernance,
    warnings: [],
  };

  // Run all queries concurrently via CLI
  const [balanceRes, numbersRes, profilesRes, connectionsRes, assistantsRes] = await Promise.allSettled([
    telnyxCli(["balance", "retrieve"]),
    telnyxCli(["phone-numbers", "list", "--page-size", "1"]),
    telnyxCli(["messaging-profiles", "list", "--page-size", "1"]),
    telnyxCli(["credential-connections", "list", "--page-size", "1"]),
    telnyxCli(["ai:assistants", "list"]),
  ]);

  // Balance
  if (balanceRes.status === "fulfilled") {
    const data = balanceRes.value.data as Record<string, unknown> | undefined;
    if (data) {
      results.balance.amount = String(data.balance ?? "0.00");
      results.balance.currency = String(data.currency ?? "USD");
      results.balance.credit_limit = String(data.credit_limit ?? "0.00");
    }
    const bal = parseFloat(results.balance.amount);
    if (bal < 5) results.warnings.push(`Low balance: $${results.balance.amount} — consider topping up`);
  } else {
    results.warnings.push(`Could not fetch balance: ${errorMsg(balanceRes.reason)}`);
  }

  // Phone numbers
  if (numbersRes.status === "fulfilled") {
    const meta = numbersRes.value.meta as Record<string, unknown> | undefined;
    results.phone_numbers.total = Number(meta?.total_results ?? 0);
    results.phone_numbers.active = results.phone_numbers.total; // Approximate
  } else {
    results.warnings.push(`Could not fetch phone numbers: ${errorMsg(numbersRes.reason)}`);
  }

  // Messaging profiles
  if (profilesRes.status === "fulfilled") {
    const meta = profilesRes.value.meta as Record<string, unknown> | undefined;
    results.messaging_profiles.total = Number(meta?.total_results ?? 0);
  } else {
    results.warnings.push(`Could not fetch messaging profiles: ${errorMsg(profilesRes.reason)}`);
  }

  // Connections
  if (connectionsRes.status === "fulfilled") {
    const meta = connectionsRes.value.meta as Record<string, unknown> | undefined;
    results.connections.total = Number(meta?.total_results ?? 0);
  } else {
    results.warnings.push(`Could not fetch connections: ${errorMsg(connectionsRes.reason)}`);
  }

  // AI Assistants
  if (assistantsRes.status === "fulfilled") {
    const meta = assistantsRes.value.meta as Record<string, unknown> | undefined;
    const data = assistantsRes.value.data as unknown[];
    results.ai_assistants.total = Number(meta?.total_results ?? data?.length ?? 0);
  } else {
    results.warnings.push(`Could not fetch AI assistants: ${errorMsg(assistantsRes.reason)}`);
  }

  if (jsonOutput) {
    outputJson(results);
    return;
  }

  // Human-readable output
  console.log("\n📊 Telnyx Account Status");
  console.log("========================\n");
  console.log(`  Balance:            $${results.balance.amount} ${results.balance.currency}`);
  console.log(`  Credit Limit:       $${results.balance.credit_limit}`);
  console.log(`  Phone Numbers:      ${results.phone_numbers.total}`);
  console.log(`  Messaging Profiles: ${results.messaging_profiles.total}`);
  console.log(`  Voice Connections:  ${results.connections.total}`);
  console.log(`  AI Assistants:      ${results.ai_assistants.total}`);
  console.log("\n  Cost governance:");
  console.log(`    Summary:          ${results.cost_governance.summary}`);
  console.log(`    Track by:         ${results.cost_governance.tracking.group_by.join(", ")}`);
  console.log(`    Preserve IDs:     ${results.cost_governance.tracking.keep_ids.join(", ")}`);
  console.log(`    Controls:         ${results.cost_governance.telnyx_controls.join(" ")}`);
  console.log(`    Boundary:         ${results.cost_governance.boundary}`);

  if (results.warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    for (const w of results.warnings) {
      printWarning(`  ${w}`);
    }
  }

  console.log();
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
