import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type SherpaMeta,
  type CopilotMeta,
  type CopilotSource,
  type StreamFrame,
  type Turn,
} from "./lib/sherpa";
import { Listener, type ListenStatus, type TranscriptEvent } from "./lib/listen";

type AppStatus = "idle" | "thinking" | "ready";

const HISTORY_LIMIT = 8;

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [meta, setMeta] = useState<SherpaMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listen, setListen] = useState<ListenStatus>({ kind: "idle" });
  const [levelMe, setLevelMe] = useState(0);
  const [levelThem, setLevelThem] = useState(0);
  const [history, setHistory] = useState<Turn[]>([]);
  const [latestThem, setLatestThem] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const [answerMeta, setAnswerMeta] = useState<CopilotMeta | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const manualRef = useRef<HTMLTextAreaElement>(null);

  const listenerRef = useRef<Listener | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const historyRef = useRef<Turn[]>([]);

  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    const a = api();
    a.meta().then(setMeta).catch(() => {});
    const offStatus = a.onStatus((s) => setStatus(s as AppStatus));
    const offIdx = a.onIndexLoaded(() => a.meta().then(setMeta));
    const offErr = a.onError((e) => setError(e.message));
    const offFocus = a.onFocus(() => manualRef.current?.focus());
    const offStream = a.onStream((frame) => handleStreamFrame(frame));
    return () => { offStatus(); offIdx(); offErr(); offFocus(); offStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStreamFrame = useCallback((frame: StreamFrame) => {
    if (frame.id !== streamIdRef.current) return;       // stale frame from a cancelled stream
    if (frame.kind === "meta") {
      setAnswerMeta(frame.meta);
      setAnswer("");
      setLatencyMs(null);
    } else if (frame.kind === "token") {
      setAnswer((prev) => prev + frame.delta);
    } else if (frame.kind === "done") {
      setLatencyMs(frame.latencyMs);
      setStatus("ready");
      streamIdRef.current = null;
    } else if (frame.kind === "error") {
      setError(frame.message);
      setStatus("idle");
      streamIdRef.current = null;
    }
  }, []);

  const kickStream = useCallback(async (latestPromptContext: string) => {
    // Cancel any in-flight stream — the prospect kept talking or we got new context.
    const prevId = streamIdRef.current;
    if (prevId) {
      try { await api().cancelStream(prevId); } catch {}
    }
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    streamIdRef.current = id;
    setAnswer("");
    setAnswerMeta(null);
    setLatencyMs(null);
    setError(null);
    setStatus("thinking");
    try {
      await api().runStream({
        id,
        mode: "speaker",
        context: latestPromptContext,
        history: historyRef.current.slice(-HISTORY_LIMIT),
      });
    } catch (err) {
      if (streamIdRef.current === id) {
        setError((err as Error).message);
        setStatus("idle");
        streamIdRef.current = null;
      }
    }
  }, []);

  const onTranscript = useCallback((evt: TranscriptEvent) => {
    api().transcript(evt);
    setHistory((prev) => {
      const next = [...prev, { source: evt.source, text: evt.text }];
      if (next.length > HISTORY_LIMIT * 2) next.splice(0, next.length - HISTORY_LIMIT * 2);
      return next;
    });
    if (evt.source === "them") {
      setLatestThem(evt.text);
      void kickStream(evt.text);
    }
  }, [kickStream]);

  const toggleListen = useCallback(async () => {
    if (listenerRef.current) {
      listenerRef.current.stop();
      listenerRef.current = null;
      setListen({ kind: "idle" });
      return;
    }
    const l = new Listener();
    listenerRef.current = l;
    l.on("status", setListen);
    l.on("level", ({ source, rms }) => {
      if (source === "me") setLevelMe(rms);
      else setLevelThem(rms);
    });
    l.on("transcript", onTranscript);
    try {
      await l.start({ mic: true, system: true });
    } catch (err) {
      setError("Listen failed: " + (err as Error).message);
      listenerRef.current = null;
    }
  }, [onTranscript]);

  useEffect(() => () => { listenerRef.current?.stop(); }, []);

  // Esc closes drawers, then hides the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showTranscript) setShowTranscript(false);
        else if (manualOpen) setManualOpen(false);
        else api().hide();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && manualOpen) {
        e.preventDefault();
        if (manualText.trim()) void kickStream(manualText.trim());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showTranscript, manualOpen, manualText, kickStream]);

  const parsed = useMemo(() => parseSpeakerAnswer(answer), [answer]);
  const meterLevel = Math.max(levelMe, levelThem);

  return (
    <div className="shell">
      <div className="glass">
        <header className="titlerow">
          <span className="brand">
            <span className="dot" data-status={status} />
            sherpa · live
          </span>

          <span className="spacer" />

          <button
            className={"listen-btn" + (listen.kind !== "idle" ? " is-on" : "")}
            onClick={toggleListen}
            title={listen.kind === "idle" ? "Start listening (mic + system audio)" : "Stop listening"}
          >
            <span className="listen-led" style={{ transform: `scale(${1 + meterLevel * 0.6})` }} />
            {listen.kind === "idle" && "Listen"}
            {listen.kind === "loading-model" && `Loading ${Math.round(listen.progress * 100)}%`}
            {listen.kind === "listening" && "Listening"}
            {listen.kind === "transcribing" && "Transcribing…"}
            {listen.kind === "error" && "Error"}
          </button>

          <button
            className="icon-btn"
            onClick={() => setShowTranscript((v) => !v)}
            title="Toggle full transcript"
          >☰</button>

          <button
            className="icon-btn"
            onClick={() => { setManualOpen((v) => !v); setTimeout(() => manualRef.current?.focus(), 0); }}
            title="Manual prompt"
          >✎</button>

          <button className="icon-btn" onClick={() => api().hide()} title="Hide (Esc)">✕</button>
        </header>

        {latestThem && (
          <div className="live-question" style={{
            fontSize: 12,
            color: "var(--text-faint)",
            padding: "6px 14px 0",
            letterSpacing: "-0.005em",
          }}>
            <span style={{ opacity: 0.7 }}>they said: </span>
            <span style={{ color: "var(--text-dim)" }}>{latestThem}</span>
          </div>
        )}

        {status === "thinking" && !answer && <div className="shimmer" />}

        {(answer || parsed.hero) && (
          <div className="answer">
            {parsed.hero && (
              <div className="hero">{parsed.hero}</div>
            )}
            {parsed.why && (
              <div className="details">
                <div className="detail">
                  <div className="detail-label">Why</div>
                  <div className="detail-body dim">{parsed.why}</div>
                </div>
                {answerMeta && answerMeta.sources.length > 0 && (
                  <div className="detail">
                    <div className="detail-label">Sources</div>
                    <div className="sources">
                      {answerMeta.sources.map((s, i) => (
                        <span key={i} className="source-pill" title={s.heading ?? s.source}>
                          {prettyPath(s.source)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!parsed.hero && answer && <pre className="raw">{answer}</pre>}
          </div>
        )}

        {showTranscript && (
          <div className="answer" style={{ borderTop: "1px solid var(--border)", marginTop: 8 }}>
            <div className="detail-label" style={{ padding: "0 14px" }}>Conversation</div>
            <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {history.length === 0 && (
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>(no transcript yet — start listening)</span>
              )}
              {history.map((t, i) => (
                <div key={i} style={{ fontSize: 12, display: "flex", gap: 8 }}>
                  <span style={{
                    color: t.source === "them" ? "var(--accent)" : "var(--text-faint)",
                    minWidth: 44,
                    fontWeight: 600,
                  }}>{t.source === "them" ? "them" : "me"}</span>
                  <span style={{ color: "var(--text-dim)" }}>{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {manualOpen && (
          <div className="composer">
            <div className="transcript-wrap">
              <textarea
                ref={manualRef}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Type what they said (used as the latest prospect utterance)…"
                rows={2}
                autoFocus
              />
            </div>
            <div className="composer-row">
              <span className="hint">Manual prompt — ⌘↵ to send</span>
              <span className="spacer" />
              <button
                className="assist"
                disabled={!manualText.trim() || status === "thinking"}
                onClick={() => {
                  const txt = manualText.trim();
                  if (!txt) return;
                  setLatestThem(txt);
                  setHistory((prev) => [...prev, { source: "them" as const, text: txt }].slice(-HISTORY_LIMIT * 2));
                  setManualText("");
                  void kickStream(txt);
                }}
              >{status === "thinking" ? "Thinking…" : "Ask"}</button>
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <footer className="footer">
          {answerMeta ? (
            <>
              <span className={answerMeta.grounded ? "grounded" : "generic"}>
                {answerMeta.grounded ? "● wiki-grounded" : "● generic"}
              </span>
              <span>·</span>
              <span>{answerMeta.model}</span>
              {latencyMs !== null && (<><span>·</span><span>{latencyMs}ms</span></>)}
            </>
          ) : (
            <>
              <span>{meta?.providerSummary ?? "loading…"}</span>
              {meta?.indexInfo && (<><span>·</span><span>{meta.indexInfo.chunkCount} chunks</span></>)}
            </>
          )}
          <span className="spacer" />
          <span>{meta?.hotkey ?? "⌘⇧Space"}</span>
        </footer>
      </div>
    </div>
  );
}

interface ParsedSpeakerAnswer {
  hero: string | null;
  why: string | null;
}

/**
 * Speaker mode emits:
 *   "<quoted line for the seller>"
 *   <blank line>
 *   Why: <short rationale>
 *
 * Fall back to showing the raw text if the model wandered off-format.
 */
function parseSpeakerAnswer(raw: string): ParsedSpeakerAnswer {
  const trimmed = raw.trim();
  if (!trimmed) return { hero: null, why: null };

  const lines = trimmed.split(/\r?\n/);
  let hero: string | null = null;
  let why: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (hero === null) {
      hero = stripOuterQuotes(line);
      continue;
    }
    const m = line.match(/^why\s*:\s*(.*)$/i);
    if (m) {
      why = m[1]!.trim();
      // gather any continuation lines
      for (let j = i + 1; j < lines.length; j++) {
        const more = lines[j]!.trim();
        if (more) why += " " + more;
      }
      break;
    }
  }

  return { hero, why };
}

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function prettyPath(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}
