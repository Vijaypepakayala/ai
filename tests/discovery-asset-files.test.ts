import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");

const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf-8"));

const agentJson = readJson("agent.json");
const agentCard = readJson(".well-known/agent-card.json");
const skillsIndex = readJson(".well-known/agent-skills/index.json");
const aiCatalog = readJson("ai/catalog.json");
const aiCatalogAlias = readJson(".well-known/ai-catalog.json");
const capabilities = readJson("ai/capabilities.json");
const capabilitiesAlias = readJson(".well-known/ai-capabilities.json");
const pricing = readJson("ai/pricing.json");
const rateLimits = readJson("ai/rate-limits.json");
const skillDirectories = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("source-controlled discovery assets", () => {
  it("checks in every repo-published discovery JSON asset referenced from docs", () => {
    for (const path of [
      ".well-known/agent-access.json",
      ".well-known/agent-card.json",
      ".well-known/agent-skills/index.json",
      ".well-known/ai-catalog.json",
      ".well-known/ai-capabilities.json",
      "ai/catalog.json",
      "ai/capabilities.json",
      "ai/pricing.json",
      "ai/rate-limits.json"
    ]) {
      assert.ok(existsSync(join(ROOT, path)), `missing discovery asset: ${path}`);
    }
  });

  it("keeps the public agent card aligned with agent.json discovery links", () => {
    assert.equal(agentCard.discovery.a2a_card, agentJson.discovery.agent_manifest_url);
    assert.equal(agentCard.discovery.agent_access, agentJson.discovery.agent_access_url);
    assert.equal(agentCard.discovery.agent_skills, agentJson.discovery.agent_skills_index_url);
    assert.equal(agentCard.discovery.llms_txt, agentJson.discovery.llms_txt_url);
    assert.equal(agentCard.discovery.ai_catalog, agentJson.discovery.ai_catalog_url);
    assert.equal(agentCard.mcp.url, agentJson.discovery.mcp_server_card_url);
    assert.deepEqual(agentCard.governed_execution.fields, agentJson.governed_execution.fields);
  });

  it("keeps the AI catalog, capability, and pricing mirrors aligned with their canonical URLs", () => {
    assert.equal(aiCatalog.canonical_url, agentJson.discovery.ai_catalog_url);
    assert.equal(aiCatalogAlias.canonical_url, aiCatalog.canonical_url);
    assert.equal(aiCatalogAlias.provider, aiCatalog.provider);
    assert.equal(aiCatalogAlias.content.category, aiCatalog.content.category);
    assert.equal(aiCatalog.content.source_of_truth.registry_plan_url, "https://telnyx.com/agents/ard-resource-catalog-plan.md");
    assert.equal(aiCatalogAlias.content.source_of_truth.registry_plan_url, aiCatalog.content.source_of_truth.registry_plan_url);
    assert.deepEqual(aiCatalog.content.governed_execution.fields, agentJson.governed_execution.fields);
    assert.deepEqual(aiCatalogAlias.content.governed_execution.fields, aiCatalog.content.governed_execution.fields);
    assert.equal(capabilities.canonical_url, agentJson.discovery.capabilities_url);
    assert.equal(pricing.canonical_url, agentJson.discovery.pricing_url);
    assert.equal(rateLimits.canonical_url, agentJson.discovery.rate_limits_url);
    assert.equal(capabilitiesAlias.canonical_url, capabilities.canonical_url);
    assert.equal(capabilitiesAlias.provider, capabilities.provider);
    assert.equal(capabilitiesAlias.content.category, capabilities.content.category);
    assert.deepEqual(capabilities.content.governed_execution.fields, agentJson.governed_execution.fields);
    assert.deepEqual(capabilitiesAlias.content.governed_execution.fields, capabilities.content.governed_execution.fields);
  });

  it("publishes a skill index that covers the checked-in canonical skill set", () => {
    const indexedSkillNames = new Set(
      skillsIndex.skills.map((skill: { name: string }) => skill.name)
    );

    for (const skill of skillDirectories) {
      assert.ok(indexedSkillNames.has(skill), `missing skill index entry for ${skill}`);
    }
  });
});
