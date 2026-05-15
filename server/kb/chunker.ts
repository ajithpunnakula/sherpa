import type { Chunk } from "./types.js";

export interface ChunkerOptions {
  source: string;
  /** Target maximum characters per chunk. Defaults to 1200 (~300 tokens). */
  maxChars?: number;
}

/**
 * Split markdown into retrieval chunks.
 *
 * Strategy: walk the document top-down. Each H1/H2 starts a new section. Within
 * a section, paragraphs are joined until adding the next would exceed
 * `maxChars`, at which point a chunk is emitted and the next paragraph starts a
 * new chunk under the same heading. This preserves the heading as breadcrumb
 * context so we can cite it back to the user.
 */
export function chunkMarkdown(markdown: string, opts: ChunkerOptions): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const source = opts.source;

  if (!markdown.trim()) return [];

  // Drop fence markers but keep the code content — code is signal for retrieval.
  const cleaned = markdown.replace(/^```[\w-]*\s*$/gm, "").replace(/^```\s*$/gm, "");

  const lines = cleaned.split("\n");
  type Section = { heading?: string; paragraphs: string[] };
  const sections: Section[] = [{ paragraphs: [] }];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const para = buffer.join("\n").trim();
    if (para) sections[sections.length - 1]!.paragraphs.push(para);
    buffer = [];
  };

  for (const line of lines) {
    const h = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (h) {
      flushBuffer();
      sections.push({ heading: h[2], paragraphs: [] });
      continue;
    }
    if (line.trim() === "") {
      flushBuffer();
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();

  const chunks: Chunk[] = [];
  let idCounter = 0;

  for (const section of sections) {
    if (section.paragraphs.length === 0) continue;
    let current = "";
    const flushCurrent = () => {
      const text = current.trim();
      if (!text) return;
      const chunk: Chunk = {
        id: `${source}#${idCounter++}`,
        source,
        text,
      };
      if (section.heading) chunk.heading = section.heading;
      chunks.push(chunk);
      current = "";
    };

    for (const p of section.paragraphs) {
      if (!current) {
        current = p;
      } else if ((current.length + 2 + p.length) <= maxChars) {
        current = `${current}\n\n${p}`;
      } else {
        flushCurrent();
        current = p;
      }
      // If even a single paragraph overshoots, hard-split on sentences.
      if (current.length > maxChars) {
        const sentences = current.split(/(?<=[.!?])\s+/);
        let acc = "";
        for (const s of sentences) {
          if (!acc) {
            acc = s;
          } else if (acc.length + 1 + s.length <= maxChars) {
            acc = `${acc} ${s}`;
          } else {
            const text = acc.trim();
            if (text) {
              const chunk: Chunk = { id: `${source}#${idCounter++}`, source, text };
              if (section.heading) chunk.heading = section.heading;
              chunks.push(chunk);
            }
            acc = s;
          }
        }
        current = acc;
      }
    }
    flushCurrent();
  }

  return chunks;
}
