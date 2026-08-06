export interface Doc {
  id: string;
  source?: "docs" | "api";
  product?: string | null;
  product_aliases?: string[];
  language?: string | null;
  method?: string | null;
  path?: string | null;
  title: string;
  description: string;
  body: string;
}

export interface SearchFilters {
  source?: "docs" | "api" | "all";
  product?: string;
  language?: string;
}

export interface SearchHit {
  id: string;
  source: string;
  product: string | null;
  language: string | null;
  method: string | null;
  path: string | null;
  title: string;
  description: string;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "on", "is",
  "are", "how", "do", "i", "my", "via", "using", "use"
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_+]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedDoc {
  doc: Doc;
  tf: Map<string, number>;
  length: number;
}

export class SearchIndex {
  private readonly docs: IndexedDoc[] = [];
  private readonly df = new Map<string, number>();
  private readonly byId = new Map<string, Doc>();

  constructor(docs: Doc[]) {
    for (const doc of docs) {
      const tokens = tokenize(`${doc.title} ${doc.title} ${doc.description} ${doc.body}`);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      for (const t of tf.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
      this.docs.push({ doc, tf, length: tokens.length });
      this.byId.set(doc.id, doc);
    }
  }

  get size(): number {
    return this.docs.length;
  }

  getDoc(id: string): Doc | undefined {
    return this.byId.get(id);
  }

  search(query: string, limit: number, filters: SearchFilters = {}): SearchHit[] {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0) return [];
    const productFilter = filters.product?.trim().toLowerCase();
    const n = this.docs.length;
    const avgLen = this.docs.reduce((a, d) => a + d.length, 0) / Math.max(1, n);
    const k1 = 1.4;
    const b = 0.75;

    const scored: Array<{ hit: IndexedDoc; score: number }> = [];
    for (const entry of this.docs) {
      const d = entry.doc;
      if (filters.source && filters.source !== "all" && (d.source ?? "docs") !== filters.source) continue;
      if (productFilter) {
        const indexedProducts = [d.product, ...(d.product_aliases ?? [])]
          .filter((product): product is string => typeof product === "string")
          .map((product) => product.toLowerCase());
        if (!indexedProducts.some((product) =>
          product === productFilter || product.startsWith(`${productFilter}-`)
        )) continue;
      }
      if (filters.language && d.language !== filters.language) continue;
      let score = 0;
      for (const q of qTokens) {
        const tf = entry.tf.get(q) ?? 0;
        if (tf === 0) continue;
        const df = this.df.get(q) ?? 1;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * entry.length) / avgLen));
      }
      if (score > 0) scored.push({ hit: entry, score });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, limit).map(({ hit, score }) => ({
      id: hit.doc.id,
      source: hit.doc.source ?? "docs",
      product: hit.doc.product ?? null,
      language: hit.doc.language ?? null,
      method: hit.doc.method ?? null,
      path: hit.doc.path ?? null,
      title: hit.doc.title,
      description: hit.doc.description,
      score: Number(score.toFixed(3)),
      snippet: makeSnippet(hit.doc.body, qTokens)
    }));
  }
}

function makeSnippet(body: string, qTokens: string[]): string {
  const lower = body.toLowerCase();
  let best = 0;
  for (const q of qTokens) {
    const i = lower.indexOf(q);
    if (i >= 0) {
      best = i;
      break;
    }
  }
  const start = Math.max(0, best - 80);
  return body
    .slice(start, start + 240)
    .replace(/\s+/g, " ")
    .trim();
}
