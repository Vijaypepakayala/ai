#!/usr/bin/env node

import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(
  repoRoot,
  "providers",
  "claude",
  "plugins",
  "telnyx-developer-kit",
);
const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
const marketplacePath = path.join(repoRoot, ".claude-plugin", "marketplace.json");
const builderPath = path.join(pluginRoot, "agents", "telnyx-builder.md");

const connectorUrl = "https://api.telnyx.com/v2/ai/mcp";
const expectedSkills = [
  "telnyx-kit-architecture-patterns",
  "telnyx-kit-debugging",
  "telnyx-kit-guardrails",
  "telnyx-kit-product-navigator",
  "telnyx-kit-quickstart",
  "telnyx-kit-twilio-switch",
];
const expectedTools = [
  "list_api_endpoints",
  "get_api_endpoint_schema",
  "lookup_phone_number",
  "get_call_status",
  "list_call_events",
  "search_recordings",
];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function assertNoSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    assert.equal((await lstat(target)).isSymbolicLink(), false, `symlink: ${target}`);
    if (entry.isDirectory()) await assertNoSymlinks(target);
  }
}

async function main() {
  const manifest = await readJson(manifestPath);
  assert.equal(manifest.name, "telnyx-developer-kit");
  assert.deepEqual(Object.keys(manifest.mcpServers ?? {}), ["telnyx"]);
  assert.deepEqual(manifest.mcpServers.telnyx, {
    type: "http",
    url: connectorUrl,
  });
  assert.equal("userConfig" in manifest, false, "manifest must use OAuth, not API-key config");

  const skills = (await readdir(path.join(pluginRoot, "skills"))).sort();
  assert.deepEqual(skills, expectedSkills);
  const agents = (await readdir(path.join(pluginRoot, "agents"))).sort();
  assert.deepEqual(agents, ["telnyx-builder.md"]);

  for (const skill of expectedSkills) {
    const canonical = await readFile(path.join(repoRoot, "skills", skill, "SKILL.md"));
    const packaged = await readFile(path.join(pluginRoot, "skills", skill, "SKILL.md"));
    assert.deepEqual(packaged, canonical, `${skill} differs from its canonical source`);
  }

  const builder = await readFile(builderPath, "utf8");
  for (const tool of expectedTools) {
    assert.match(builder, new RegExp(`\\b${tool}\\b`), `builder omits ${tool}`);
  }
  assert.doesNotMatch(builder, /\binvoke_api_endpoint\b/);
  assert.match(builder, /explicit user approval/i);
  assert.match(builder, /confirm_billable_lookup:\s*true/);

  const pluginText = await readFile(manifestPath, "utf8");
  assert.doesNotMatch(pluginText, /telnyx_api_key|user_config|authorization/i);
  assert.doesNotMatch(pluginText, /https:\/\/api\.telnyx\.com\/v2\/mcp(?:["/]|$)/);

  const marketplace = await readJson(marketplacePath);
  const entries = marketplace.plugins.filter(({ name }) => name === manifest.name);
  assert.equal(entries.length, 1, "marketplace must contain exactly one developer-kit entry");
  assert.equal(entries[0].source, "./providers/claude/plugins/telnyx-developer-kit");
  assert.equal(entries[0].version, manifest.version);

  await assertNoSymlinks(pluginRoot);
  console.log("Claude developer-kit connector contract: OK");
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
