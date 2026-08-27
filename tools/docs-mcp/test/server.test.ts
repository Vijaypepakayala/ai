import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createServer, loadIndex } from "../src/server.js";
import { SearchIndex } from "../src/search.js";

const index = loadIndex();
const supportedLanguages = ["curl", "go", "java", "javascript", "python", "ruby"];
const crossFamilySkillCases = [
  { parent: "numbers", capability: "10dlc", product: "10dlc", query: "10DLC brand campaign registration" },
  { parent: "messaging", capability: "10dlc", product: "10dlc", query: "10DLC brand campaign registration" },
  { parent: "numbers", capability: "porting-in", product: "porting-in", query: "port phone numbers into Telnyx LOA" },
  { parent: "numbers", capability: "porting-out", product: "porting-out", query: "manage port-out requests status" },
  { parent: "webrtc", capability: "video", product: "video", query: "create manage video rooms conferencing" }
].flatMap(({ parent, capability, product, query }) =>
  supportedLanguages.map((language) => ({ parent, capability, product, query, language }))
);

async function connected() {
  const server = createServer(index);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe("corpus", () => {
  it("indexes a substantial docs corpus", () => {
    expect(index.size).toBeGreaterThan(4000);
  });

  it("indexes canonical operational guides with searchable product metadata", async () => {
    const client = await connected();
    const search = await client.callTool({
      name: "telnyx__search",
      arguments: {
        query: "WireGuard Ashburn cloud VPN gateway",
        source: "docs",
        product: "networking",
        limit: 5
      }
    });
    const { results } = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    const guide = results.find((result: { id: string }) => result.id === "guides/wireguard-networking.md");
    expect(guide).toMatchObject({ source: "docs", product: "networking", language: null });

    const retrieved = await client.callTool({
      name: "telnyx__retrieve",
      arguments: { ids: [guide.id] }
    });
    const [document] = JSON.parse((retrieved.content as Array<{ text: string }>)[0].text);
    expect(document.content).toContain("# WireGuard Networking");
    expect(document.content).toContain("POST /v2/wireguard_interfaces");
  });

  it("honors declared frontmatter product over the name-inferred one", async () => {
    // skills/telnyx-twilio-migration declares `product: migration` while its
    // directory name would infer `twilio` — the index must trust frontmatter.
    const client = await connected();
    const search = await client.callTool({
      name: "telnyx__search",
      arguments: {
        query: "migrate twilio application to telnyx",
        source: "docs",
        product: "migration",
        limit: 10
      }
    });
    const { results } = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    expect(results.some((result: { id: string; product: string }) =>
      result.id === "skills/telnyx-twilio-migration/SKILL.md" && result.product === "migration"
    )).toBe(true);
  });

  it("inherits parent skill metadata for child reference documents", () => {
    const migrationReference = "skills/telnyx-twilio-migration/references/video-migration.md";
    expect(index.getDoc(migrationReference)).toMatchObject({
      product: "migration",
      language: null
    });
    expect(
      index.search("Twilio Video Rooms client tokens", 20, {
        source: "docs",
        product: "migration"
      }).some((result) => result.id === migrationReference)
    ).toBe(true);

    const assistantReference = "skills/telnyx-ai-assistants-python/references/api-details.md";
    expect(index.getDoc(assistantReference)).toMatchObject({
      product: "ai-assistants",
      language: "python"
    });
    expect(
      index.search("dynamic variables webhook timeout", 20, {
        source: "docs",
        product: "ai-assistants",
        language: "python"
      }).some((result) => result.id === assistantReference)
    ).toBe(true);
  });

  it.each(crossFamilySkillCases)(
    "finds $product/$language skill docs through parent $parent",
    async ({ parent, capability, product, query, language }) => {
      const client = await connected();
      const search = await client.callTool({
        name: "telnyx__search",
        arguments: {
          query,
          source: "docs",
          product: parent,
          language,
          limit: 10
        }
      });
      const { results } = JSON.parse((search.content as Array<{ text: string }>)[0].text);
      expect(
        results.some((result: { id: string; product: string; language: string }) =>
          result.id.startsWith(`skills/telnyx-${capability}-${language}/`)
          && result.product === product
          && result.language === language
        ),
        `${product}/${language} docs should be reachable through product=${parent}`
      ).toBe(true);
    }
  );
});

describe("tools", () => {
  it("exposes exactly the two read-only tools with complete safety annotations", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["telnyx__retrieve", "telnyx__search"]);
    for (const t of tools) {
      expect(t.annotations?.title).toBe(t.title);
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      expect(t.annotations?.idempotentHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(false);
    }
  });

  it("search finds the SMS-in-Python skill for a natural query", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "send an SMS text message in Python", limit: 5 }
    });
    const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r: { id: string }) => /messaging|sms/.test(r.id) && /python/.test(r.id))).toBe(true);
  });

  it("search finds the Twilio migration skill", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "migrate from Twilio TwiML to TeXML", limit: 5 }
    });
    const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(results.some((r: { id: string }) => r.id.includes("twilio-migration"))).toBe(true);
  });

  it("retrieve returns full content by id and paginates long docs", async () => {
    const client = await connected();
    const search = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "TeXML verbs reference", limit: 3 }
    });
    const { results } = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    const id = results[0].id;
    const res = await client.callTool({ name: "telnyx__retrieve", arguments: { ids: [id], offset: 0 } });
    const doc = JSON.parse((res.content as Array<{ text: string }>)[0].text)[0];
    expect(doc.id).toBe(id);
    expect(doc.content.length).toBeGreaterThan(100);
    expect(typeof doc.has_more).toBe("boolean");
    if (doc.has_more) {
      const page2 = await client.callTool({
        name: "telnyx__retrieve",
        arguments: { ids: [id], offset: doc.content.length }
      });
      const d2 = JSON.parse((page2.content as Array<{ text: string }>)[0].text)[0];
      expect(d2.offset).toBe(doc.content.length);
      expect(d2.content.length).toBeGreaterThan(0);
    }
  });

  it("retrieve with an unknown id errors cleanly", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__retrieve",
      arguments: { ids: ["not/a/real/doc.md"] }
    });
    expect(res.isError).toBe(true);
    const rows = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(rows[0].error).toContain("not/a/real/doc.md");
  });

  it("rejects oversized search terms and document ids at the schema boundary", async () => {
    const client = await connected();
    const oversizedQuery = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "q".repeat(2_001) }
    });
    expect(oversizedQuery.isError).toBe(true);

    const oversizedId = await client.callTool({
      name: "telnyx__retrieve",
      arguments: { ids: ["x".repeat(513)] }
    });
    expect(oversizedId.isError).toBe(true);
  });
});

