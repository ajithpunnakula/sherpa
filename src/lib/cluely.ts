import type { ModeId } from "../../server/copilot/modes";

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
  providerKind: "anthropic" | "openai" | "stub";
  model: string;
  latencyMs: number;
}

export interface CluelyMeta {
  indexInfo: {
    chunkCount: number;
    sourceCount: number;
    repo: string;
    builtAt: string;
    path: string;
  } | null;
  providerKind: "anthropic" | "openai" | "stub";
  providerSummary: string;
  indexPath: string;
  indexLoaded: boolean;
  micStatus: string;
  hotkey: string;
}

export interface CluelyApi {
  run: (p: { mode: string; context: string; preferred?: "anthropic" | "openai" }) => Promise<CopilotResult>;
  meta: () => Promise<CluelyMeta>;
  openPerms: (which: "microphone" | "screen" | "accessibility") => Promise<boolean>;
  hide: () => Promise<void>;
  log: (msg: unknown) => void;
  onStatus: (cb: (s: string) => void) => () => void;
  onIndexLoaded: (cb: (info: unknown) => void) => () => void;
  onError: (cb: (err: { message: string }) => void) => () => void;
  onFocus: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    cluely?: CluelyApi;
  }
}

/**
 * Returns the IPC API. When running in a plain browser (vite dev preview
 * without Electron), returns a stub that explains the situation and lets you
 * preview the UI.
 */
export function api(): CluelyApi {
  if (typeof window !== "undefined" && window.cluely) return window.cluely;
  const stub: CluelyApi = {
    async run(p) {
      await new Promise((r) => setTimeout(r, 400));
      return {
        mode: p.mode as ModeId,
        text: `Recommended thing to say:\n"This is a browser-only preview — launch the Electron app to make real LLM calls."\n\nSources:\n- (none — preview mode)`,
        sources: [],
        grounded: false,
        providerKind: "stub",
        model: "browser-preview",
        latencyMs: 400,
      };
    },
    async meta() {
      return {
        indexInfo: null,
        providerKind: "stub",
        providerSummary: "browser preview (no Electron)",
        indexPath: "n/a",
        indexLoaded: false,
        micStatus: "n/a",
        hotkey: "Cmd+Shift+Space",
      };
    },
    async openPerms() { return false; },
    async hide() {},
    log() {},
    onStatus() { return () => {}; },
    onIndexLoaded() { return () => {}; },
    onError() { return () => {}; },
    onFocus() { return () => {}; },
  };
  return stub;
}
