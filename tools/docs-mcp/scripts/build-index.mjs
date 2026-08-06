// Build-time indexer producing a two-source corpus:
//   source=docs — SKILL.md/reference docs from skills/ + operational guides/
//   source=api  — per-operation entries split from sdk-reference/<lang>/<product>.md
// Written to dist/docs-index.json.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const GUIDES_DIR = join(REPO_ROOT, "guides");
const SDK_REF_DIR = join(SKILLS_DIR, "telnyx-twilio-migration", "sdk-reference");
const OUT = join(HERE, "..", "dist", "docs-index.json");

function* walk(dir, skip) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (skip.includes(entry)) continue;
      yield* walk(p, skip);
    } else if (entry.endsWith(".md")) {
      yield p;
    }
  }
}

const firstHeading = (t) => t.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
function frontmatterDescription(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const d = m[1].match(/description:\s*>?-?\s*\n?([\s\S]*?)(?:\n[a-z_]+:|$)/);
  return d ? d[1].replace(/\s+/g, " ").trim().slice(0, 300) : null;
}

function frontmatterMetadataValue(text, key) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) return null;
  const value = frontmatter.match(new RegExp(`^ {2}${key}:\\s*([^#\\n]+?)\\s*$`, "m"))?.[1]?.trim();
  if (!value) return null;
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}

// telnyx-<capability...>-<language> taxonomy → product + language
const LANGS = new Set(["curl", "go", "java", "javascript", "python", "ruby"]);
// Parent aliases that are not expressible by the normal hyphen taxonomy.
// Share this map across skill/reference and API entries so both sources honor
// the same product filters. For example, voice-media already matches parent
// "voice" without an alias.
const CROSS_FAMILY_PRODUCT_ALIASES = new Map([
  ["10dlc", ["numbers", "messaging"]],
  ["porting-in", ["numbers"]],
  ["porting-out", ["numbers"]],
  ["video", ["webrtc"]]
]);

function skillMeta(relPath) {
  const skill = relPath.split("/")[1] ?? "";
  const parts = skill.replace(/^telnyx-/, "").split("-");
  const language = LANGS.has(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
  const product = (language ? parts.slice(0, -1) : parts)[0] ?? null;
  return { product, language };
}

const docs = [];
let skillDocCount = 0;
let guideDocCount = 0;

// --- docs source ---
for (const file of walk(SKILLS_DIR, ["node_modules", "dist", ".git", "sdk-reference"])) {
  const text = readFileSync(file, "utf8");
  if (text.length < 100) continue;
  const rel = relative(REPO_ROOT, file);
  const inferred = skillMeta(rel);
  const product = frontmatterMetadataValue(text, "product") ?? inferred.product;
  const language = frontmatterMetadataValue(text, "language") ?? inferred.language;
  docs.push({
    id: rel,
    source: "docs",
    product,
    product_aliases: CROSS_FAMILY_PRODUCT_ALIASES.get(product) ?? [],
    language,
    title: firstHeading(text) ?? rel,
    description: frontmatterDescription(text) ?? "",
    body: text
  });
  skillDocCount++;
}

const GUIDE_PRODUCTS = new Map([
  ["10dlc-registration", "messaging"],
  ["ai-assistants", "ai"],
  ["edge-compute", "edge"],
  ["email", "email"],
  ["mpp-payments", "payments"],
  ["phone-numbers", "numbers"],
  ["phone-verification", "verify"],
  ["porting-orders", "porting"],
  ["rcs-messaging", "messaging"],
  ["sms-messaging", "messaging"],
  ["voice-call-control", "voice"],
  ["webhooks", "webhooks"],
  ["wireguard-networking", "networking"],
  ["x402-payments", "payments"]
]);
const GUIDE_PRODUCT_ALIASES = new Map([
  ["10dlc-registration", ["numbers"]],
  ["porting-orders", ["numbers"]],
  ["rcs-messaging", ["rcs"]]
]);

if (existsSync(GUIDES_DIR)) {
  for (const file of walk(GUIDES_DIR, ["node_modules", "dist", ".git"])) {
    const text = readFileSync(file, "utf8");
    if (text.length < 100) continue;
    const rel = relative(REPO_ROOT, file);
    const guideName = basename(file, ".md");
    docs.push({
      id: rel,
      source: "docs",
      product: GUIDE_PRODUCTS.get(guideName) ?? null,
      product_aliases: GUIDE_PRODUCT_ALIASES.get(guideName) ?? [],
      language: null,
      title: firstHeading(text) ?? rel,
      description: "",
      body: text
    });
    guideDocCount++;
  }
}

// --- api source: split per-operation sections ---
if (existsSync(SDK_REF_DIR)) {
  for (const lang of readdirSync(SDK_REF_DIR)) {
    const langDir = join(SDK_REF_DIR, lang);
    if (!statSync(langDir).isDirectory()) continue;
    for (const f of readdirSync(langDir).filter((x) => x.endsWith(".md"))) {
      const product = basename(f, ".md");
      const text = readFileSync(join(langDir, f), "utf8");
      // Split at ## and ### so per-operation subsections inside big task
      // sections become individual entries; keep only sections that actually
      // document an endpoint (setup/installation prose is covered by guides).
      const sections = text.split(/^(?=##{1,2} )/m);
      const seen = new Set();
      for (const section of sections) {
        const m = section.match(/^##{1,2} (.+)$/m);
        if (!m) continue;
        const title = m[1].trim();
        const endpoint = section.match(/`(GET|POST|PATCH|PUT|DELETE)\s+([^`]+)`/);
        if (!endpoint || section.length < 80) continue;
        const endpointPath = endpoint[2].trim();
        const productAliases = new Set(CROSS_FAMILY_PRODUCT_ALIASES.get(product) ?? []);
        if (/^\/(?:v2\/)?number_lookup(?:\/|$)/.test(endpointPath)) {
          productAliases.add("lookup");
        }
        let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
        while (seen.has(slug)) slug += "-x";
        seen.add(slug);
        docs.push({
          id: `op::telnyx::${lang}::${product}::${slug}`,
          source: "api",
          product,
          product_aliases: [...productAliases],
          language: lang,
          method: endpoint[1],
          path: endpointPath,
          title,
          description: `${endpoint[1]} ${endpointPath}`,
          body: section
        });
      }
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ built_from: "team-telnyx/ai skills + guides + sdk-reference", doc_count: docs.length, docs }));
const api = docs.filter((d) => d.source === "api").length;
console.log(`indexed ${docs.length} docs (${skillDocCount} skills/reference, ${guideDocCount} guides, ${api} api operations) -> ${relative(process.cwd(), OUT)}`);
