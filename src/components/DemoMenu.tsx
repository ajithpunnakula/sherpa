import React from "react";
import type { DemoScenario } from "../lib/demos";

export function DemoMenu(props: {
  demos: DemoScenario[];
  onPick: (d: DemoScenario) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="demo-menu" role="menu">
      <div className="demo-menu-head">
        <span>Demo scenarios</span>
        <button className="btn-tiny" onClick={props.onClose}>close</button>
      </div>
      <ul>
        {props.demos.map((d) => (
          <li key={d.id}>
            <button onClick={() => props.onPick(d)}>
              <span className="demo-label">{d.label}</span>
              <span className="demo-preview">{d.context.slice(0, 100)}…</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
