import type { KeyboardEvent } from "react";

type Option<T extends string | number> = { value: T; label: string };

/** Pill switcher. `tab` renders a tablist (arrow keys move and select), `radio` a radiogroup. */
export function Segmented<T extends string | number>({ label, value, options, onChange, kind = "radio", controls }: {
  label: string; value: T; options: Array<Option<T>>; onChange: (value: T) => void; kind?: "radio" | "tab"; controls?: (value: T) => string;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    window.requestAnimationFrame(() => event.currentTarget.querySelector<HTMLElement>(`[data-value="${String(next.value)}"]`)?.focus());
  };
  return (
    <div className="stats-segmented" role={kind === "tab" ? "tablist" : "radiogroup"} aria-label={label} onKeyDown={move}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button key={String(option.value)} type="button" data-value={String(option.value)} tabIndex={selected ? 0 : -1}
            role={kind === "tab" ? "tab" : "radio"} {...(kind === "tab" ? { "aria-selected": selected, "aria-controls": controls?.(option.value) } : { "aria-checked": selected })}
            className={selected ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>
        );
      })}
    </div>
  );
}
