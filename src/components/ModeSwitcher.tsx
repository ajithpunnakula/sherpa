import React from "react";
interface ModeOption { id: string; label: string; hint: string }

export function ModeSwitcher(props: {
  modes: readonly ModeOption[];
  value: string;
  onChange: (id: any) => void;
}): React.JSX.Element {
  return (
    <div className="mode-switcher" role="tablist">
      {props.modes.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={props.value === m.id}
          className={"mode-chip" + (props.value === m.id ? " is-active" : "")}
          onClick={() => props.onChange(m.id)}
          title={m.hint}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
