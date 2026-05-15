import React from "react";
import { useState } from "react";
import { api, type CluelyMeta } from "../lib/cluely";

export function StatusBar(props: {
  meta: CluelyMeta | null;
  status: "idle" | "thinking" | "ready";
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = props.meta;

  const providerLabel = meta
    ? meta.providerKind === "stub"
      ? "LLM: stub (set ANTHROPIC_API_KEY or OPENAI_API_KEY)"
      : `LLM: ${meta.providerSummary}`
    : "LLM: …";

  const indexLabel = meta?.indexInfo
    ? `KB: ${meta.indexInfo.chunkCount} chunks · ${meta.indexInfo.sourceCount} sources · ${meta.indexInfo.repo}`
    : "KB: not loaded (run `npm run index`)";

  const micLabel = meta?.micStatus && meta.micStatus !== "n/a"
    ? `Mic: ${meta.micStatus}`
    : "Mic: off";

  return (
    <div className={"statusbar" + (expanded ? " is-expanded" : "")}>
      <button className="statusbar-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className={`status-dot status-${props.status}`} />
        <span className="statusbar-label">{labelFor(props.status)}</span>
        <span className="statusbar-meta">{providerLabel}</span>
        <span className="statusbar-caret">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="statusbar-body">
          <div className="statusbar-row">{indexLabel}</div>
          <div className="statusbar-row">{micLabel} · Screen: off · Hotkey: {meta?.hotkey ?? "Cmd+Shift+Space"}</div>
          <div className="statusbar-row statusbar-disclaimer">
            Cluely does not record audio or capture screen until you explicitly enable a permission below. All processing happens locally except the final LLM call.
          </div>
          <div className="statusbar-actions">
            <button className="btn-ghost" onClick={() => api().openPerms("microphone")}>Enable mic…</button>
            <button className="btn-ghost" onClick={() => api().openPerms("screen")}>Screen recording…</button>
            <button className="btn-ghost" onClick={() => api().openPerms("accessibility")}>Accessibility…</button>
          </div>
        </div>
      )}
    </div>
  );
}

function labelFor(s: string): string {
  switch (s) {
    case "thinking": return "Thinking";
    case "ready":    return "Ready";
    default:         return "Idle";
  }
}
