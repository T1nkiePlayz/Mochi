import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** Series colours: steps of the theme accent, so every theme restyles charts. Index 0..5; "Other" is muted. */
export const seriesVar = (index: number) => `var(--stat-s${(index % 6) + 1})`;
export const OTHER_SERIES = "var(--stat-other)";

type Tip = { content: ReactNode; x: number; y: number; width: number };

/** Tooltip state shared by a chart: shown on hover and keyboard focus, dismissed with Escape. */
export function useChartTip() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((element: Element, content: ReactNode) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const rect = element.getBoundingClientRect();
    setTip({ content, x: rect.left - box.left + rect.width / 2, y: rect.top - box.top, width: box.width });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const bind = (content: ReactNode) => ({
    onMouseEnter: (event: React.MouseEvent<Element>) => show(event.currentTarget, content),
    onMouseLeave: hide,
    onFocus: (event: React.FocusEvent<Element>) => show(event.currentTarget, content),
    onBlur: hide,
  });
  return { wrap, tip, bind, hide };
}

export function ChartTip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 90), Math.max(90, tip.width - 90));
  return <div className="stat-tip" role="status" style={{ left: x, top: tip.y }}>{tip.content}</div>;
}

/** Roving tabindex over chart items (one tab stop, arrow keys move). `step` is the index jump per arrow. */
export function useRoving(count: number, step: { h: number; v: number } = { h: 1, v: 1 }) {
  const [active, setActive] = useState(0);
  const root = useRef<SVGSVGElement>(null);
  const index = Math.min(active, Math.max(0, count - 1));
  const onKeyDown = (event: KeyboardEvent) => {
    let next = index;
    switch (event.key) {
      case "ArrowRight": next += step.h; break;
      case "ArrowLeft": next -= step.h; break;
      case "ArrowDown": next += step.v; break;
      case "ArrowUp": next -= step.v; break;
      case "Home": next = 0; break;
      case "End": next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    next = Math.min(Math.max(next, 0), count - 1);
    setActive(next);
    root.current?.querySelector<SVGElement>(`[data-i="${next}"]`)?.focus();
  };
  const item = (i: number) => ({ "data-i": i, tabIndex: i === index ? 0 : -1, role: "img" as const, className: "stat-item" });
  return { root, onKeyDown, item, setActive };
}

/** Screen reader alternative to a chart: the same numbers as a table. */
export function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="stats-sr">
      <caption>{caption}</caption>
      <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>)}</tbody>
    </table>
  );
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}
