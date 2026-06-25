/**
 * telnyx-agent capabilities — Self-describing API surface.
 */

import { outputJson } from "../utils/output.ts";

interface Capability {
  name: string;
  description: string;
  actions: string[];
  governance: GovernanceMetadata;
}

export interface GovernanceMetadata {
  risk_class: "read_only" | "guarded_write" | "live_write";
  approval_expectation: "none" | "confirm_before_mutation" | "confirm_before_external_effect";
  approval_path: "none_read_only" | "confirm_intent_then_mutate" | "explicit_approval_then_execute";
  memory_scope: "stateless" | "host_controlled" | "customer_configured" | "app_scoped";
  model_behavior: "host_controlled" | "request_selected" | "customer_configured" | "app_defined";
  audit_identifiers: string[];
}

interface CompositeCommand {
  name: string;
  description: string;
  governance: GovernanceMetadata;
}

interface AiCatalogEntry {
  id: string;
  name: string;
  summary: string;
  discovery: string[];
  freshness_note: string;
}

interface AiCatalogSummary {
  canonical_url: string;
  updated_at: string;
  freshness_note: string;
  workloads: AiCatalogEntry[];
}

interface RetryIdempotencyContract {
  applies_to: Array<GovernanceMetadata["risk_class"]>;
  mutating_requests: {
    idempotency_key_header: string;
    generate_new_key_when: string;
    reuse_same_key_only_when: string;
  };
  async_completion: {
    treat_202_accepted_as_in_progress: boolean;
    poll_to_terminal_state: boolean;
    honor_retry_after: boolean;
    guidance: string;
  };
}

export const GOVERNANCE_PRESETS = {
  readOnlyHost: {
    risk_class: "read_only",
    approval_expectation: "none",
    approval_path: "none_read_only",
    memory_scope: "host_controlled",
    model_behavior: "host_controlled",
    audit_identifiers: ["request_id"],
  },
  readOnlyAppScoped: {
    risk_class: "read_only",
    approval_expectation: "none",
    approval_path: "none_read_only",
    memory_scope: "app_scoped",
    model_behavior: "app_defined",
    audit_identifiers: ["request_id", "resource_id"],
  },
  readOnlyStateless: {
    risk_class: "read_only",
    approval_expectation: "none",
    approval_path: "none_read_only",
    memory_scope: "stateless",
    model_behavior: "host_controlled",
    audit_identifiers: ["request_id"],
  },
  guardedHost: {
    risk_class: "guarded_write",
    approval_expectation: "confirm_before_mutation",
    approval_path: "confirm_intent_then_mutate",
    memory_scope: "host_controlled",
    model_behavior: "host_controlled",
    audit_identifiers: ["request_id", "resource_id"],
  },
  guardedStatelessModelSelected: {
    risk_class: "guarded_write",
    approval_expectation: "confirm_before_mutation",
    approval_path: "confirm_intent_then_mutate",
    memory_scope: "stateless",
    model_behavior: "request_selected",
    audit_identifiers: ["request_id", "idempotency_key", "model_id"],
  },
  guardedCustomerConfigured: {
    risk_class: "guarded_write",
    approval_expectation: "confirm_before_mutation",
    approval_path: "confirm_intent_then_mutate",
    memory_scope: "customer_configured",
    model_behavior: "customer_configured",
    audit_identifiers: ["request_id", "resource_id", "conversation_id"],
  },
  liveHost: {
    risk_class: "live_write",
    approval_expectation: "confirm_before_external_effect",
    approval_path: "explicit_approval_then_execute",
    memory_scope: "host_controlled",
    model_behavior: "host_controlled",
    audit_identifiers: ["request_id", "resource_id", "webhook_delivery_id"],
  },
  liveCustomerConfigured: {
    risk_class: "live_write",
    approval_expectation: "confirm_before_external_effect",
    approval_path: "explicit_approval_then_execute",
    memory_scope: "customer_configured",
    model_behavior: "customer_configured",
    audit_identifiers: ["request_id", "resource_id", "conversation_id", "webhook_delivery_id"],
  },
} satisfies Record<string, GovernanceMetadata>;

