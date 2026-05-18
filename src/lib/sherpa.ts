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

export interface CopilotMeta {
  mode: ModeId;
  sources: CopilotSource[];
  grounded: boolean;
  providerKind: "anthropic" | "openai" | "stub";
  model: string;
}

export interface SherpaMeta {
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

export interface Turn {
  source: "me" | "them";
  text: string;
}

export type StreamFrame =
  | { id: string; kind: "meta"; meta: CopilotMeta }
  | { id: string; kind: "token"; delta: string }
  | { id: string; kind: "done"; latencyMs: number }
  | { id: string; kind: "error"; message: string };

export interface RunPayload {
  mode: string;
  context: string;
  history?: Turn[];
  preferred?: "anthropic" | "openai";
}

export interface SherpaApi {
  run: (p: RunPayload) => Promise<CopilotResult>;
  runStream: (p: RunPayload & { id: string }) => Promise<{ id: string }>;
  cancelStream: (id: string) => Promise<boolean>;
  meta: () => Promise<SherpaMeta>;
  openPerms: (which: "microphone" | "screen" | "accessibility") => Promise<boolean>;
  hide: () => Promise<void>;
  setTransparent: (on: boolean) => Promise<void>;
  log: (msg: unknown | { level: "debug" | "info" | "warn" | "error"; src: string; msg: string }) => void;
  transcript: (entry: { source: "me" | "them"; text: string; ts: number }) => void;
  onStream: (cb: (frame: StreamFrame) => void) => () => void;
  onStatus: (cb: (s: string) => void) => () => void;
  onIndexLoaded: (cb: (info: unknown) => void) => () => void;
  onError: (cb: (err: { message: string }) => void) => () => void;
  onFocus: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    sherpa?: SherpaApi;
  }
}

/**
 * Returns the IPC API. When running in a plain browser (vite dev preview
 * without Electron), returns a stub that explains the situation.
 */
export function api(): SherpaApi {
  if (typeof window !== "undefined" && window.sherpa) return window.sherpa;
  const stub: SherpaApi = {
    async run(p) {
      await new Promise((r) => setTimeout(r, 200));
      return {
        mode: p.mode as ModeId,
        text: `"Browser-only preview — launch the Electron app for real LLM calls."\n\nWhy: stub mode active.`,
        sources: [],
        grounded: false,
        providerKind: "stub",
        model: "browser-preview",
        latencyMs: 200,
      };
    },
    async runStream(p) { return { id: p.id }; },
    async cancelStream() { return true; },
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
    async setTransparent() {},
    log() {},
    transcript() {},
    onStream() { return () => {}; },
    onStatus() { return () => {}; },
    onIndexLoaded() { return () => {}; },
    onError() { return () => {}; },
    onFocus() { return () => {}; },
  };
  return stub;
}
