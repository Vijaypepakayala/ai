import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES as CLI_CAPABILITIES, RETRY_IDEMPOTENCY_CONTRACT as CLI_RETRY_IDEMPOTENCY_CONTRACT } from "../cli/src/commands/capabilities.ts";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

const README = read("README.md");
const AGENTS = read("AGENTS.md");
const AGENTS_START = read("agents/start.md");
const LLMS = read("llms.txt");
const agentJson = JSON.parse(read("agent.json"));
const agentCard = JSON.parse(read(".well-known/agent-card.json"));
const agentAccess = JSON.parse(read(".well-known/agent-access.json"));
const capabilitiesJson = JSON.parse(read("ai/capabilities.json"));
const pricingJson = JSON.parse(read("ai/pricing.json"));
const rateLimitsJson = JSON.parse(read("ai/rate-limits.json"));
const capabilityById = new Map(
  agentJson.capabilities.map((capability: { id: string }) => [capability.id, capability])
);
const overlappingCliGovernanceByAgentCapabilityId = {
  messaging: CLI_CAPABILITIES["📱 Messaging"][0].governance,
  voice: CLI_CAPABILITIES["📞 Voice"][0].governance,
  ai_assistants: CLI_CAPABILITIES["🤖 AI"][2].governance,
  ai_inference: CLI_CAPABILITIES["🤖 AI"][0].governance,
  numbers: CLI_CAPABILITIES["🔢 Numbers"][0].governance,
  verify: CLI_CAPABILITIES["✅ Verify"][0].governance,
  fax: CLI_CAPABILITIES["📠 Fax"][0].governance,
  iot: CLI_CAPABILITIES["📡 IoT"][0].governance,
  networking: CLI_CAPABILITIES["🔐 Networking"][0].governance,
  edge_compute: CLI_CAPABILITIES["⚡ Edge Compute"][0].governance,
  "10dlc": CLI_CAPABILITIES["📋 10DLC Compliance"][0].governance,
  payments: CLI_CAPABILITIES["💳 Payments"][0].governance,
  porting: CLI_CAPABILITIES["🔄 Porting"][0].governance,
} as const;

const canonicalDiscovery = {
  start_url: "https://telnyx.com/agents/start",
  agent_manifest_url: "https://telnyx.com/.well-known/agent-card.json",
  agent_access_url: "https://telnyx.com/.well-known/agent-access.json",
  agent_skills_index_url: "https://telnyx.com/.well-known/agent-skills/index.json",
  agents_md_url: "https://telnyx.com/AGENTS.md",
  auth_md_url: "https://telnyx.com/auth.md",
  llms_txt_url: "https://telnyx.com/llms.txt",
  oauth_authorization_server_url: "https://api.telnyx.com/.well-known/oauth-authorization-server",
  oauth_protected_resource_url: "https://api.telnyx.com/.well-known/oauth-protected-resource",
  mcp_resource_metadata_url: "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp",
  mcp_server_card_url: "https://telnyx.com/.well-known/mcp/server-card.json",
  mcp_url: "https://api.telnyx.com/v2/mcp",
  mcp_apps_registry_url: "https://developers.telnyx.com/.well-known/mcp-app-registry.json",
  mcp_apps_alias_url: "https://developers.telnyx.com/.well-known/mcp-apps.json",
  mcp_apps_catalog_url: "https://developers.telnyx.com/apps",
  mcp_apps_proof_app_url: "https://developers.telnyx.com/apps/number-intelligence",
  openapi_url: "https://telnyx.com/.well-known/openapi.json",
  ai_catalog_url: "https://telnyx.com/ai/catalog.json",
  capabilities_url: "https://telnyx.com/ai/capabilities.json",
  pricing_url: "https://telnyx.com/ai/pricing.json",
  rate_limits_url: "https://telnyx.com/ai/rate-limits.json",
  webhooks_guide: "https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks",
} as const;

