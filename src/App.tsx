import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CluelyMeta, type CopilotResult } from "./lib/cluely";
import { DEMOS, type DemoScenario } from "./lib/demos";
import { ModeSwitcher } from "./components/ModeSwitcher";
import { StatusBar } from "./components/StatusBar";
import { SuggestionCard } from "./components/SuggestionCard";
import { Sources } from "./components/Sources";
import { DemoMenu } from "./components/DemoMenu";

type AppStatus = "idle" | "thinking" | "ready";

const MODES = [
  { id: "discovery", label: "Discovery", hint: "Surface pain & criteria" },
  { id: "demo", label: "Demo", hint: "What to show next" },
  { id: "objection", label: "Objection", hint: "Acknowledge, reframe, evidence" },
  { id: "competitive", label: "Competitive", hint: "Honest positioning" },
  { id: "pricing", label: "Pricing", hint: "Anchor on value" },
  { id: "roi", label: "ROI", hint: "Quantify in their units" },
  { id: "followup", label: "Follow-up", hint: "Draft the email" },
  { id: "closing", label: "Close", hint: "Propose a next step" },
] as const;

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<typeof MODES[number]["id"]>("objection");
  const [context, setContext] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [meta, setMeta] = useState<CluelyMeta | null>(null);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDemos, setShowDemos] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initial meta + status subscriptions
  useEffect(() => {
    const a = api();
    a.meta().then(setMeta).catch(() => {});
    const offStatus = a.onStatus((s) => setStatus(s as AppStatus));
    const offIdx = a.onIndexLoaded(() => a.meta().then(setMeta));
    const offErr = a.onError((e) => setError(e.message));
    const offFocus = a.onFocus(() => textareaRef.current?.focus());
    return () => { offStatus(); offIdx(); offErr(); offFocus(); };
  }, []);

  const submit = useCallback(async () => {
    if (!context.trim()) return;
    setError(null);
    setStatus("thinking");
    try {
      const out = await api().run({ mode, context });
      setResult(out);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  }, [context, mode]);

  // Cmd+Enter to submit, Esc to hide
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        api().hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const pickDemo = (d: DemoScenario) => {
    setMode(d.mode);
    setContext(d.context);
    setShowDemos(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const placeholder = useMemo(() => {
    switch (mode) {
      case "objection":   return "Paste the objection or the prospect's exact words…";
      case "discovery":   return "Who are you meeting and what do you need to uncover?";
      case "demo":        return "What did the buyer just ask to see? What outcomes do they care about?";
      case "competitive": return "Which competitor came up, and what did they say?";
      case "pricing":     return "What's the situation? Seats, urgency, hesitation?";
      case "roi":         return "What's the buyer trying to prove internally? What units do they use?";
      case "followup":    return "Recap the call — attendees, key points, agreed next step…";
      case "closing":     return "Where is the deal? What's the proposed next step?";
    }
  }, [mode]);

  return (
    <div className="app">
      <header className="titlebar" data-drag>
        <div className="brand">
          <span className="dot" data-status={status} />
          <span className="brand-name">Cluely</span>
          <span className="brand-sub">sales copilot</span>
        </div>
        <div className="title-actions">
          <button className="btn-ghost" onClick={() => setShowDemos((v) => !v)} title="Demo scenarios">
            ★
          </button>
          <button className="btn-ghost" onClick={() => api().hide()} title="Hide (Esc)">
            ✕
          </button>
        </div>
      </header>

      {showDemos && <DemoMenu demos={DEMOS} onPick={pickDemo} onClose={() => setShowDemos(false)} />}

      <ModeSwitcher modes={MODES} value={mode} onChange={setMode} />

      <div className="composer">
        <textarea
          ref={textareaRef}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={placeholder}
          rows={4}
          autoFocus
        />
        <div className="composer-bar">
          <span className="hint">⌘↩ to send · Esc to hide</span>
          <button className="btn-primary" onClick={submit} disabled={!context.trim() || status === "thinking"}>
            {status === "thinking" ? "Thinking…" : "Suggest"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {result && <SuggestionCard result={result} />}
      {result && <Sources sources={result.sources} />}

      <StatusBar meta={meta} status={status} />
    </div>
  );
}
