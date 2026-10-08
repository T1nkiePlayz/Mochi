import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { usePopoverPlacement } from "./usePopoverPlacement";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  /** Options with the same group are listed together under a heading. */
  group?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Accessible name; also shown as the placeholder when nothing is selected. */
  label: string;
  placeholder?: string;
  /** Adds a filter box; use for long lists. Defaults to on above 12 options. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Preferred direction for the popover. */
  align?: "start" | "end";
};

/**
 * Themeable replacement for the native <select>. Styled entirely through `.mochi-select*`
 * classes and design tokens, keyboard operable (arrows, Home/End, type-ahead, Enter, Escape).
 */
export function Select<T extends string>({ value, onChange, options, label, placeholder, searchable, disabled, className = "", align = "start" }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const { placement, maxHeight } = usePopoverPlacement(open, root);
  const showSearch = searchable ?? options.length > 12;
  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => `${option.label} ${option.description ?? ""} ${option.group ?? ""}`.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, visible.findIndex((option) => option.value === value)));
  }, [open, query]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (option: SelectOption<T> | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery("");
    root.current?.querySelector<HTMLElement>(".mochi-select-trigger")?.focus();
  };

  const move = (delta: number) => {
    if (!visible.length) return;
    let next = active;
    for (let step = 0; step < visible.length; step += 1) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next].disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); if (!open) setOpen(true); else move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (!open) setOpen(true); else move(-1); }
    else if (event.key === "Home" && open) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && open) { event.preventDefault(); setActive(visible.length - 1); }
    else if (event.key === "Enter" && open) { event.preventDefault(); choose(visible[active]); }
    else if (event.key === " " && !open && !showSearch) { event.preventDefault(); setOpen(true); }
    else if (event.key === "Tab") setOpen(false);
    else if (open && !showSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const index = visible.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (index >= 0) setActive(index);
    }
  };

  let lastGroup: string | undefined;
  return <div ref={root} className={`mochi-select ${open ? "open" : ""} ${className}`.trim()} onKeyDown={onKeyDown} data-align={align} data-placement={placement}>
    <button type="button" className="mochi-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={`${label}: ${selected?.label ?? placeholder ?? ""}`} onClick={() => setOpen((current) => !current)}>
      {selected?.icon && <span className="mochi-select-icon">{selected.icon}</span>}
      <span className={`mochi-select-value ${selected ? "" : "placeholder"}`}>{selected?.label ?? placeholder ?? label}</span>
      <ChevronDown size={15} className="mochi-select-chevron" aria-hidden="true" />
    </button>
    {open && <div className="mochi-select-popover" style={{ maxHeight }}>
      {showSearch && <label className="mochi-select-search"><Search size={14} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} /></label>}
      <ul ref={listRef} id={listId} className="mochi-select-list" role="listbox" aria-label={label} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}>
        {visible.map((option, index) => {
          const heading = option.group && option.group !== lastGroup ? option.group : null;
          lastGroup = option.group;
          return <li key={option.value} role="presentation">
            {heading && <div className="mochi-select-group" role="presentation">{heading}</div>}
            <div role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} id={`${listId}-${index}`} data-index={index} className={`mochi-select-option ${index === active ? "active" : ""} ${option.value === value ? "selected" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
              {option.icon && <span className="mochi-select-icon">{option.icon}</span>}
              <span className="mochi-select-option-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </div>
          </li>;
        })}
        {!visible.length && <li className="mochi-select-empty" role="presentation">Nothing matches “{query}”.</li>}
      </ul>
    </div>}
  </div>;
}
