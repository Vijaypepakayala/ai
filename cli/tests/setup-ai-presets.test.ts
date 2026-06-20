import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSetupAiCostGovernanceGuide,
  listSetupAiPresets,
  resolveSetupAiInstructions,
} from "../src/commands/setup-ai.ts";
import { buildStatusCostGovernanceGuide } from "../src/commands/status.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "telnyx-agent.ts");

describe("setup-ai presets", () => {
  it("lists the supported starter presets", () => {
    const presets = listSetupAiPresets();
    assert.deepEqual(
      presets.map((preset) => preset.id),
      ["appointment-reminders", "support-handoff", "lead-recovery"],
    );
  });

  it("resolves preset-backed instructions", () => {
    const resolved = resolveSetupAiInstructions({ preset: "support-handoff" });
    assert.equal(resolved.source, "preset");
    assert.equal(resolved.preset?.id, "support-handoff");
    assert.match(resolved.instructions, /human support specialist/i);
  });

  it("lets explicit instructions override the preset text", () => {
    const resolved = resolveSetupAiInstructions({
      preset: "lead-recovery",
      instructions: "You are a custom callback bot.",
    });
    assert.equal(resolved.source, "custom");
    assert.equal(resolved.preset?.id, "lead-recovery");
    assert.equal(resolved.instructions, "You are a custom callback bot.");
  });

  it("throws for an unknown preset", () => {
    assert.throws(
      () => resolveSetupAiInstructions({ preset: "not-real" }),
      /Unknown setup-ai preset/,
    );
  });

  it("returns a structured cost-governance preflight", () => {
    const guide = buildSetupAiCostGovernanceGuide();

    assert.equal(guide.scope, "guidance_only");
    assert.deepEqual(guide.budget_envelope.initial_alert_thresholds, [
      "50% of the daily or weekly pilot budget",
      "80% of the monthly assistant budget",
      "100% of the approved budget envelope",
    ]);
    assert.ok(guide.usage_attribution.keep_ids.includes("assistant_id"));
    assert.ok(guide.usage_attribution.keep_ids.includes("conversation_id"));
    assert.ok(guide.spend_controls.some((item) => item.includes("usage-cost-explorer")));
    assert.match(guide.distinction_from_broader_governance, /TEL-421/);
  });

  it("returns a status cost-governance summary for long-running AI workflows", () => {
    const guide = buildStatusCostGovernanceGuide();

    assert.equal(guide.focus, "long_running_ai_workflows");
    assert.match(guide.summary, /budget envelope/i);
    assert.ok(guide.telnyx_controls.some((item) => item.includes("usage-cost-explorer")));
    assert.ok(guide.tracking.keep_ids.includes("conversation_id"));
    assert.match(guide.boundary, /TEL-430/);
  });

  it("shows setup-ai presets in CLI help", () => {
    const output = execFileSync("npx", ["tsx", CLI, "help"], {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
      timeout: 30000,
    });

    assert.match(output, /--preset/);
    assert.match(output, /appointment-reminders/);
    assert.match(output, /support-handoff/);
    assert.match(output, /lead-recovery/);
  });
});
