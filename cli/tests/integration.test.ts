/**
 * Integration tests for telnyx-agent CLI.
 * Tests read-only commands (status, capabilities) against real API.
 * Setup commands are NOT tested against real API (they cost money).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "telnyx-agent.ts");
const run = (args: string) => execSync(`npx tsx ${CLI} ${args}`, { encoding: "utf-8", timeout: 30000 });

describe("telnyx-agent CLI", () => {
  describe("help", () => {
    it("shows help with no args", () => {
      const output = run("help");
      assert.ok(output.includes("telnyx-agent"), "Should contain CLI name");
      assert.ok(output.includes("setup-sms"), "Should list setup-sms command");
      assert.ok(output.includes("status"), "Should list status command");
    });
  });

  describe("capabilities", () => {
    it("outputs human-readable capabilities", () => {
      const output = run("capabilities");
      assert.ok(output.includes("Capabilities"), "Should have capabilities header");
      assert.ok(output.includes("Messaging"), "Should list Messaging category");
      assert.ok(output.includes("Voice"), "Should list Voice category");
      assert.ok(output.includes("AI"), "Should list AI category");
      assert.ok(output.includes("AI Catalog"), "Should list AI catalog section");
      assert.ok(output.includes("Retry & Idempotency"), "Should list retry and idempotency section");
      assert.ok(output.includes("Model Routing & Provider Failover"), "Should list model routing policy section");
      assert.ok(output.includes("reviewed assistant version"), "Should mention reviewed fallback behavior");
      assert.ok(output.includes("Governance: risk="), "Should surface governed execution metadata");
      assert.ok(output.includes("path="), "Should surface approval path metadata");
      assert.ok(output.includes("audit="), "Should surface audit identifier metadata");
      assert.ok(output.includes("Idempotency-Key"), "Should surface idempotency key guidance");
    });

    it("outputs JSON capabilities", () => {
      const output = run("capabilities --json");
      const data = JSON.parse(output);
      assert.ok(data.api_capabilities, "Should have api_capabilities");
      assert.ok(data.composite_commands, "Should have composite_commands");
      assert.ok(data.ai_catalog, "Should have ai_catalog");
      assert.ok(data.retry_idempotency_contract, "Should have retry_idempotency_contract");
      assert.ok(data.model_routing_policy, "Should have model_routing_policy");
      assert.ok(typeof data.total_tools === "number", "Should have total_tools count");
      assert.ok(data.total_tools >= 18, "Should have at least 18 tools");
      const firstCategory = Object.values(data.api_capabilities)[0] as Array<Record<string, unknown>>;
      assert.ok(firstCategory[0].governance, "Capability should have governance metadata");
      assert.ok((firstCategory[0].governance as Record<string, unknown>).approval_path, "Capability should have approval path metadata");
      assert.ok(Array.isArray((firstCategory[0].governance as Record<string, unknown>).audit_identifiers), "Capability should have audit identifiers metadata");
      assert.ok((data.composite_commands[0] as Record<string, unknown>).governance, "Composite command should have governance metadata");
      assert.ok(((data.composite_commands[0] as Record<string, unknown>).governance as Record<string, unknown>).approval_path, "Composite command should have approval path metadata");
      assert.ok(Array.isArray((((data.composite_commands[0] as Record<string, unknown>).governance as Record<string, unknown>).audit_identifiers)), "Composite command should have audit identifiers metadata");
      assert.equal((data.ai_catalog as Record<string, unknown>).canonical_url, "https://telnyx.com/ai/catalog.json");
      assert.ok(Array.isArray((data.ai_catalog as Record<string, unknown>).workloads), "AI catalog should expose workloads");
      assert.equal((data.retry_idempotency_contract as Record<string, unknown>).mutating_requests?.idempotency_key_header, "Idempotency-Key");
      assert.equal((data.retry_idempotency_contract as Record<string, unknown>).async_completion?.honor_retry_after, true);
      assert.ok(Array.isArray((data.model_routing_policy as Record<string, unknown>).rules), "Model routing policy should expose rules");
      assert.equal((data.model_routing_policy as Record<string, unknown>).references?.governance_playbook, "https://telnyx.com/guides/ai-model-governance-playbook.md");
    });
  });

  describe("status", () => {
    it("outputs account status (requires TELNYX_API_KEY)", () => {
      try {
        const output = run("status");
        assert.ok(output.includes("Account Status"), "Should have status header");
        assert.ok(output.includes("Balance"), "Should show balance");
        assert.ok(output.includes("Cost governance"), "Should show cost governance guidance");
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        // Skip if no API key configured
        if (e.stderr?.includes("No Telnyx API key")) {
          console.log("  ⊘ Skipped: No API key configured");
          return;
        }
        throw err;
      }
    });

    it("outputs JSON status (requires TELNYX_API_KEY)", () => {
      try {
        const output = run("status --json");
        const data = JSON.parse(output);
        assert.ok("balance" in data, "Should have balance");
        assert.ok("phone_numbers" in data, "Should have phone_numbers");
        assert.ok("messaging_profiles" in data, "Should have messaging_profiles");
        assert.ok("cost_governance" in data, "Should have cost_governance");
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        if (e.stderr?.includes("No Telnyx API key")) {
          console.log("  ⊘ Skipped: No API key configured");
          return;
        }
        throw err;
      }
    });
  });

  describe("unknown command", () => {
    it("shows error for unknown command", () => {
      try {
        run("foobar");
        assert.fail("Should have thrown");
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        assert.ok(e.stderr?.includes("Unknown command"), "Should show unknown command error");
      }
    });
  });
});
