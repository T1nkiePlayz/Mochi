import { Prompt } from "../controller/glyphs";
import type { Action } from "../controller/types";

export type LegendItem = { action: Action; label: string };

/** The button prompts along the bottom edge; reflects the connected controller family. */
export function Legend({ items }: { items: LegendItem[] }) {
  return <footer className="bp-legend" aria-label="Controller prompts">
    {items.map((item) => <span className="bp-legend-item" key={item.action}><Prompt action={item.action} /><span>{item.label}</span></span>)}
  </footer>;
}
