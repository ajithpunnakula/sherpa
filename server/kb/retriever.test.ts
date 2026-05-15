import { describe, it, expect } from "vitest";
import { buildIndex, retrieve, tokenize } from "./retriever.js";
import type { Chunk } from "./types.js";

const sample: Chunk[] = [
  { id: "a#0", source: "wiki/Pricing.md", heading: "Pricing", text: "CoffeeAndAI offers a free tier and paid plans for teams." },
  { id: "b#0", source: "wiki/Tutor.md", heading: "AI Tutor", text: "The AI tutor uses Claude with five layers of context: card, prerequisites, related pages, learner profile, conversation history." },
  { id: "c#0", source: "wiki/Adaptive.md", heading: "Adaptive Learning", text: "Cards are reordered by domain mastery. Weak domains are prioritized, mastered pages are skipped." },
  { id: "d#0", source: "wiki/Compare.md", heading: "vs ChatGPT", text: "Unlike generic ChatGPT, CoffeeAndAI is grounded in a curated wiki and uses a concept prerequisite graph." },
  { id: "e#0", source: "wiki/Random.md", heading: "Other", text: "Coffee is delicious in the morning. Latte art is a craft." },
];

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });
  it("drops short stopwords", () => {
    const tokens = tokenize("the a of and quick");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).toContain("quick");
  });
});

describe("buildIndex + retrieve (BM25)", () => {
  it("returns the most relevant chunk first", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "how is this different from ChatGPT?", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.source).toBe("wiki/Compare.md");
  });

  it("ranks pricing query to the pricing chunk", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "what does pricing look like for teams", 3);
    expect(hits[0]!.chunk.source).toBe("wiki/Pricing.md");
  });

  it("returns empty for nonsense / unknown vocabulary", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "zzzzzz qqqqqqq", 3);
    expect(hits).toEqual([]);
  });

  it("respects topK", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "AI tutor card prerequisite", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("scores are non-negative and descending", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "adaptive learning mastery card", 5);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(0);
  });

  it("boosts matches that appear in the heading", () => {
    const idx = buildIndex(sample, "/tmp/repo");
    const hits = retrieve(idx, "pricing", 3);
    expect(hits[0]!.chunk.heading).toBe("Pricing");
  });
});