describe("two-source corpus (Twilio parity+)", () => {
  it("indexes every table-listed API operation as an independent document", () => {
    const repoRoot = resolve(process.cwd(), "../..");
    const sdkReferenceRoot = join(
      repoRoot,
      "skills/telnyx-twilio-migration/sdk-reference"
    );
    const built = JSON.parse(
      readFileSync(join(process.cwd(), "dist/docs-index.json"), "utf8")
    ) as {
      docs: Array<{
        source: string;
        language: string | null;
        product: string | null;
        title: string;
        method: string | null;
        path: string | null;
        body: string;
      }>;
    };
    const indexedDocs = new Map(
      built.docs
        .filter((doc) => doc.source === "api")
        .map((doc) => [
          [doc.language, doc.product, doc.title, doc.method, doc.path].join("\u0000"),
          doc
        ] as const)
    );
    const expectedKeys: string[] = [];

    for (const language of readdirSync(sdkReferenceRoot)) {
      const languageDir = join(sdkReferenceRoot, language);
      if (!statSync(languageDir).isDirectory()) continue;
      for (const filename of readdirSync(languageDir).filter((name) => name.endsWith(".md"))) {
        const product = basename(filename, ".md");
        const text = readFileSync(join(languageDir, filename), "utf8");
        for (const match of text.matchAll(
          /^\|\s*([^|\n]+?)\s*\|[^\n]*?`(GET|POST|PATCH|PUT|DELETE)\s+([^`]+)`[^\n]*$/gm
        )) {
          expectedKeys.push(
            [language, product, match[1].trim(), match[2], match[3].trim()].join("\u0000")
          );
        }
      }
    }

    expect(expectedKeys.length).toBeGreaterThan(100);
    for (const key of expectedKeys) {
      const indexed = indexedDocs.get(key);
      expect(indexed, `missing independent API index entry: ${key}`).toBeDefined();
      expect(indexed?.body).toContain("Before using any operation below");
      expect(indexed?.body).toContain("response-schemas");
      expect(indexed?.body).toContain("| Operation | SDK method | Endpoint |");
    }
    expect(
      built.docs.some((doc) => doc.source === "api" && doc.title === "Additional Operations")
    ).toBe(false);

    const deleteBrand = built.docs.find((doc) =>
      doc.language === "curl" && doc.product === "10dlc" && doc.title === "Delete Brand"
    );
    expect(deleteBrand).toMatchObject({ method: "DELETE", path: "/10dlc/brand/{brandId}" });
  });

  it("api search finds the messages send operation with method/path", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "send an sms message", source: "api", product: "messaging", limit: 5 }
    });
    const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(results.length).toBeGreaterThan(0);
    const send = results.find((r: { path: string | null; method: string | null }) =>
      r.method === "POST" && (r.path ?? "").includes("/messages"));
    expect(send, "POST /messages operation in top results").toBeTruthy();
  });

  it("parent voice filter includes API operations from every voice subproduct", async () => {
    const client = await connected();
    for (const [query, pathFragment] of [
      ["playback_start", "/actions/playback_start"],
      ["record_start", "/actions/record_start"],
      ["gather_using_speak", "/actions/gather_using_speak"]
    ]) {
      const res = await client.callTool({
        name: "telnyx__search",
        arguments: {
          query,
          source: "api",
          product: " Voice ",
          language: "javascript",
          limit: 5
        }
      });
      const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(
        results.some((result: { path: string | null }) => result.path?.includes(pathFragment)),
        `${query} should be reachable through product=voice`
      ).toBe(true);
      expect(results.every((result: { product: string }) =>
        result.product === "voice" || result.product.startsWith("voice-"))).toBe(true);
    }
  });

  it("finds 10DLC API operations through both advertised parent products", async () => {
    const client = await connected();
    for (const product of ["numbers", "messaging"]) {
      const res = await client.callTool({
        name: "telnyx__search",
        arguments: {
          query: "10DLC campaign brand registration",
          source: "api",
          product,
          language: "javascript",
          limit: 10
        }
      });
      const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(
        results.some((result: { id: string }) => result.id.includes("::10dlc::")),
        `10DLC operations should be reachable through product=${product}`
      ).toBe(true);
    }
  });

  it("maps only the real Number Lookup operation into the lookup product", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__search",
      arguments: {
        query: "phone number carrier portability lookup",
        source: "api",
        product: "lookup",
        language: "javascript",
        limit: 10
      }
    });
    const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result: { path: string }) =>
      /^\/(?:v2\/)?number_lookup(?:\/|$)/.test(result.path)
    )).toBe(true);
  });

  it("language filter returns only that SDK's operations (Twilio has no such filter)", async () => {
    const client = await connected();
    const res = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "send message", source: "api", language: "python", limit: 8 }
    });
    const { results } = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.language).toBe("python");
  });

  it("batch retrieve returns per-id rows including per-id errors", async () => {
    const client = await connected();
    const search = await client.callTool({
      name: "telnyx__search",
      arguments: { query: "send an sms", source: "api", limit: 2 }
    });
    const { results } = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    const res = await client.callTool({
      name: "telnyx__retrieve",
      arguments: { ids: [results[0].id, "op::telnyx::fake::none::missing"] }
    });
    expect(res.isError ?? false).toBe(false);
    const rows = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(rows).toHaveLength(2);
    expect(rows[0].content.length).toBeGreaterThan(50);
    expect(rows[1].error).toContain("missing");
  });

  it("both tools carry complete applicable annotations like the Twilio connector", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.annotations?.title).toBe(t.title);
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      expect(t.annotations?.idempotentHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(false);
    }
  });
});

describe("ranking sanity", () => {
  it("prefers title matches over incidental body mentions", () => {
    const idx = new SearchIndex([
      { id: "a", title: "Send SMS with Python", description: "", body: "irrelevant filler text" },
      { id: "b", title: "Voice conferencing", description: "", body: "you could also send sms python here maybe" }
    ]);
    const hits = idx.search("send sms python", 2);
    expect(hits[0].id).toBe("a");
  });

  it("matches parent product families only at a hyphen boundary", () => {
    const idx = new SearchIndex([
      { id: "base", product: "voice", title: "Shared operation", description: "", body: "shared" },
      { id: "child", product: "voice-media", title: "Shared playback", description: "", body: "shared" },
      { id: "collision", product: "voicemail", title: "Shared inbox", description: "", body: "shared" },
      {
        id: "aliased",
        product: "10dlc",
        product_aliases: ["numbers", "messaging"],
        title: "Shared campaign",
        description: "",
        body: "shared"
      }
    ]);
    const hits = idx.search("shared", 10, { product: "VOICE" });
    expect(hits.map((hit) => hit.id).sort()).toEqual(["base", "child"]);
    expect(idx.search("shared", 10, { product: "numbers" }).map((hit) => hit.id)).toEqual(["aliased"]);
    expect(idx.search("shared", 10, { product: "messaging" }).map((hit) => hit.id)).toEqual(["aliased"]);
  });
});
