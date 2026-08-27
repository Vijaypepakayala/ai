import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SearchIndex, type Doc } from "./search.js";

const SERVER_NAME = "telnyx-docs";
const SERVER_VERSION = "0.1.0";
const MAX_RETRIEVE_CHARS = 40_000;
const MAX_SEARCH_QUERY_CHARS = 2_000;
const MAX_PRODUCT_FILTER_CHARS = 100;
const MAX_DOC_ID_CHARS = 512;

export function loadIndex(indexPath?: string): SearchIndex {
  const here = dirname(fileURLToPath(import.meta.url));
  // Built index lives in dist/; support running from dist (built) and from
  // src (tsx/vitest) without configuration.
  const candidates = indexPath
    ? [indexPath]
    : [join(here, "docs-index.json"), join(here, "..", "dist", "docs-index.json")];
  for (const path of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { docs: Doc[] };
      return new SearchIndex(raw.docs);
    } catch {
      continue;
    }
  }
  throw new Error(
    `docs-index.json not found (tried: ${candidates.join(", ")}). Run 'npm run build:index' first.`
  );
}

export function createServer(index: SearchIndex): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "telnyx__search",
    {
      title: "Search Telnyx documentation",
      description:
        "Natural-language search over Telnyx documentation. Use source=\"docs\" for guides/skills (setup, migration, concepts), source=\"api\" for specific API operations with full request/response schemas, or source=\"all\" (default). Filter by product (messaging, voice, verify, fax, numbers, webrtc, iot, video, lookup, texml, ...) and an indexed SDK language. Read-only, no account access. Pass returned ids to telnyx__retrieve.",
      annotations: {
        title: "Search Telnyx documentation",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        query: z.string().min(2).max(MAX_SEARCH_QUERY_CHARS)
          .describe("What you want to do, e.g. 'send an SMS' or 'migrate Twilio TwiML to TeXML'"),
        source: z.enum(["docs", "api", "all"]).default("all"),
        product: z.string().max(MAX_PRODUCT_FILTER_CHARS).trim().min(1).toLowerCase().optional()
          .describe("Restrict to a parent product, e.g. messaging, voice, verify; includes hyphenated subproducts and documented cross-family aliases"),
        language: z.enum([
          "curl",
          "python",
          "javascript",
          "typescript",
          "go",
          "java",
          "kotlin",
          "ruby",
          "dart",
          "swift"
        ]).optional(),
        limit: z.number().int().min(1).max(10).default(5)
      }
    },
    async ({ query, source, product, language, limit }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ results: index.search(query, limit, { source, product, language }) })
        }
      ]
    })
  );

  server.registerTool(
    "telnyx__retrieve",
    {
      title: "Retrieve Telnyx docs",
      description:
        "Fetch full content for one or more ids copied verbatim from telnyx__search results — do not construct or guess ids. Batch related ids in one call (max 10). Long docs paginate via offset; the response reports total_chars and has_more. Read-only.",
      annotations: {
        title: "Retrieve Telnyx docs",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        ids: z.array(z.string().min(1).max(MAX_DOC_ID_CHARS)).min(1).max(10)
          .describe("Ids from telnyx__search, verbatim"),
        offset: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .default(0)
          .describe("Character offset applied to each doc (for paging one long doc, pass a single id)")
      }
    },
    async ({ ids, offset }) => {
      const out = [];
      let anyFound = false;
      const perDocBudget = Math.max(4_000, Math.floor(MAX_RETRIEVE_CHARS / ids.length));
      for (const id of ids) {
        const doc = index.getDoc(id);
        if (!doc) {
          out.push({ id, error: `no doc with id '${id}' — use telnyx__search to find valid ids` });
          continue;
        }
        anyFound = true;
        const total = doc.body.length;
        let chunk = doc.body.slice(offset, offset + perDocBudget);
        // never end a chunk on a lone high surrogate
        if (/[\uD800-\uDBFF]$/.test(chunk)) chunk = chunk.slice(0, -1);
        out.push({
          id: doc.id,
          title: doc.title,
          total_chars: total,
          offset,
          has_more: offset + chunk.length < total,
          content: chunk
        });
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(out) }],
        ...(anyFound ? {} : { isError: true })
      };
    }
  );

  return server;
}
