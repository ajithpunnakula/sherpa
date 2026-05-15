import React from "react";
import { useState } from "react";
import type { CopilotSource } from "../lib/cluely";

export function Sources({ sources }: { sources: CopilotSource[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <section className="sources">
      <button className="sources-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} {sources.length} retrieved snippet{sources.length === 1 ? "" : "s"} from the wiki
      </button>
      {open && (
        <ul className="sources-list">
          {sources.map((s, i) => (
            <li key={i}>
              <div className="source-head">
                <span className="source-path">{s.source}</span>
                {s.heading && <span className="source-heading">· {s.heading}</span>}
                <span className="source-score">{s.score.toFixed(2)}</span>
              </div>
              <p className="source-snippet">{s.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
