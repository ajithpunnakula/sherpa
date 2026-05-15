import type { Chunk, Index, IndexedChunk, RetrievalHit } from "./types.js";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "how", "i", "in", "is", "it", "its",
  "of", "on", "or", "our", "she", "that", "the", "their", "them", "they",
  "this", "to", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "you", "your", "do", "does", "did", "if",
  "so", "not", "no", "yes", "than", "then", "us", "my", "me",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** BM25 parameters. */
const K1 = 1.4;
const B = 0.75;
const HEADING_BOOST = 1.5;

export function buildIndex(chunks: Chunk[], repoPath: string): Index {
  const indexed: IndexedChunk[] = chunks.map((c) => {
    const headingTokens = c.heading ? tokenize(c.heading) : [];
    const bodyTokens = tokenize(c.text);
    // Lightly upweight heading terms by repeating them — cheap "field boost".
    const tokens = [...headingTokens, ...headingTokens, ...bodyTokens];
    return { ...c, tokens };
  });

  const df: Record<string, number> = {};
  for (const c of indexed) {
    const seen = new Set<string>();
    for (const t of c.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df[t] = (df[t] ?? 0) + 1;
    }
  }

  const totalLen = indexed.reduce((s, c) => s + c.tokens.length, 0);
  const avgLen = indexed.length === 0 ? 0 : totalLen / indexed.length;

  return {
    builtAt: new Date().toISOString(),
    repoPath,
    chunks: indexed,
    df,
    avgLen,
  };
}

export function retrieve(index: Index, query: string, topK = 5): RetrievalHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || index.chunks.length === 0) return [];

  const N = index.chunks.length;
  const hits: RetrievalHit[] = [];

  for (const c of index.chunks) {
    let score = 0;
    const tf: Record<string, number> = {};
    for (const t of c.tokens) tf[t] = (tf[t] ?? 0) + 1;

    const len = c.tokens.length || 1;
    for (const q of qTokens) {
      const f = tf[q];
      if (!f) continue;
      const n = index.df[q] ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const headingHit = c.heading && tokenize(c.heading).includes(q) ? HEADING_BOOST : 1;
      score += headingHit * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / (index.avgLen || 1))));
    }

    if (score > 0) {
      const { tokens, ...chunk } = c;
      void tokens;
      hits.push({ chunk, score });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}
