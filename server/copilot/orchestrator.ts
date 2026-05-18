import type { Index, RetrievalHit } from "../kb/types.js";
import { retrieve } from "../kb/retriever.js";
import { getMode, type ModeId } from "./modes.js";
import type { Provider, ProviderKind } from "./providers.js";

export interface Turn {
  source: "me" | "them";
  text: string;
}

export interface CopilotRequest {
  mode: ModeId;
  context: string;
  index: Index;
  provider: Provider;
  topK?: number;
  maxTokens?: number;
  /** Optional conversation history (oldest first). Used by 'speaker' mode. */
  history?: Turn[];
  signal?: AbortSignal;
}

export interface CopilotSource {
  source: string;
  heading?: string;
  score: number;
  snippet: string;
}

export interface CopilotResult {
  mode: ModeId;
  text: string;
  sources: CopilotSource[];
  grounded: boolean;
  providerKind: ProviderKind;
  model: string;
  latencyMs: number;
}

export interface CopilotMeta {
  mode: ModeId;
  sources: CopilotSource[];
  grounded: boolean;
  providerKind: ProviderKind;
  model: string;
}

export async function runCopilot(req: CopilotRequest): Promise<CopilotResult> {
  const mode = getMode(req.mode);
  const sources = retrieveSources(req);
  const user = buildUserPrompt(req.context, mapHits(req), req.history);

  const start = Date.now();
  const text = await req.provider.complete({
    system: mode.systemPrompt,
    user,
    maxTokens: req.maxTokens ?? 700,
    temperature: 0.3,
    signal: req.signal,
  });
  const latencyMs = Date.now() - start;

  return {
    mode: mode.id,
    text,
    sources,
    grounded: sources.length > 0,
    providerKind: req.provider.kind,
    model: req.provider.model,
    latencyMs,
  };
}

/**
 * Streaming variant. Yields the metadata frame first (so the UI can render
 * sources / provider info immediately), then token deltas, then a final
 * 'done' frame with total latency.
 */
export async function* runCopilotStream(
  req: CopilotRequest,
): AsyncGenerator<
  | { kind: "meta"; meta: CopilotMeta }
  | { kind: "token"; delta: string }
  | { kind: "done"; latencyMs: number }
> {
  const mode = getMode(req.mode);
  const sources = retrieveSources(req);

  yield {
    kind: "meta",
    meta: {
      mode: mode.id,
      sources,
      grounded: sources.length > 0,
      providerKind: req.provider.kind,
      model: req.provider.model,
    },
  };

  const user = buildUserPrompt(req.context, mapHits(req), req.history);
  const start = Date.now();
  for await (const delta of req.provider.completeStream({
    system: mode.systemPrompt,
    user,
    maxTokens: req.maxTokens ?? 350,
    temperature: 0.3,
    signal: req.signal,
  })) {
    yield { kind: "token", delta };
  }
  yield { kind: "done", latencyMs: Date.now() - start };
}

function retrieveSources(req: CopilotRequest): CopilotSource[] {
  const topK = req.topK ?? 5;
  const hits = retrieve(req.index, retrievalQuery(req), topK);
  return hits.map((h) => {
    const out: CopilotSource = {
      source: h.chunk.source,
      score: Number(h.score.toFixed(3)),
      snippet: truncate(h.chunk.text, 320),
    };
    if (h.chunk.heading) out.heading = h.chunk.heading;
    return out;
  });
}

function mapHits(req: CopilotRequest): RetrievalHit[] {
  const topK = req.topK ?? 5;
  return retrieve(req.index, retrievalQuery(req), topK);
}

/**
 * For 'speaker' mode the latest [them] utterance is what we should retrieve
 * against — that's the question they just asked. Fall back to context for the
 * other modes which use the seller's manual notes.
 */
function retrievalQuery(req: CopilotRequest): string {
  if (req.mode === "speaker" && req.history && req.history.length > 0) {
    const lastThem = [...req.history].reverse().find((t) => t.source === "them");
    if (lastThem) return lastThem.text + "\n" + req.context;
  }
  return req.context;
}

function buildUserPrompt(context: string, hits: RetrievalHit[], history?: Turn[]): string {
  const wikiBlock = hits.length === 0
    ? "(no relevant wiki snippets — answer carefully, do not invent product facts.)"
    : hits
        .map((h, i) => {
          const heading = h.chunk.heading ? ` — ${h.chunk.heading}` : "";
          return `[${i + 1}] ${h.chunk.source}${heading}\n${truncate(h.chunk.text, 600)}`;
        })
        .join("\n\n");

  const parts: string[] = [];
  parts.push("<WIKI>");
  parts.push(wikiBlock);
  parts.push("</WIKI>");

  if (history && history.length > 0) {
    parts.push("");
    parts.push("<CONVERSATION>");
    for (const t of history) {
      parts.push(`[${t.source}] ${t.text}`);
    }
    parts.push("</CONVERSATION>");
  }

  if (context.trim()) {
    parts.push("");
    parts.push("<LATEST_FROM_PROSPECT>");
    parts.push(context.trim());
    parts.push("</LATEST_FROM_PROSPECT>");
  }

  parts.push("");
  parts.push("Reply now per the system instructions. Be concise — the seller is mid-sentence.");
  return parts.join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
