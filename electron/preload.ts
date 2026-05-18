import { contextBridge, ipcRenderer } from "electron";

export interface Turn {
  source: "me" | "them";
  text: string;
}

export interface CopilotRunPayload {
  mode: string;
  context: string;
  history?: Turn[];
  preferred?: "anthropic" | "openai";
}

export interface CopilotRunStreamPayload extends CopilotRunPayload {
  id: string;
}

export type StreamFrame =
  | { id: string; kind: "meta"; meta: unknown }
  | { id: string; kind: "token"; delta: string }
  | { id: string; kind: "done"; latencyMs: number }
  | { id: string; kind: "error"; message: string };

const api = {
  run: (payload: CopilotRunPayload) => ipcRenderer.invoke("sherpa:run", payload),
  runStream: (payload: CopilotRunStreamPayload) => ipcRenderer.invoke("sherpa:run-stream", payload),
  cancelStream: (id: string) => ipcRenderer.invoke("sherpa:cancel-stream", id),
  meta: () => ipcRenderer.invoke("sherpa:meta"),
  openPerms: (which: "microphone" | "screen" | "accessibility") =>
    ipcRenderer.invoke("sherpa:open-perms", which),
  hide: () => ipcRenderer.invoke("sherpa:hide"),
  log: (msg: unknown) => ipcRenderer.send("sherpa:log", msg),
  transcript: (entry: { source: "me" | "them"; text: string; ts: number }) =>
    ipcRenderer.send("sherpa:transcript", entry),

  onStream: (cb: (frame: StreamFrame) => void) => {
    const fn = (_: unknown, frame: StreamFrame) => cb(frame);
    ipcRenderer.on("sherpa:stream", fn);
    return () => ipcRenderer.removeListener("sherpa:stream", fn);
  },
  onStatus: (cb: (s: string) => void) => {
    const fn = (_: unknown, s: string) => cb(s);
    ipcRenderer.on("sherpa:status", fn);
    return () => ipcRenderer.removeListener("sherpa:status", fn);
  },
  onIndexLoaded: (cb: (info: unknown) => void) => {
    const fn = (_: unknown, info: unknown) => cb(info);
    ipcRenderer.on("sherpa:index-loaded", fn);
    return () => ipcRenderer.removeListener("sherpa:index-loaded", fn);
  },
  onError: (cb: (err: { message: string }) => void) => {
    const fn = (_: unknown, err: { message: string }) => cb(err);
    ipcRenderer.on("sherpa:error", fn);
    return () => ipcRenderer.removeListener("sherpa:error", fn);
  },
  onFocus: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("sherpa:focus", fn);
    return () => ipcRenderer.removeListener("sherpa:focus", fn);
  },
};

contextBridge.exposeInMainWorld("sherpa", api);

export type SherpaApi = typeof api;
