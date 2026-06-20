/**
 * telnyx-agent setup-ai — Zero to AI assistant on a phone number.
 *
 * Steps:
 * 1. Create an AI assistant (via telnyx CLI)
 * 2. Search for a phone number (via telnyx CLI)
 * 3. Buy the number (via telnyx CLI)
 * 4. Wire assistant to the number (direct API — TeXML app creation has no CLI equivalent)
 */

import { TelnyxClient, TelnyxAPIError } from "../client.ts";
import { telnyxCli, TelnyxCLIError } from "../telnyx-cli.ts";
import { printStep, printSuccess, printError, outputJson, type StepResult } from "../utils/output.ts";
import { searchAndBuyNumber } from "../utils/number-order.ts";

export type SetupAiPresetId =
  | "appointment-reminders"
  | "support-handoff"
  | "lead-recovery";

export interface SetupAiPreset {
  id: SetupAiPresetId;
  name: string;
  summary: string;
  instructions: string;
}

type InstructionsSource = "default" | "preset" | "custom";

export interface SetupAiCostGovernanceGuide {
  scope: "guidance_only";
  budget_envelope: {
    recommendation: string;
    initial_alert_thresholds: readonly string[];
  };
  usage_attribution: {
    keep_ids: readonly string[];
    group_by: readonly string[];
  };
  runtime_guardrails: readonly string[];
  spend_controls: readonly string[];
  distinction_from_broader_governance: string;
}

const SETUP_AI_PRESETS: Record<SetupAiPresetId, SetupAiPreset> = {
  "appointment-reminders": {
    id: "appointment-reminders",
    name: "Appointment Scheduling and Reminders",
    summary: "Books appointments, confirms details, and sends reminder-friendly follow-up prompts.",
    instructions: "You are a voice scheduling assistant for a business. Greet the caller, identify whether they want to book, reschedule, or confirm an appointment, and collect the minimum required details: full name, callback number, requested service, preferred date, preferred time, and any urgency notes. Repeat critical details back for confirmation before ending the call. If the caller asks for something outside scheduling, answer briefly when you can and otherwise offer to route the request to a human teammate. Keep answers concise, read times clearly, and end each successful call with a crisp summary of the agreed next step.",
  },
  "support-handoff": {
    id: "support-handoff",
    name: "Support FAQ with Human Handoff",
    summary: "Deflects common support questions first, then escalates cleanly when confidence is low or the caller asks for a person.",
    instructions: "You are a frontline support voice agent. Start by understanding the caller's problem in one sentence, then try to resolve common FAQ and account-support requests with direct, concise answers. If the caller asks for a human, sounds frustrated, mentions billing disputes, outages, cancellations, legal issues, or anything sensitive, stop troubleshooting and explain that a human support specialist will take over. Before handoff, capture the caller's name, callback number, account or company name if offered, and a short issue summary. Never invent policies, prices, or troubleshooting steps. If you are uncertain, say so clearly and escalate.",
  },
  "lead-recovery": {
    id: "lead-recovery",
    name: "Lead Qualification and Missed-Call Recovery",
    summary: "Handles inbound lead capture or missed-call callbacks, qualifies interest, and prepares a clean sales handoff.",
    instructions: "You are a sales development voice assistant following up on new leads and missed inbound calls. Open by explaining that you are calling back to help quickly, then qualify the lead by capturing name, company, callback number, use case, team size or expected call volume if relevant, timeline, and whether they want a live follow-up. Ask one question at a time and keep the pace brisk. If the caller is ready to buy, requests pricing specifics you do not know, or asks for a human conversation, confirm the best contact details and say a sales teammate will follow up. End with a concise recap of the lead details and next action.",
  },
};

interface SetupAiResult {
  assistant_id: string;
  assistant_name: string;
  phone_number: string;
  phone_number_id: string;
  test_command: string;
  preset_id: SetupAiPresetId | null;
  preset_name: string | null;
  instructions_source: InstructionsSource;
  cost_governance: SetupAiCostGovernanceGuide;
  ready: boolean;
  steps: StepResult[];
}

export function listSetupAiPresets(): SetupAiPreset[] {
  return Object.values(SETUP_AI_PRESETS);
}

