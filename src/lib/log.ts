// Forwards renderer console output + uncaught errors to the main process,
// which writes them to .data/sherpa-dev.log. Lets us debug without screenshots.

import { api } from "./sherpa";

type Level = "info" | "warn" | "error";

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(" ");
}

export function installRendererLogForwarding(): void {
  const send = (level: Level, msg: string) => {
    try { api().log({ level, src: "renderer", msg }); } catch {}
  };

  const orig = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  console.log = (...args: unknown[]) => { orig.log(...args); send("info",  fmt(args)); };
  console.warn = (...args: unknown[]) => { orig.warn(...args); send("warn",  fmt(args)); };
  console.error = (...args: unknown[]) => { orig.error(...args); send("error", fmt(args)); };

  window.addEventListener("error", (e) => {
    send("error", `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}` + (e.error?.stack ? "\n" + e.error.stack : ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    send("error", "unhandledrejection: " + (r instanceof Error ? (r.stack ?? r.message) : String(r)));
  });

  send("info", `renderer booted ${navigator.userAgent}`);
}
