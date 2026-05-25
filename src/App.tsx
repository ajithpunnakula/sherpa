import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type SherpaMeta,
  type CopilotMeta,
  type StreamFrame,
  type Turn,
} from "./lib/sherpa";
import { Listener, type ListenStatus, type TranscriptEvent } from "./lib/listen";

type AppStatus = "idle" | "thinking" | "ready";

const HISTORY_LIMIT = 8;
const DEBOUNCE_MS = 600;
const MAX_VISIBLE_ANSWERS = 20;

interface Answer {
  id: string;
  question: string;            // the "them" utterance(s) this responds to
  text: string;                 // streaming-accumulated raw LLM text
  meta: CopilotMeta | null;
  latencyMs: number | null;
  streaming: boolean;
  errored?: string | null;
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [meta, setMeta] = useState<SherpaMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listen, setListen] = useState<ListenStatus>({ kind: "idle" });
  const [levelMe, setLevelMe] = useState(0);
  const [levelThem, setLevelThem] = useState(0);
  const [history, setHistory] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [transparent, setTransparent] = useState<boolean>(() => {
    try { return localStorage.getItem("sherpa.transparent") === "1"; } catch { return false; }
  });
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.body.dataset.transparent = transparent ? "true" : "false";
    try { localStorage.setItem("sherpa.transparent", transparent ? "1" : "0"); } catch {}
    void api().setTransparent(transparent);
  }, [transparent]);

  const listenerRef = useRef<Listener | null>(null);
  const historyRef = useRef<Turn[]>([]);

  // Debounce state — coalesce rapid 'them' chunks into a single LLM call.
  const pendingQuestionRef = useRef<string>("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map of active stream id → answer id, so cancellation routes to the right card.
  const activeStreamRef = useRef<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { historyRef.current = history; }, [history]);

  // Auto-scroll the answer list to top whenever it changes — newest card is at the top.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = 0; });
  }, [answers]);

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
    if (frame.id !== activeStreamRef.current) return; // stale
    setAnswers((prev) => {
      const next = [...prev];
      const idx = next.findIndex((a) => a.id === frame.id);
      if (idx < 0) return prev;
      const cur = next[idx]!;
      if (frame.kind === "meta") {
        next[idx] = { ...cur, meta: frame.meta };
      } else if (frame.kind === "token") {
        next[idx] = { ...cur, text: cur.text + frame.delta };
      } else if (frame.kind === "done") {
        next[idx] = { ...cur, latencyMs: frame.latencyMs, streaming: false };
      } else if (frame.kind === "error") {
        next[idx] = { ...cur, streaming: false, errored: frame.message };
      }
      return next;
    });
    if (frame.kind === "done" || frame.kind === "error") {
      activeStreamRef.current = null;
    }
  }, []);

  // Kicks an LLM call for `question`. Cancels any prior in-flight stream and
  // appends a new pending Answer card to the list.
  const fireStream = useCallback(async (question: string) => {
    const prevId = activeStreamRef.current;
    if (prevId) { try { await api().cancelStream(prevId); } catch {} }

    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    activeStreamRef.current = id;
    setError(null);
    setStatus("thinking");
    setAnswers((prev) => {
      const next: Answer[] = [
        { id, question, text: "", meta: null, latencyMs: null, streaming: true },
        ...prev,
      ];
      if (next.length > MAX_VISIBLE_ANSWERS) next.length = MAX_VISIBLE_ANSWERS;
      return next;
    });
    try {
      await api().runStream({
        id,
        mode: "speaker",
        context: question,
        history: historyRef.current.slice(-HISTORY_LIMIT),
      });
    } catch (err) {
      if (activeStreamRef.current === id) {
        setError((err as Error).message);
        setStatus("idle");
        activeStreamRef.current = null;
      }
    }
  }, []);

  // Debounced: accumulate consecutive 'them' chunks for 600ms before firing.
  // Prevents a single sentence chopped into 3s windows from triggering 2-3
  // overlapping LLM calls.
  const scheduleStream = useCallback((themText: string) => {
    pendingQuestionRef.current = pendingQuestionRef.current
      ? pendingQuestionRef.current.replace(/[.\s]*$/, "") + " " + themText
      : themText;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const q = pendingQuestionRef.current.trim();
      pendingQuestionRef.current = "";
      debounceTimerRef.current = null;
      if (q) void fireStream(q);
    }, DEBOUNCE_MS);
  }, [fireStream]);

  const onTranscript = useCallback((evt: TranscriptEvent) => {
    api().transcript(evt);
    setHistory((prev) => {
      const next: Turn[] = [...prev, { source: evt.source, text: evt.text }];
      if (next.length > HISTORY_LIMIT * 2) next.splice(0, next.length - HISTORY_LIMIT * 2);
      return next;
    });
    if (evt.source === "them") scheduleStream(evt.text);
  }, [scheduleStream]);

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

  useEffect(() => () => {
    listenerRef.current?.stop();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showTranscript) setShowTranscript(false);
        else if (manualOpen) setManualOpen(false);
        else api().hide();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && manualOpen) {
        e.preventDefault();
        if (manualText.trim()) submitManual();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranscript, manualOpen, manualText]);

  const submitManual = useCallback(() => {
    const txt = manualText.trim();
    if (!txt) return;
    setHistory((prev) => [...prev, { source: "them" as const, text: txt }].slice(-HISTORY_LIMIT * 2));
    setManualText("");
    void fireStream(txt);
  }, [manualText, fireStream]);

  const clearAnswers = useCallback(() => {
    setAnswers([]);
    setHistory([]);
    setError(null);
  }, []);

  const meterLevel = Math.max(levelMe, levelThem);
  const latestMeta = useMemo(() => {
    for (const a of answers) {
      if (a.meta) return a.meta;
    }
    return null;
  }, [answers]);
  const latestLatency = useMemo(() => {
    for (const a of answers) {
      if (a.latencyMs !== null) return a.latencyMs;
    }
    return null;
  }, [answers]);

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

          {answers.length > 0 && (
            <button className="icon-btn" onClick={clearAnswers} title="Clear conversation">⌫</button>
          )}

          <button
            className="icon-btn"
            onClick={() => setTransparent((v) => !v)}
            title={transparent ? "Make panel solid" : "Make panel transparent"}
          >{transparent ? "◐" : "◑"}</button>

          <button className="icon-btn" onClick={() => api().hide()} title="Hide (Esc)">✕</button>
        </header>

        <div className="answer" ref={scrollerRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {answers.length === 0 && (
            <div style={{
              padding: "32px 14px",
              color: "var(--text-faint)",
              fontSize: 13,
              textAlign: "center",
              letterSpacing: "-0.005em",
            }}>
              {listen.kind === "idle"
                ? "Click Listen to start. Answers appear here as the prospect speaks."
                : "Listening — answers will stream in as the prospect speaks."}
            </div>
          )}

          {answers.map((ans) => (
            <AnswerCard key={ans.id} answer={ans} />
          ))}

          {status === "thinking" && answers.length > 0 && answers[0]!.text === "" && (
            <div className="shimmer" style={{ margin: "0 14px" }} />
          )}
        </div>

        {showTranscript && (
          <div className="answer" style={{ borderTop: "1px solid var(--border)", maxHeight: 200, overflowY: "auto" }}>
            <div className="detail-label" style={{ padding: "8px 14px 4px" }}>Full transcript</div>
            <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
              {history.length === 0 && (
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>(empty)</span>
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
                onClick={submitManual}
              >{status === "thinking" ? "Thinking…" : "Ask"}</button>
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <footer className="footer">
          {latestMeta ? (
            <>
              <span className={latestMeta.grounded ? "grounded" : "generic"}>
                {latestMeta.grounded ? "● wiki-grounded" : "● generic"}
              </span>
              <span>·</span>
              <span>{latestMeta.model}</span>
              {latestLatency !== null && (<><span>·</span><span>{latestLatency}ms</span></>)}
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

function AnswerCard({ answer }: { answer: Answer }): React.JSX.Element {
  const parsed = useMemo(() => parseSpeakerAnswer(answer.text), [answer.text]);
  // 'why' and 'sources' are intentionally NOT shown — too noisy during a live
  // call. They're still emitted by the LLM and written to the transcript log
  // (~/.sherpa/transcripts/*.jsonl) for after-the-fact review.
  return (
    <div style={{ padding: "10px 14px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{
        fontSize: 12,
        color: "rgba(245, 246, 248, 0.62)",
        marginBottom: 4,
        letterSpacing: "-0.005em",
        textShadow: "0 1px 2px rgba(0, 0, 0, 0.55)",
      }}>
        <span style={{ opacity: 0.75 }}>they said: </span>
        <span style={{ color: "rgba(245, 246, 248, 0.92)" }}>{answer.question}</span>
      </div>

      {parsed.opportunity && (
        <div style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: "var(--good, #6ee7a3)",
          background: "rgba(110, 231, 163, 0.10)",
          border: "1px solid rgba(110, 231, 163, 0.30)",
          borderRadius: 999,
          padding: "2px 8px",
          marginBottom: 6,
        }}>★ {parsed.opportunity}</div>
      )}

      {parsed.hero && <div className="hero" style={{ fontSize: 18, marginTop: 2 }}>{parsed.hero}</div>}

      {!parsed.hero && answer.text && <pre className="raw">{answer.text}</pre>}

      {answer.errored && (
        <div className="error" style={{ marginTop: 6, fontSize: 12 }}>{answer.errored}</div>
      )}
    </div>
  );
}

interface ParsedSpeakerAnswer {
  opportunity: string | null;
  hero: string | null;
  why: string | null;
}

/**
 * Speaker mode emits:
 *   [★ OPPORTUNITY: ...]    (optional, first line)
 *   "<quoted seller line>"
 *   <blank line>
 *   Why: <short rationale>
 */
function parseSpeakerAnswer(raw: string): ParsedSpeakerAnswer {
  const trimmed = raw.trim();
  if (!trimmed) return { opportunity: null, hero: null, why: null };

  const lines = trimmed.split(/\r?\n/);
  let opportunity: string | null = null;
  let hero: string | null = null;
  let why: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    if (opportunity === null && hero === null) {
      const opp = line.match(/^[★*]?\s*OPPORTUNITY\s*:\s*(.*)$/i);
      if (opp) {
        opportunity = opp[1]!.trim().replace(/^[★*\s]+|[★*\s]+$/g, "");
        continue;
      }
    }
    if (hero === null) {
      hero = stripOuterQuotes(line);
      continue;
    }
    const m = line.match(/^why\s*:\s*(.*)$/i);
    if (m) {
      why = m[1]!.trim();
      for (let j = i + 1; j < lines.length; j++) {
        const more = lines[j]!.trim();
        if (more) why += " " + more;
      }
      break;
    }
  }

  return { opportunity, hero, why };
}

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

