import React from "react";
import { useState } from "react";
import type { CopilotResult } from "../lib/cluely";

export function SuggestionCard({ result }: { result: CopilotResult }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const blocks = parseStructured(result.text);

  const copyAll = async () => {
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article className="suggestion-card">
      <header className="suggestion-head">
        <span className={`badge badge-${result.grounded ? "grounded" : "generic"}`}>
          {result.grounded ? "wiki-grounded" : "generic"}
        </span>
        <span className="muted">{result.model}</span>
        <span className="muted">· {result.latencyMs}ms</span>
        <button className="btn-ghost" onClick={copyAll} title="Copy full answer">
          {copied ? "copied" : "copy all"}
        </button>
      </header>

      <div className="suggestion-body">
        {blocks.length > 0
          ? blocks.map((b, i) => <CardBlock key={i} block={b} />)
          : <pre className="raw">{result.text}</pre>}
      </div>
    </article>
  );
}

interface ParsedBlock {
  kind: "say" | "why" | "followup" | "proof" | "risk" | "sources" | "subject" | "body" | "other";
  title: string;
  text: string;
}

function CardBlock({ block }: { block: ParsedBlock }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(block.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <section className={"block block-" + block.kind}>
      <div className="block-head">
        <h4>{block.title}</h4>
        <button className="btn-tiny" onClick={onCopy}>{copied ? "✓" : "copy"}</button>
      </div>
      <pre>{block.text}</pre>
    </section>
  );
}

/**
 * Parse the structured "sales card" format. We look for the canonical section
 * headers and split. If none are found, fall back to a single block.
 */
function parseStructured(raw: string): ParsedBlock[] {
  const sections: { match: RegExp; kind: ParsedBlock["kind"]; title: string }[] = [
    { match: /Recommended thing to say\s*:/i, kind: "say",      title: "Recommended thing to say" },
    { match: /Why this works\s*:/i,           kind: "why",      title: "Why this works" },
    { match: /Follow-up question\s*:/i,       kind: "followup", title: "Follow-up question" },
    { match: /Proof points\s*:/i,             kind: "proof",    title: "Proof points" },
    { match: /Risk\s*\/?\s*avoid saying\s*:/i,kind: "risk",     title: "Risk / avoid saying" },
    { match: /^Subject\s*:/im,                kind: "subject",  title: "Subject" },
    { match: /Sources(?:\s*used)?\s*:/i,      kind: "sources",  title: "Sources" },
  ];

  // Find matches with their positions
  const found: { idx: number; len: number; kind: ParsedBlock["kind"]; title: string }[] = [];
  for (const s of sections) {
    const m = s.match.exec(raw);
    if (m) found.push({ idx: m.index, len: m[0].length, kind: s.kind, title: s.title });
  }
  if (found.length === 0) return [];

  found.sort((a, b) => a.idx - b.idx);
  const blocks: ParsedBlock[] = [];
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]!;
    const next = found[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : raw.length;
    const text = raw.slice(start, end).trim();
    if (text) blocks.push({ kind: cur.kind, title: cur.title, text });
  }
  return blocks;
}