describe("agent discovery surfaces", () => {
  it("agent.json publishes a governed-execution legend", () => {
    assert.deepEqual(agentJson.governed_execution.fields, [
      "risk_class",
      "approval_expectation",
      "approval_path",
      "memory_scope",
      "model_behavior",
      "audit_identifiers"
    ]);
    assert.deepEqual(Object.keys(agentJson.governed_execution.risk_classes), [
      "read_only",
      "guarded_write",
      "live_write"
    ]);
    assert.deepEqual(Object.keys(agentJson.governed_execution.approval_paths), [
      "none_read_only",
      "confirm_intent_then_mutate",
      "explicit_approval_then_execute"
    ]);
  });

  it("every agent capability exposes governed-execution metadata", () => {
    for (const capability of agentJson.capabilities) {
      assert.ok(capability.governance, `${capability.id} missing governance`);
      assert.match(capability.governance.risk_class, /^(read_only|guarded_write|live_write)$/);
      assert.match(capability.governance.approval_expectation, /^(none|confirm_before_mutation|confirm_before_external_effect)$/);
      assert.match(capability.governance.approval_path, /^(none_read_only|confirm_intent_then_mutate|explicit_approval_then_execute)$/);
      assert.match(capability.governance.memory_scope, /^(stateless|host_controlled|customer_configured|app_scoped)$/);
      assert.match(capability.governance.model_behavior, /^(host_controlled|request_selected|customer_configured|app_defined)$/);
      assert.ok(Array.isArray(capability.governance.audit_identifiers), `${capability.id} missing audit_identifiers`);
      assert.ok(capability.governance.audit_identifiers.length > 0, `${capability.id} has empty audit_identifiers`);
    }
  });

  it("keeps overlapping manifest capabilities aligned with the CLI governance contract", () => {
    for (const [capabilityId, governance] of Object.entries(overlappingCliGovernanceByAgentCapabilityId)) {
      assert.deepEqual(
        capabilityById.get(capabilityId)?.governance,
        governance,
        `${capabilityId} governance drifted from cli/src/commands/capabilities.ts`
      );
    }
  });

  it("keeps retry and idempotency guidance aligned across machine-readable public surfaces", () => {
    assert.deepEqual(agentJson.retry_idempotency_contract, CLI_RETRY_IDEMPOTENCY_CONTRACT);
    assert.deepEqual(agentCard.retry_idempotency_contract, agentJson.retry_idempotency_contract);
    assert.deepEqual(agentAccess.fast_path.retry_idempotency_contract, agentJson.retry_idempotency_contract);
    assert.equal(agentJson.first_run_paths[0].retry_idempotency_contract, "default_mutating_request_contract");
  });

  it("keeps the machine-readable rate-limit and async contract aligned across public surfaces", () => {
    assert.deepEqual(agentCard.rate_limit_contract, agentJson.rate_limit_contract);
    assert.equal(agentAccess.fast_path.rate_limit_contract_url, canonicalDiscovery.rate_limits_url);
    assert.equal(agentAccess.fast_path.primary_path.rate_limit_contract, canonicalDiscovery.rate_limits_url);
    assert.equal(rateLimitsJson.canonical_url, canonicalDiscovery.rate_limits_url);
    assert.deepEqual(rateLimitsJson.content.default_headers, agentJson.rate_limit_contract.headers);
    assert.deepEqual(
      rateLimitsJson.content.async_job_handoff.representative_workflow.terminal_statuses,
      agentJson.rate_limit_contract.async_job_handoff.representative_workflow.terminal_statuses
    );
    assert.equal(capabilitiesJson.content.discovery.rate_limits_json, canonicalDiscovery.rate_limits_url);
  });

  it("public discovery JSON mirrors expose the same governed-execution contract", () => {
    assert.deepEqual(agentCard.governed_execution.fields, agentJson.governed_execution.fields);
    assert.deepEqual(agentAccess.governed_execution.fields, agentJson.governed_execution.fields);
    assert.deepEqual(capabilitiesJson.content.governed_execution.fields, agentJson.governed_execution.fields);

    for (const surface of Object.values(agentCard.discovery_governance) as Array<Record<string, unknown>>) {
      assert.match(surface.risk_class as string, /^(read_only|guarded_write|live_write)$/);
      assert.match(surface.approval_expectation as string, /^(none|confirm_before_mutation|confirm_before_external_effect)$/);
      assert.match(surface.approval_path as string, /^(none_read_only|confirm_intent_then_mutate|explicit_approval_then_execute)$/);
      assert.ok(Array.isArray(surface.audit_identifiers));
      assert.ok((surface.audit_identifiers as unknown[]).length > 0);
    }
  });

  it("agent.json exposes the canonical discovery map", () => {
    assert.deepEqual(agentJson.discovery, canonicalDiscovery);
  });

  it("repo-owned machine-readable discovery assets exist locally", () => {
    for (const path of [
      ".well-known/agent-access.json",
      "ai/catalog.json",
      "ai/capabilities.json",
      "ai/pricing.json",
      "ai/rate-limits.json",
      "llms.txt"
    ]) {
      assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);
    }
  });

  it("local AI catalog mirror matches the canonical discovery URL and governed contract", () => {
    const aiCatalog = JSON.parse(read("ai/catalog.json"));
    assert.equal(aiCatalog.canonical_url, canonicalDiscovery.ai_catalog_url);
    assert.equal(aiCatalog.provider, "telnyx");
    assert.equal(aiCatalog.content.provider, "telnyx");
    assert.deepEqual(aiCatalog.content.governed_execution.fields, agentJson.governed_execution.fields);
    assert.equal(aiCatalog.content.surface_governance.risk_class, "read_only");
    assert.ok(Array.isArray(aiCatalog.content.workloads));
    assert.ok(aiCatalog.content.workloads.length >= 4);
  });

  it("local capability and pricing mirrors match the canonical discovery URLs", () => {
    assert.equal(capabilitiesJson.canonical_url, canonicalDiscovery.capabilities_url);
    assert.equal(capabilitiesJson.provider, "telnyx");
    assert.equal(capabilitiesJson.content.provider, "telnyx");
    assert.equal(pricingJson.canonical_url, canonicalDiscovery.pricing_url);
    assert.equal(pricingJson.provider, "telnyx");
    assert.equal(pricingJson.content.provider, "telnyx");
    assert.equal(rateLimitsJson.canonical_url, canonicalDiscovery.rate_limits_url);
    assert.equal(rateLimitsJson.provider, "telnyx");
    assert.equal(rateLimitsJson.content.provider, "telnyx");
  });

  it("agent.json auth matches the discovery access surface", () => {
    assert.equal(agentJson.auth.signup_manifest, canonicalDiscovery.agent_access_url);
    assert.equal(agentJson.auth.signup_guide, "https://telnyx.com/agent-signup.md");
    assert.equal(agentJson.auth.auth_md, canonicalDiscovery.auth_md_url);
    assert.equal(agentJson.auth.oauth_authorization_server, canonicalDiscovery.oauth_authorization_server_url);
    assert.equal(agentJson.auth.oauth_protected_resource, canonicalDiscovery.oauth_protected_resource_url);
    assert.equal(agentJson.auth.mcp_resource_metadata, canonicalDiscovery.mcp_resource_metadata_url);
  });

  it("agent.json links keep critical discovery URLs aligned", () => {
    assert.equal(agentJson.links.agents_start, canonicalDiscovery.start_url);
    assert.equal(agentJson.links.agent_manifest, canonicalDiscovery.agent_manifest_url);
    assert.equal(agentJson.links.agent_access, canonicalDiscovery.agent_access_url);
    assert.equal(agentJson.links.agent_skills_index, canonicalDiscovery.agent_skills_index_url);
    assert.equal(agentJson.links.agents_md, canonicalDiscovery.agents_md_url);
    assert.equal(agentJson.links.auth_md, canonicalDiscovery.auth_md_url);
    assert.equal(agentJson.links.llms_txt, canonicalDiscovery.llms_txt_url);
    assert.equal(agentJson.links.oauth_authorization_server, canonicalDiscovery.oauth_authorization_server_url);
    assert.equal(agentJson.links.oauth_protected_resource, canonicalDiscovery.oauth_protected_resource_url);
    assert.equal(agentJson.links.mcp_resource_metadata, canonicalDiscovery.mcp_resource_metadata_url);
    assert.equal(agentJson.links.openapi, canonicalDiscovery.openapi_url);
    assert.equal(agentJson.links.mcp_server_card, canonicalDiscovery.mcp_server_card_url);
    assert.equal(agentJson.links.mcp, canonicalDiscovery.mcp_url);
    assert.equal(agentJson.links.mcp_apps_registry, canonicalDiscovery.mcp_apps_registry_url);
    assert.equal(agentJson.links.mcp_apps_alias, canonicalDiscovery.mcp_apps_alias_url);
    assert.equal(agentJson.links.mcp_apps_catalog, canonicalDiscovery.mcp_apps_catalog_url);
    assert.equal(agentJson.links.mcp_apps_proof_app, canonicalDiscovery.mcp_apps_proof_app_url);
    assert.equal(agentJson.links.ai_catalog, canonicalDiscovery.ai_catalog_url);
    assert.equal(agentJson.links.capabilities, canonicalDiscovery.capabilities_url);
    assert.equal(agentJson.links.rate_limits, canonicalDiscovery.rate_limits_url);
    assert.equal(agentJson.links.pricing, canonicalDiscovery.pricing_url);
    assert.equal(agentJson.links.webhooks_guide, canonicalDiscovery.webhooks_guide);
  });

  it("README.md surfaces every canonical discovery URL", () => {
    for (const value of Object.values(canonicalDiscovery)) {
      assert.match(README, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("AGENTS.md surfaces every canonical discovery URL", () => {
    for (const value of Object.values(canonicalDiscovery)) {
      assert.match(AGENTS, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("agents/start.md links the core public discovery surfaces and names webhooks explicitly", () => {
    for (const value of [
      ...Object.values(canonicalDiscovery),
      "/agent.json",
      "/guides/webhooks.md",
      "/guides/ai-assistants.md",
      "/guides/voice-agent-onboarding.md",
      "/guides/x402-payments.md",
      "/tools/python/examples"
    ]) {
      assert.match(AGENTS_START, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    for (const term of [
      "Telnyx webhooks guide",
      "signature verification",
      "What agents can do with Telnyx",
      "Frequently asked questions",
      "Governed execution metadata",
      "risk_class",
      "approval_expectation",
      "approval_path",
      "memory_scope",
      "model_behavior",
      "audit_identifiers",
      "read_only",
      "guarded_write",
      "live_write",
      "application/ld+json",
      "\"@type\": \"Article\"",
      "\"@type\": \"FAQPage\"",
      "governed examples",
      "openai/gpt-5.4",
      "Telnyx Voice AI Agents",
      "Telnyx x402 Payments",
      "Zero-signup first run",
      "Named developer entrypoints"
    ]) {
      assert.match(AGENTS_START, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("llms.txt mirrors the entrypoint and keeps webhook discovery visible", () => {
    for (const value of [
      canonicalDiscovery.start_url,
      canonicalDiscovery.agent_manifest_url,
      canonicalDiscovery.agent_access_url,
      canonicalDiscovery.auth_md_url,
      canonicalDiscovery.llms_txt_url,
      canonicalDiscovery.openapi_url,
      canonicalDiscovery.ai_catalog_url,
      canonicalDiscovery.mcp_url,
      canonicalDiscovery.webhooks_guide,
      canonicalDiscovery.agents_md_url,
      "https://telnyx.com/guides/webhooks.md",
      "https://telnyx.com/guides/ai-assistants.md",
      "https://telnyx.com/guides/voice-agent-onboarding.md",
      "https://telnyx.com/guides/x402-payments.md",
      "https://github.com/team-telnyx/ai/tree/main/tools/python/examples"
    ]) {
      assert.match(LLMS, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    for (const term of [
      "Summary",
      "What an agent should learn first",
      "How to choose a surface",
      "Governed examples",
      "approval_path",
      "audit_identifiers",
      "without JavaScript",
      "openai/gpt-5.4",
      "Telnyx Voice AI Agents",
      "Telnyx x402 Payments"
    ]) {
      assert.match(LLMS, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("README.md explicitly names auth, MCP Apps, OpenAPI, MCP, pricing, and webhooks in the discovery section", () => {
    for (const term of ["Auth guide", "OAuth authorization server", "OAuth protected resource", "MCP resource metadata", "MCP Apps registry", "MCP Apps catalog", "OpenAPI spec", "MCP server card", "Pricing", "Telnyx webhooks guide"]) {
      assert.match(README, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("agent.json names MCP Apps as a first-class discoverable capability", () => {
    const capability = agentJson.capabilities.find((entry: { id: string }) => entry.id === "mcp_apps");
    assert.ok(capability);
    assert.equal(capability.docs, canonicalDiscovery.mcp_apps_catalog_url);
    assert.match(capability.api, /mcp-app-registry\.json/);
  });
});
