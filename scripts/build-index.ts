#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chunkMarkdown } from "../server/kb/chunker.js";
import { buildIndex } from "../server/kb/retriever.js";
import type { Chunk } from "../server/kb/types.js";

const REPO = process.env.COFFEEANDAI_REPO ?? resolve(process.env.HOME ?? "", "code/coffeeandai");
const OUT = resolve(process.cwd(), ".data/index.json");

// Source paths to crawl (relative to the repo). Read-only.
const TARGETS: { path: string; recursive: boolean }[] = [
  { path: "wiki", recursive: true },
  { path: "raw", recursive: true },
  { path: "courses", recursive: true },
  { path: "README.md", recursive: false },
  { path: "architecture.md", recursive: false },
  { path: "STATUS.md", recursive: false },
  { path: "CLAUDE.md", recursive: false },
  { path: "PLAN.md", recursive: false },
];

const EXTS = new Set([".md", ".mdx", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "dist", "build", ".next", "test-results"]);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full);
    } else if (ent.isFile()) {
      const ext = ent.name.slice(ent.name.lastIndexOf(".")).toLowerCase();
      if (EXTS.has(ext)) yield full;
    }
  }
}

async function main(): Promise<void> {
  console.log(`Cluely indexer`);
  console.log(`  Source repo: ${REPO}`);
  console.log(`  Output:      ${OUT}`);

  try {
    await fs.access(REPO);
  } catch {
    console.error(`\nERROR: Cannot read source repo at ${REPO}.`);
    console.error(`Set COFFEEANDAI_REPO env var or clone https://github.com/ajithpunnakula/coffeeandai there.`);
    process.exit(1);
  }

  const files: string[] = [];
  for (const t of TARGETS) {
    const full = join(REPO, t.path);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory() && t.recursive) {
      for await (const f of walk(full)) files.push(f);
    } else if (stat.isFile()) {
      files.push(full);
    }
  }

  const allChunks: Chunk[] = [];
  let totalBytes = 0;
  for (const f of files) {
    const rel = relative(REPO, f);
    let content: string;
    try {
      content = await fs.readFile(f, "utf8");
    } catch (err) {
      console.warn(`  skip ${rel}: ${(err as Error).message}`);
      continue;
    }
    totalBytes += content.length;
    const chunks = chunkMarkdown(content, { source: rel, maxChars: 1200 });
    allChunks.push(...chunks);
  }

  console.log(`  Files:       ${files.length}`);
  console.log(`  Bytes read:  ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`  Chunks:      ${allChunks.length}`);

  const index = buildIndex(allChunks, REPO);
  await fs.mkdir(resolve(process.cwd(), ".data"), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(index));

  const sizeKb = ((await fs.stat(OUT)).size / 1024).toFixed(1);
  console.log(`  Index size:  ${sizeKb} KB`);
  console.log(`  Built at:    ${index.builtAt}`);
  console.log(`\nDone. Run \`npm run dev\` to launch the copilot.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
