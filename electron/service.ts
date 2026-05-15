import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { retrieve } from "../server/kb/retriever";
import { selectProvider, type Provider, type ProviderEnv } from "../server/copilot/providers";
import { runCopilot } from "../server/copilot/orchestrator";
import type { Index } from "../server/kb/types";
import type { ModeId } from "../server/copilot/modes";

export interface IndexInfo {
  chunkCount: number;
  sourceCount: number;
  repo: string;
  builtAt: string;
  path: string;
}

export class CopilotService {
  private index: Index | null = null;
  private indexPath: string | null = null;
  private provider: Provider;
  private env: ProviderEnv;

  constructor(env: ProviderEnv) {
    this.env = env;
    this.provider = selectProvider(env);
  }

  async load(path: string): Promise<void> {
    const raw = await fs.readFile(path, "utf8");
    this.index = JSON.parse(raw) as Index;
    this.indexPath = path;
  }

  isLoaded(): boolean {
    return Boolean(this.index);
  }

  providerKind() {
    return this.provider.kind;
  }

  providerSummary(): string {
    return `${this.provider.kind}${this.provider.model && this.provider.model !== "stub" ? " · " + this.provider.model : ""}`;
  }

  indexInfo(): IndexInfo | null {
    if (!this.index || !this.indexPath) return null;
    const sources = new Set(this.index.chunks.map((c) => c.source));
    return {
      chunkCount: this.index.chunks.length,
      sourceCount: sources.size,
      repo: basename(this.index.repoPath),
      builtAt: this.index.builtAt,
      path: this.indexPath,
    };
  }

  async run(payload: { mode: string; context: string; preferred?: "anthropic" | "openai" }) {
    if (!this.index) throw new Error("Index not loaded. Run `npm run index`.");
    const provider = payload.preferred
      ? selectProvider(this.env, payload.preferred)
      : this.provider;
    return runCopilot({
      mode: payload.mode as ModeId,
      context: payload.context,
      index: this.index,
      provider,
    });
  }
}