export function resolveSetupAiInstructions(
  flags: Record<string, string | boolean>,
): { instructions: string; preset: SetupAiPreset | null; source: InstructionsSource } {
  const presetId = typeof flags.preset === "string" ? flags.preset : "";
  const customInstructions = typeof flags.instructions === "string" ? flags.instructions.trim() : "";

  if (presetId) {
    const preset = SETUP_AI_PRESETS[presetId as SetupAiPresetId];
    if (!preset) {
      const supported = listSetupAiPresets().map((item) => item.id).join(", ");
      throw new Error(`Unknown setup-ai preset "${presetId}". Supported presets: ${supported}`);
    }

    if (customInstructions) {
      return { instructions: customInstructions, preset, source: "custom" };
    }

    return { instructions: preset.instructions, preset, source: "preset" };
  }

  if (customInstructions) {
    return { instructions: customInstructions, preset: null, source: "custom" };
  }

  return {
    instructions: "You are a helpful assistant.",
    preset: null,
    source: "default",
  };
}

export function buildSetupAiCostGovernanceGuide(): SetupAiCostGovernanceGuide {
  return {
    scope: "guidance_only",
    budget_envelope: {
      recommendation: "Set a daily and monthly spend envelope before promoting the assistant beyond a single test number. Cover model inference, voice minutes, transcription, synthesis, and any external tools or webhooks the assistant can trigger.",
      initial_alert_thresholds: [
        "50% of the daily or weekly pilot budget",
        "80% of the monthly assistant budget",
        "100% of the approved budget envelope",
      ],
    },
    usage_attribution: {
      keep_ids: [
        "assistant_id",
        "phone_number",
        "call_control_id",
        "call_session_id",
        "conversation_id",
        "request_id",
      ],
      group_by: [
        "assistant or workflow name",
        "phone number or campaign",
        "environment",
        "customer or billing group",
      ],
    },
    runtime_guardrails: [
      "Alert on unusually long calls, repeated transfer loops, or retry storms from downstream tools.",
      "Keep a human escalation path for billing disputes, outages, cancellations, and any workflow that can prolong the call without resolving the request.",
      "Review prompt and tool changes as cost changes, not only behavior changes, before widening traffic.",
    ],
    spend_controls: [
      "Use Telnyx billing groups, usage reports, balance checks, and auto-recharge policies as the account-level controls.",
      "If you run external models or tools, place provider-side quotas or alerts there too so telecom spend and model spend fail closed together.",
      "Treat `tools/mcp-apps/apps/usage-cost-explorer` as the repo-owned billing control surface; this command only emits preflight guidance.",
    ],
    distinction_from_broader_governance: "This setup-ai guidance is a lightweight preflight for assistant cost ownership. It does not replace the broader governed-execution and discovery work tracked separately in TEL-421, TEL-430, and TEL-482.",
  };
}

