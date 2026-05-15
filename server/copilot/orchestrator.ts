import type { Index, RetrievalHit } from "../kb/types.js";
import { retrieve } from "../kb/retriever.js";
import { getMode, type ModeId } from "./modes.js";
import type { Provider, ProviderKind } from "./providers.js";

export interface CopilotRequest {
  mode: ModeId;
  context: string;
  index: Index;
  provider: Provider;
  topK?: number;
  maxTokens?: number;
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

export async function runCopilot(req: CopilotRequest): Promise<CopilotResult> {
  const mode = getMode(req.mode);
  const topK = req.topK ?? 5;
  const hits = retrieve(req.index, req.context, topK);

  const sources: CopilotSource[] = hits.map((h) => {
    const out: CopilotSource = {
      source: h.chunk.source,
      score: Number(h.score.toFixed(3)),
      snippet: truncate(h.chunk.text, 320),
    };
    if (h.chunk.heading) out.heading = h.chunk.heading;
    return out;
  });

  const user = buildUserPrompt(req.context, hits);

  const start = Date.now();
  const text = await req.provider.complete({
    system: mode.systemPrompt,
    user,
    maxTokens: req.maxTokens ?? 700,
    temperature: 0.3,
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

function buildUserPrompt(context: string, hits: RetrievalHit[]): string {
  const ctxBlock = hits.length === 0
    ? "(no relevant wiki snippets retrieved — the seller is asking about something outside the indexed knowledge base. Mark any product claims as generic.)"
    : hits
        .map((h, i) => {
          const heading = h.chunk.heading ? ` — ${h.chunk.heading}` : "";
          return `[${i + 1}] ${h.chunk.source}${heading}\n${truncate(h.chunk.text, 600)}`;
        })
        .join("\n\n");

  return [
    "RETRIEVED WIKI CONTEXT:",
    ctxBlock,
    "",
    "SELLER'S CURRENT CONTEXT:",
    context.trim(),
    "",
    "Respond per the system instructions. Be concise. The seller is on a live call.",
  ].join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