export const CAPABILITIES: Record<string, Capability[]> = {
  "📱 Messaging": [
    { name: "SMS / MMS", description: "Send and receive text and multimedia messages", actions: ["send_sms", "list_messaging_profiles", "create_messaging_profile"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "📞 Voice": [
    { name: "Call Control", description: "Make and manage voice calls via SIP connections", actions: ["make_call", "list_connections"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "🔢 Numbers": [
    { name: "Phone Numbers", description: "Search, buy, and manage phone numbers", actions: ["list_phone_numbers", "search_phone_numbers", "buy_phone_number"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "🤖 AI": [
    { name: "Chat Completions", description: "LLM inference via Telnyx AI", actions: ["ai_chat"], governance: GOVERNANCE_PRESETS.guardedStatelessModelSelected },
    { name: "Embeddings", description: "Generate text embeddings", actions: ["ai_embed"], governance: GOVERNANCE_PRESETS.guardedStatelessModelSelected },
    { name: "Assistants", description: "Create and manage AI voice assistants", actions: ["list_ai_assistants", "create_ai_assistant"], governance: GOVERNANCE_PRESETS.liveCustomerConfigured },
  ],
  "📠 Fax": [
    { name: "Fax", description: "Send faxes programmatically", actions: ["send_fax"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "📡 IoT": [
    { name: "SIM Cards", description: "Manage IoT SIM cards and connectivity", actions: ["list_sim_cards"], governance: GOVERNANCE_PRESETS.guardedHost },
  ],
  "🔍 Lookup": [
    { name: "Number Lookup", description: "Carrier and caller ID lookups", actions: ["lookup_number"], governance: { ...GOVERNANCE_PRESETS.guardedHost, memory_scope: "stateless" } },
  ],
  "✅ Verify": [
    { name: "Phone Verification", description: "Send and verify phone codes (2FA)", actions: ["verify_phone", "verify_code", "create_verify_profile"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "🔐 Networking": [
    { name: "WireGuard VPN", description: "Create private networks and WireGuard tunnels", actions: ["create_network", "create_wireguard_interface", "create_wireguard_peer"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "⚡ Edge Compute": [
    { name: "Edge Functions", description: "Pair Telnyx AI workflows with Telnyx Edge Compute. telnyx-agent now provides an executable handoff and prefers API-key auth for agent use when supported by telnyx-edge.", actions: ["see_guides_edge_compute"], governance: GOVERNANCE_PRESETS.liveHost },
    { name: "Deployment Handoff", description: "Use team-telnyx/ai for orchestration patterns and telnyx-edge for status, deploy, delete, secrets, bindings, and lifecycle management.", actions: ["telnyx_edge_status", "telnyx_edge_ship", "telnyx_edge_delete_func", "telnyx_edge_secrets", "telnyx_edge_bindings"], governance: GOVERNANCE_PRESETS.liveHost },
    { name: "Storage / KV Boundary", description: "Upstream telnyx-edge exposes storage and KV namespace/key workflows. team-telnyx/ai documents that surface but intentionally leaves execution to the dedicated Edge CLI.", actions: ["telnyx_edge_storage_kv"], governance: GOVERNANCE_PRESETS.guardedHost },
    { name: "Edge CLI Bridge", description: "Thin executable handoff from telnyx-agent into telnyx-edge for real MCP, typed call-event routing, and webhook starting points.", actions: ["edge_doctor", "setup_edge_mcp", "setup_edge_webhook"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "📋 10DLC Compliance": [
    { name: "10DLC Registration", description: "Register brands and campaigns for US A2P messaging", actions: ["create_10dlc_brand", "create_10dlc_campaign", "assign_10dlc_number"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "💰 Account": [
    { name: "Balance", description: "Check account balance and billing", actions: ["get_balance"], governance: GOVERNANCE_PRESETS.readOnlyHost },
  ],
  "💳 Payments": [
    { name: "x402 Crypto Payments", description: "Fund account with USDC on Base blockchain via x402 protocol", actions: ["get_payment_quote", "submit_payment"], governance: GOVERNANCE_PRESETS.liveHost },
  ],
  "🔄 Porting": [
    { name: "Number Porting", description: "Check portability, create and manage port-in orders, track requirements and documents", actions: ["check_portability", "list_porting_orders", "create_porting_order", "get_porting_order", "submit_porting_order", "cancel_porting_order", "list_porting_phone_numbers", "upload_porting_document", "list_porting_requirements"], governance: GOVERNANCE_PRESETS.liveHost },
    { name: "Port-Out", description: "List and inspect port-out activity, reject or comment on port-out orders", actions: ["list_portout_orders", "get_portout_order", "list_portout_rejection_codes"], governance: GOVERNANCE_PRESETS.guardedHost },
  ],
};

export const COMPOSITE_COMMANDS: CompositeCommand[] = [
  { name: "telnyx-agent setup-sms", description: "Zero to SMS: creates messaging profile, buys number, assigns it", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-voice", description: "Zero to voice: creates SIP connection, buys number, assigns it", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-iot", description: "Zero to IoT: lists SIMs, creates group, activates SIM", governance: GOVERNANCE_PRESETS.guardedHost },
  { name: "telnyx-agent setup-ai", description: "Zero to AI assistant: creates assistant, buys number, wires them together", governance: GOVERNANCE_PRESETS.liveCustomerConfigured },
  { name: "telnyx-agent setup-wireguard", description: "Zero to VPN: creates network, WireGuard interface, peer — outputs ready-to-use WG config", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-edge status", description: "Check Edge CLI authentication, configuration, and connectivity before or after a handoff", governance: GOVERNANCE_PRESETS.readOnlyHost },
  { name: "telnyx-edge ship", description: "Deploy an Edge Compute function with the dedicated telnyx-edge CLI (referenced by the Edge Compute guide)", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-edge delete-func", description: "Remove an Edge Compute function with the dedicated telnyx-edge CLI when lifecycle cleanup is required", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent edge-doctor", description: "Validate Edge Compute handoff prerequisites and point to the next concrete telnyx-edge steps", governance: GOVERNANCE_PRESETS.readOnlyHost },
  { name: "telnyx-agent setup-edge-mcp", description: "Concrete MCP-on-Edge handoff: points to the real example and deploy command via telnyx-edge", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-edge-webhook", description: "Concrete webhook-on-Edge handoff: points to the real example and deploy command via telnyx-edge", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-verify", description: "Zero to verification: creates verify profile, buys number — outputs test command", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-10dlc", description: "Zero to A2P: creates 10DLC brand, campaign, optional number assignment", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent setup-porting", description: "Zero to porting: checks portability, creates porting order, lists requirements, optionally submits", governance: GOVERNANCE_PRESETS.liveHost },
  { name: "telnyx-agent status", description: "Account health overview — balance, numbers, profiles, connections", governance: GOVERNANCE_PRESETS.readOnlyHost },
  { name: "telnyx-agent capabilities", description: "This command — lists all available API capabilities", governance: GOVERNANCE_PRESETS.readOnlyStateless },
];

const AI_CATALOG: AiCatalogSummary = {
  canonical_url: "https://telnyx.com/ai/catalog.json",
  updated_at: "2026-06-14T00:00:00Z",
  freshness_note: "Workload groupings here are repo-maintained. Resolve live model inventory from the linked runtime surfaces before automating against a specific model ID.",
  workloads: [
    {
      id: "hosted_voice_assistants",
      name: "Hosted voice assistants",
      summary: "Telnyx-managed assistant runtime with telephony, STT, TTS, and assistant configuration on one platform.",
      discovery: [
        "GET /v2/ai/models",
        "telnyx ai models",
        "https://telnyx.com/guides/ai-assistants.md",
      ],
      freshness_note: "Assistant model IDs are account- and region-sensitive. Resolve them live before deployment."
    },
    {
      id: "telnyx_inference_api",
      name: "Telnyx-hosted inference and embeddings",
      summary: "OpenAI-compatible inference for chat completions, embeddings, and non-voice agent workloads.",
      discovery: [
        "https://developers.telnyx.com/docs/inference/models",
        "https://telnyx.com/ai/inference-models.json",
        "POST /v2/ai/chat/completions",
      ],
      freshness_note: "Inference inventory changes faster than repo releases. Confirm model availability from the live catalog."
    },
    {
      id: "external_llm_orchestration_on_telnyx_voice",
      name: "External LLM orchestration on Telnyx voice",
      summary: "Keep Telnyx for telephony and speech while your own model gateway or agent runtime owns reasoning.",
      discovery: [
        "https://developers.telnyx.com/docs/inference/ai-assistants/custom-llm",
        "https://telnyx.com/guides/telnyx-native-vs-third-party-voice-orchestration.md",
      ],
      freshness_note: "Validate provider-specific model IDs and OpenAI-compatible contract details directly against the external runtime."
    },
    {
      id: "conversation_relay",
      name: "Conversation Relay",
      summary: "Text-streaming voice orchestration path between Telnyx telephony and an external AI engine without raw-audio handling.",
      discovery: [
        "https://telnyx.com/release-notes/conversation-relay-stream-text-websockets",
        "Voice API start conversation relay command",
      ],
      freshness_note: "Use the current Voice API docs for the runtime contract before rollout."
    },
    {
      id: "assistant_workflows_and_handoffs",
      name: "Structured assistant orchestration",
      summary: "Workflows, handoff, async tools, and traffic testing for staged or multi-agent assistant behavior.",
      discovery: [
        "https://developers.telnyx.com/docs/inference/ai-assistants/workflows",
        "https://developers.telnyx.com/docs/inference/ai-assistants/agent-handoff",
        "https://developers.telnyx.com/docs/inference/ai-assistants/version-testing-traffic-distribution",
      ],
      freshness_note: "Use the live docs for field-level payload shapes even when the workload choice is clear here."
    },
  ]
};

export const RETRY_IDEMPOTENCY_CONTRACT: RetryIdempotencyContract = {
  applies_to: ["guarded_write", "live_write"],
  mutating_requests: {
    idempotency_key_header: "Idempotency-Key",
    generate_new_key_when: "Send a fresh Idempotency-Key on every mutating request that creates, confirms, retries, or otherwise changes state.",
    reuse_same_key_only_when: "Reuse that same key only when retrying the exact same intended write after a timeout, transport failure, or ambiguous client-side result.",
  },
  async_completion: {
    treat_202_accepted_as_in_progress: true,
    poll_to_terminal_state: true,
    honor_retry_after: true,
    guidance: "Do not infer completion from the initial write response alone when the API family documents asynchronous processing.",
  },
};

export async function capabilitiesCommand(flags: Record<string, string | boolean>): Promise<void> {
  const jsonOutput = flags.json === true;

  if (jsonOutput) {
    outputJson({
      api_capabilities: CAPABILITIES,
      composite_commands: COMPOSITE_COMMANDS,
      ai_catalog: AI_CATALOG,
      retry_idempotency_contract: RETRY_IDEMPOTENCY_CONTRACT,
      total_tools: Object.values(CAPABILITIES).flat().reduce((sum, c) => sum + c.actions.length, 0),
    });
    return;
  }

  console.log("\n🔧 Telnyx Agent Toolkit — Capabilities");
  console.log("=======================================\n");

  console.log("📦 Composite Commands (one command, full stack):\n");
  for (const cmd of COMPOSITE_COMMANDS) {
    console.log(`  ${cmd.name}`);
    console.log(`    ${cmd.description}\n`);
    console.log(`    Governance: risk=${cmd.governance.risk_class}; approval=${cmd.governance.approval_expectation}; path=${cmd.governance.approval_path}; memory=${cmd.governance.memory_scope}; model=${cmd.governance.model_behavior}; audit=${cmd.governance.audit_identifiers.join(",")}\n`);
  }

  console.log("─".repeat(50));
  console.log("\n🛠️  API Capabilities:\n");

  for (const [category, capabilities] of Object.entries(CAPABILITIES)) {
    console.log(`  ${category}`);
    for (const cap of capabilities) {
      console.log(`    ${cap.name} — ${cap.description}`);
      console.log(`      Tools: ${cap.actions.join(", ")}`);
      console.log(`      Governance: risk=${cap.governance.risk_class}; approval=${cap.governance.approval_expectation}; path=${cap.governance.approval_path}; memory=${cap.governance.memory_scope}; model=${cap.governance.model_behavior}; audit=${cap.governance.audit_identifiers.join(",")}`);
    }
    console.log();
  }

  const total = Object.values(CAPABILITIES).flat().reduce((sum, c) => sum + c.actions.length, 0);
  console.log(`Total: ${total} API tools across ${Object.keys(CAPABILITIES).length} categories\n`);

  console.log("📚 AI Catalog:\n");
  console.log(`  Canonical URL: ${AI_CATALOG.canonical_url}`);
  console.log(`  Updated: ${AI_CATALOG.updated_at}`);
  console.log(`  Freshness: ${AI_CATALOG.freshness_note}\n`);

  for (const workload of AI_CATALOG.workloads) {
    console.log(`  ${workload.name} — ${workload.summary}`);
    console.log(`    Discovery: ${workload.discovery.join(" | ")}`);
    console.log(`    Note: ${workload.freshness_note}\n`);
  }

  console.log("🔁 Retry & Idempotency:\n");
  console.log(`  Applies to: ${RETRY_IDEMPOTENCY_CONTRACT.applies_to.join(", ")}`);
  console.log(`  Header: ${RETRY_IDEMPOTENCY_CONTRACT.mutating_requests.idempotency_key_header}`);
  console.log(`  Fresh key: ${RETRY_IDEMPOTENCY_CONTRACT.mutating_requests.generate_new_key_when}`);
  console.log(`  Reuse only: ${RETRY_IDEMPOTENCY_CONTRACT.mutating_requests.reuse_same_key_only_when}`);
  console.log(`  Async writes: treat 202 as in-progress=${RETRY_IDEMPOTENCY_CONTRACT.async_completion.treat_202_accepted_as_in_progress}; poll=${RETRY_IDEMPOTENCY_CONTRACT.async_completion.poll_to_terminal_state}; honor Retry-After=${RETRY_IDEMPOTENCY_CONTRACT.async_completion.honor_retry_after}`);
  console.log(`  Note: ${RETRY_IDEMPOTENCY_CONTRACT.async_completion.guidance}\n`);
}
