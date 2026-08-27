// Build-time indexer producing a two-source corpus:
//   source=docs — SKILL.md/reference docs from skills/ + operational guides/
//   source=api  — per-operation entries split from sdk-reference/<lang>/<product>.md
// Written to dist/docs-index.json.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeRelativePath,
  skillDirectoryFromRelativePath
} from "./path-utils.mjs";
import {
  frontmatterDescription,
  frontmatterMetadataValue
} from "./frontmatter.mjs";

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
  const skill = skillDirectoryFromRelativePath(relPath);
  const parts = skill.replace(/^telnyx-/, "").split("-");
  const language = LANGS.has(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
  const product = (language ? parts.slice(0, -1) : parts)[0] ?? null;
  return { product, language };
}

const parentSkillMetadataCache = new Map();
function parentSkillMetadata(relPath) {
  const skillDirectory = skillDirectoryFromRelativePath(relPath);
  if (!skillDirectory) return { product: null, language: null };
  const cached = parentSkillMetadataCache.get(skillDirectory);
  if (cached) return cached;

  const skillFile = join(SKILLS_DIR, skillDirectory, "SKILL.md");
  const metadata = existsSync(skillFile)
    ? (() => {
        const skillText = readFileSync(skillFile, "utf8");
        return {
          product: frontmatterMetadataValue(skillText, "product"),
          language: frontmatterMetadataValue(skillText, "language")
        };
      })()
    : { product: null, language: null };
  parentSkillMetadataCache.set(skillDirectory, metadata);
  return metadata;
}

const docs = [];
let skillDocCount = 0;
let guideDocCount = 0;

function operationsFromSection(section) {
  const heading = section.match(/^##{1,2} (.+)$/m)?.[1]?.trim();
  if (!heading) return [];

  // Generated "Additional Operations" sections encode many independent API
  // operations as Markdown table rows. Treat every row as its own searchable
  // document; assigning the first row's method/path to the whole table makes
  // every sibling operation undiscoverable or incorrectly attributed.
  const tableMatches = [...section.matchAll(
    /^\|\s*([^|\n]+?)\s*\|[^\n]*?`(GET|POST|PATCH|PUT|DELETE)\s+([^`]+)`[^\n]*$/gm
  )];
  const sharedTableContext = tableMatches.length > 0
    ? section
        .slice(0, tableMatches[0].index)
        .replace(/^##{1,2} .+\n+/, "")
        .trim()
    : "";
  const tableOperations = tableMatches.map((match) => ({
    title: match[1].trim(),
    method: match[2],
    path: match[3].trim(),
    // Keep the shared safety guidance, schema link, and table columns on every
    // derived document so retrieval remains actionable after splitting rows.
    body: `### ${match[1].trim()}\n\n${sharedTableContext}\n${match[0].trim()}`
  }));
  if (tableOperations.length > 0) return tableOperations;

  const endpoint = section.match(/`(GET|POST|PATCH|PUT|DELETE)\s+([^`]+)`/);
  if (!endpoint || section.length < 80) return [];
  return [{
    title: heading,
    method: endpoint[1],
    path: endpoint[2].trim(),
    body: section
  }];
}

// --- docs source ---
for (const file of walk(SKILLS_DIR, ["node_modules", "dist", ".git", "sdk-reference"])) {
  const text = readFileSync(file, "utf8");
  if (text.length < 100) continue;
  const rel = normalizeRelativePath(relative(REPO_ROOT, file));
  const inferred = skillMeta(rel);
  const parent = parentSkillMetadata(rel);
  // Reference/template documents commonly omit frontmatter. Inherit the
  // containing skill's declared taxonomy before falling back to directory
  // inference so filtered searches include the whole skill, not only SKILL.md.
  const product = frontmatterMetadataValue(text, "product")
    ?? parent.product
    ?? inferred.product;
  const language = frontmatterMetadataValue(text, "language")
    ?? parent.language
    ?? inferred.language;
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
    const rel = normalizeRelativePath(relative(REPO_ROOT, file));
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
        for (const operation of operationsFromSection(section)) {
          const productAliases = new Set(CROSS_FAMILY_PRODUCT_ALIASES.get(product) ?? []);
          if (/^\/(?:v2\/)?number_lookup(?:\/|$)/.test(operation.path)) {
            productAliases.add("lookup");
          }
          let slug = operation.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
          while (seen.has(slug)) slug += "-x";
          seen.add(slug);
          docs.push({
            id: `op::telnyx::${lang}::${product}::${slug}`,
            source: "api",
            product,
            product_aliases: [...productAliases],
            language: lang,
            method: operation.method,
            path: operation.path,
            title: operation.title,
            description: `${operation.method} ${operation.path}`,
            body: operation.body
          });
        }
      }
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ built_from: "team-telnyx/ai skills + guides + sdk-reference", doc_count: docs.length, docs }));
const api = docs.filter((d) => d.source === "api").length;
console.log(`indexed ${docs.length} docs (${skillDocCount} skills/reference, ${guideDocCount} guides, ${api} api operations) -> ${normalizeRelativePath(relative(process.cwd(), OUT))}`);
