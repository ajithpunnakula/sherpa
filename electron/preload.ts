import { contextBridge, ipcRenderer } from "electron";

export interface CopilotRunPayload {
  mode: string;
  context: string;
  preferred?: "anthropic" | "openai";
}

const api = {
  run: (payload: CopilotRunPayload) => ipcRenderer.invoke("cluely:run", payload),
  meta: () => ipcRenderer.invoke("cluely:meta"),
  openPerms: (which: "microphone" | "screen" | "accessibility") =>
    ipcRenderer.invoke("cluely:open-perms", which),
  hide: () => ipcRenderer.invoke("cluely:hide"),
  log: (msg: unknown) => ipcRenderer.send("cluely:log", msg),

  onStatus: (cb: (s: string) => void) => {
    const fn = (_: unknown, s: string) => cb(s);
    ipcRenderer.on("cluely:status", fn);
    return () => ipcRenderer.removeListener("cluely:status", fn);
  },
  onIndexLoaded: (cb: (info: unknown) => void) => {
    const fn = (_: unknown, info: unknown) => cb(info);
    ipcRenderer.on("cluely:index-loaded", fn);
    return () => ipcRenderer.removeListener("cluely:index-loaded", fn);
  },
  onError: (cb: (err: { message: string }) => void) => {
    const fn = (_: unknown, err: { message: string }) => cb(err);
    ipcRenderer.on("cluely:error", fn);
    return () => ipcRenderer.removeListener("cluely:error", fn);
  },
  onFocus: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("cluely:focus", fn);
    return () => ipcRenderer.removeListener("cluely:focus", fn);
  },
};

contextBridge.exposeInMainWorld("cluely", api);

export type CluelyApi = typeof api;
