import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "./chunker.js";

describe("chunkMarkdown", () => {
  it("returns a single chunk for short docs", () => {
    const chunks = chunkMarkdown("hello world", { source: "a.md" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("hello world");
    expect(chunks[0]!.source).toBe("a.md");
    expect(chunks[0]!.heading).toBeUndefined();
  });

  it("splits on top-level headings and tracks heading per chunk", () => {
    const md = [
      "# Intro",
      "intro body",
      "",
      "## Section A",
      "body of A",
      "",
      "## Section B",
      "body of B",
    ].join("\n");
    const chunks = chunkMarkdown(md, { source: "x.md", maxChars: 50 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const headings = chunks.map((c) => c.heading).filter(Boolean);
    expect(headings).toContain("Intro");
    expect(headings).toContain("Section A");
    expect(headings).toContain("Section B");
  });

  it("further splits long sections into multiple chunks at paragraph boundaries", () => {
    const para = "lorem ipsum ".repeat(40); // ~480 chars
    const md = `# Big Section\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = chunkMarkdown(md, { source: "big.md", maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.heading).toBe("Big Section");
      expect(c.text.length).toBeLessThanOrEqual(700); // allow a little slack
    }
  });

  it("assigns ascending ids per source", () => {
    const md = "# A\n\nfoo\n\n# B\n\nbar";
    const chunks = chunkMarkdown(md, { source: "doc.md" });
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("doc.md#0");
  });

  it("ignores empty input", () => {
    expect(chunkMarkdown("", { source: "empty.md" })).toEqual([]);
    expect(chunkMarkdown("   \n  \n", { source: "empty.md" })).toEqual([]);
  });

  it("strips code fences markers but keeps code content", () => {
    const md = "# T\n\nhere is code:\n\n```ts\nconst x = 1;\n```\n\ndone";
    const chunks = chunkMarkdown(md, { source: "c.md" });
    const joined = chunks.map((c) => c.text).join("\n");
    expect(joined).toContain("const x = 1;");
  });
});