export async function setupAiCommand(flags: Record<string, string | boolean>): Promise<void> {
  const client = new TelnyxClient();
  const jsonOutput = flags.json === true;
  const country = (flags.country as string) || "US";
  const { instructions, preset, source: instructionsSource } = resolveSetupAiInstructions(flags);
  const costGovernance = buildSetupAiCostGovernanceGuide();
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const assistantName = (flags.name as string) || `${preset?.name ?? "Agent AI Assistant"} - ${ts}`;
  const totalSteps = 4;
  const steps: StepResult[] = [];
  const startTime = Date.now();

  let assistantId = "";
  let phoneNumber = "";
  let phoneNumberId = "";

  try {
    if (!jsonOutput) console.log("\n🚀 Setting up AI Assistant...\n");

    // Step 1: Create AI assistant via CLI
    const step1Start = Date.now();
    try {
      const assistantRes = await telnyxCli([
        "ai:assistants", "create",
        "--name", assistantName,
        "--instructions", instructions,
        "--model", "Qwen/Qwen3-235B-A22B",
      ]);
      // AI assistants API returns data at the top level or nested under .data
      const assistantData = (assistantRes.data ?? assistantRes) as Record<string, unknown>;
      assistantId = String(assistantData.id);
      steps.push({ step: 1, name: "Create AI assistant", status: "completed", resourceId: assistantId, detail: assistantName, elapsedMs: Date.now() - step1Start });
    } catch (err) {
      steps.push({ step: 1, name: "Create AI assistant", status: "failed", detail: errorMsg(err), elapsedMs: Date.now() - step1Start });
      throw err;
    }
    if (!jsonOutput) printStep(steps[steps.length - 1], totalSteps);

    // Steps 2+3: Search and buy number via CLI (handles 409 retries automatically)
    const step2Start = Date.now();
    try {
      const result = await searchAndBuyNumber(country, {
        features: "voice",
        type: "local",
      });
      phoneNumber = result.phoneNumber;
      phoneNumberId = result.phoneNumberId;
      steps.push({ step: 2, name: "Search for number", status: "completed", detail: phoneNumber, elapsedMs: Date.now() - step2Start });
      steps.push({ step: 3, name: "Buy number", status: "completed", resourceId: phoneNumberId, detail: phoneNumber, elapsedMs: 0 });
    } catch (err) {
      steps.push({ step: 2, name: "Search & buy number", status: "failed", detail: errorMsg(err), elapsedMs: Date.now() - step2Start });
      throw err;
    }
    if (!jsonOutput) {
      printStep(steps[steps.length - 2], totalSteps);
      printStep(steps[steps.length - 1], totalSteps);
    }

    // Step 4: Wire assistant to the number (direct API — no CLI equivalent for TeXML apps)
    const step4Start = Date.now();
    try {
      // Create a TeXML app that routes to the AI assistant
      const texmlRes = await client.post("/texml_applications", {
        friendly_name: `AI - ${ts}`,
        active: true,
        ai_assistant_id: assistantId,
        voice_url: `https://api.telnyx.com/v2/ai/assistants/${assistantId}/call`,
        voice_method: "POST",
      });
      const texmlData = texmlRes.data as Record<string, unknown>;
      const texmlAppId = String(texmlData.id ?? "");

      // Assign the TeXML app to the phone number via CLI
      if (phoneNumber && texmlAppId) {
        await telnyxCli([
          "phone-numbers", "update",
          "--phone-number-id", phoneNumber,
          "--connection-id", texmlAppId,
          "--force",
        ]);
      }
      steps.push({ step: 4, name: "Wire assistant to number", status: "completed", detail: `TeXML app: ${texmlAppId}`, elapsedMs: Date.now() - step4Start });
    } catch (err) {
      steps.push({ step: 4, name: "Wire assistant to number", status: "failed", detail: errorMsg(err), elapsedMs: Date.now() - step4Start });
      throw err;
    }
    if (!jsonOutput) printStep(steps[steps.length - 1], totalSteps);

    const testCmd = `Call ${phoneNumber} to talk to your AI assistant`;
    const result: SetupAiResult = {
      assistant_id: assistantId,
      assistant_name: assistantName,
      phone_number: phoneNumber,
      phone_number_id: phoneNumberId,
      test_command: testCmd,
      preset_id: preset?.id ?? null,
      preset_name: preset?.name ?? null,
      instructions_source: instructionsSource,
      cost_governance: costGovernance,
      ready: true,
      steps,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      printSuccess("AI Assistant setup complete!", {
        "Assistant ID": assistantId,
        "Assistant Name": assistantName,
        "Preset": preset?.name ?? "Custom / default",
        "Instructions Source": instructionsSource,
        "Phone Number": phoneNumber,
        "Test": testCmd,
        Ready: "✓",
      });
      printSetupAiCostGovernance(costGovernance);
    }
  } catch (err) {
    const result = {
      status: "failed",
      assistant_id: assistantId || null,
      phone_number: phoneNumber || null,
      ready: false,
      steps,
      error: errorMsg(err),
      elapsed_ms: Date.now() - startTime,
    };

    if (jsonOutput) {
      outputJson(result);
    } else {
      printError(errorMsg(err));
      console.log("  Steps completed before failure:");
      for (const s of steps) printStep(s, totalSteps);
      console.log();
    }
    process.exit(1);
  }
}

function printSetupAiCostGovernance(guide: SetupAiCostGovernanceGuide): void {
  console.log("Cost governance preflight");
  console.log(`  Scope                  ${guide.scope}`);
  console.log(`  Budget envelope        ${guide.budget_envelope.recommendation}`);
  console.log(`  Alert thresholds       ${guide.budget_envelope.initial_alert_thresholds.join("; ")}`);
  console.log(`  Usage attribution      Keep ${guide.usage_attribution.keep_ids.join(", ")} and group by ${guide.usage_attribution.group_by.join(", ")}`);
  console.log(`  Runtime guardrails     ${guide.runtime_guardrails.join(" ")}`);
  console.log(`  Spend controls         ${guide.spend_controls.join(" ")}`);
  console.log(`  Boundary               ${guide.distinction_from_broader_governance}`);
  console.log();
}

function errorMsg(err: unknown): string {
  if (err instanceof TelnyxAPIError) return `${err.detail} (HTTP ${err.statusCode})`;
  if (err instanceof TelnyxCLIError) return err.stderr || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
