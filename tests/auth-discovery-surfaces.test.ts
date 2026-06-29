import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");
const readJson = (path: string) => JSON.parse(read(path));

const authMd = read("auth.md");
const cliReadme = read("cli/README.md");
const agentJson = readJson("agent.json");
const mcpIndex = readJson(".well-known/mcp.json");
const serverCard = readJson(".well-known/mcp/server-card.json");
const authServer = readJson(".well-known/oauth-authorization-server");
const protectedResource = readJson(".well-known/oauth-protected-resource");
const mcpProtectedResource = readJson(".well-known/oauth-protected-resource-v2-mcp.json");
const pythonReadme = read("tools/python/README.md");
const typescriptReadme = read("tools/typescript/README.md");
const mcpReadme = read("tools/mcp/README.md");
const mcpAppsReadme = read("tools/mcp-apps/README.md");

describe("auth discovery artifacts", () => {
  it("auth.md points agents at the repo's public auth surfaces", () => {
    for (const url of [
      "https://telnyx.com/.well-known/agent-access.json",
      "https://telnyx.com/agent-signup.md",
      "https://api.telnyx.com/.well-known/oauth-authorization-server",
      "https://api.telnyx.com/.well-known/oauth-protected-resource",
      "https://api.telnyx.com/.well-known/oauth-protected-resource/v2/mcp",
      "https://api.telnyx.com/v2/mcp"
    ]) {
      assert.match(authMd, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("MCP discovery points at the canonical endpoint and server card", () => {
    assert.equal(mcpIndex.servers[0].endpoint, agentJson.discovery.mcp_url);
    assert.equal(mcpIndex.servers[0].card, agentJson.discovery.mcp_server_card_url);
    assert.equal(serverCard.serverUrl, agentJson.discovery.mcp_url);
    assert.equal(serverCard.links.auth_md, agentJson.discovery.auth_md_url);
  });

  it("protected-resource metadata and auth-server metadata are internally consistent", () => {
    assert.deepEqual(protectedResource.authorization_servers, [authServer.issuer]);
    assert.deepEqual(mcpProtectedResource.authorization_servers, [authServer.issuer]);
    assert.equal(protectedResource.resource, "https://api.telnyx.com");
    assert.equal(mcpProtectedResource.resource, agentJson.discovery.mcp_url);
    assert.match(serverCard.instructions, /Authorization: Bearer <TELNYX_API_KEY>/);
  });

  it("auth-server metadata exposes the current agent onboarding pointers", () => {
    assert.equal(authServer.agent_auth.skill, agentJson.discovery.auth_md_url);
    assert.equal(authServer.agent_auth.register_uri, "https://api.telnyx.com/v2/bot_signup");
    assert.equal(authServer.agent_auth.claim_uri, "https://api.telnyx.com/v2/bot_signup/resend_magic_link");
    assert.equal(authServer.agent_auth.challenge_uri, "https://api.telnyx.com/v2/bot_challenge");
    assert.equal(authServer.agent_auth.agent_access_uri, agentJson.discovery.agent_access_url);
    assert.equal(authServer.agent_auth.signup_guide_uri, agentJson.auth.signup_guide);
    assert.deepEqual(authServer.agent_auth.identity_types_supported, ["anonymous"]);
    assert.deepEqual(authServer.agent_auth.credential_types_supported, ["api_key"]);
    assert.deepEqual(authServer.agent_auth.anonymous.credential_types_supported, ["api_key"]);
    assert.deepEqual(authServer.agent_auth.anonymous.verification_methods_supported, ["email_magic_link"]);
    assert.equal(authServer.agent_auth.anonymous.required_preflight_uri, "https://api.telnyx.com/v2/bot_challenge");
    assert.deepEqual(authServer.agent_auth.events_supported, []);
    assert.equal(authServer.agent_onboarding.documentation_uri, agentJson.discovery.auth_md_url);
    assert.equal(authServer.agent_onboarding.agent_access_uri, agentJson.discovery.agent_access_url);
    assert.equal(authServer.agent_onboarding.signup_guide_uri, agentJson.auth.signup_guide);
    assert.deepEqual(authServer.protected_resources, [
      "https://api.telnyx.com",
      "https://api.telnyx.com/v2/mcp"
    ]);
  });

  it("agent access publishes the auth walkthrough and audited challenge fallback links", () => {
    const agentAccess = readJson(".well-known/agent-access.json");

    assert.equal(agentAccess.auth_discovery.walkthrough_uri, agentJson.discovery.auth_md_url);
    assert.equal(agentAccess.auth_discovery.signup_guide_uri, agentJson.auth.signup_guide);
    assert.equal(agentAccess.auth_discovery.agent_manifest_uri, agentJson.discovery.agent_manifest_url);
    assert.equal(
      agentAccess.auth_discovery.oauth_authorization_server_uri,
      agentJson.discovery.oauth_authorization_server_url
    );
    assert.equal(
      agentAccess.auth_discovery.oauth_protected_resource_uri,
      agentJson.discovery.oauth_protected_resource_url
    );
    assert.equal(
      agentAccess.auth_discovery.mcp_resource_metadata_uri,
      agentJson.discovery.mcp_resource_metadata_url
    );
    assert.equal(agentAccess.auth_discovery.mcp_server_card_uri, agentJson.discovery.mcp_server_card_url);
    assert.equal(agentAccess.auth_discovery.preferred_bearer_challenge.audited_entrypoint, agentJson.discovery.mcp_url);
    assert.equal(agentAccess.auth_discovery.preferred_bearer_challenge.mcp_method, "tools/call");
    assert.equal(agentAccess.auth_discovery.preferred_bearer_challenge.status_code, 401);
    assert.equal(agentAccess.auth_discovery.preferred_bearer_challenge.header, "WWW-Authenticate");
    assert.equal(agentAccess.auth_discovery.preferred_bearer_challenge.scheme, "Bearer");
    assert.equal(
      agentAccess.auth_discovery.preferred_bearer_challenge.resource_metadata_uri,
      agentJson.discovery.mcp_resource_metadata_url
    );
    assert.match(agentAccess.auth_discovery.preferred_bearer_challenge.probe_note, /tools\/call/);
  });

  it("protected-resource metadata mirrors the agent auth entrypoints", () => {
    for (const metadata of [protectedResource, mcpProtectedResource]) {
      assert.equal(metadata.agent_auth.skill, agentJson.discovery.auth_md_url);
      assert.equal(metadata.agent_auth.register_uri, authServer.agent_auth.register_uri);
      assert.equal(metadata.agent_auth.claim_uri, authServer.agent_auth.claim_uri);
      assert.equal(metadata.agent_auth.challenge_uri, authServer.agent_auth.challenge_uri);
      assert.equal(metadata.agent_auth.agent_access_uri, agentJson.discovery.agent_access_url);
      assert.equal(metadata.agent_auth.signup_guide_uri, agentJson.auth.signup_guide);
      assert.deepEqual(metadata.agent_auth.identity_types_supported, ["anonymous"]);
      assert.deepEqual(metadata.agent_auth.credential_types_supported, ["api_key"]);
      assert.deepEqual(metadata.agent_auth.anonymous.credential_types_supported, ["api_key"]);
      assert.deepEqual(metadata.agent_auth.anonymous.verification_methods_supported, ["email_magic_link"]);
      assert.equal(metadata.agent_auth.anonymous.required_preflight_uri, "https://api.telnyx.com/v2/bot_challenge");
      assert.deepEqual(metadata.agent_auth.events_supported, []);
    }
  });

  it("CLI and toolkit docs reuse the shared access-contract terminology", () => {
    const packageDocs = [
      cliReadme,
      pythonReadme,
      typescriptReadme,
      mcpReadme,
      mcpAppsReadme
    ];

    for (const doc of packageDocs) {
      for (const expected of [
        "https://telnyx.com/auth.md",
        "https://telnyx.com/.well-known/agent-access.json",
        "https://telnyx.com/ai/rate-limits.json",
        "Idempotency-Key",
        "Retry-After",
        "host-owned"
      ]) {
        assert.match(doc, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }

      assert.match(doc, /approval/i);
    }

    for (const doc of [cliReadme, pythonReadme, typescriptReadme]) {
      assert.match(doc, /https:\/\/api\.telnyx\.com\/\.well-known\/oauth-protected-resource/);
    }

    for (const doc of [mcpReadme]) {
      assert.match(doc, /https:\/\/api\.telnyx\.com\/\.well-known\/oauth-protected-resource\/v2\/mcp/);
      assert.match(doc, /WWW-Authenticate/);
      assert.match(doc, /resource_metadata/);
    }
  });
});
