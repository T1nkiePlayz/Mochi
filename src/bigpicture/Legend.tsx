import { Prompt } from "../controller/glyphs";
import type { Action } from "../controller/types";
import { useTranslation } from "../lib/useTranslation";

export type LegendItem = { action: Action; label: string };

/** The button prompts along the bottom edge; reflects the connected controller family. */
export function Legend({ items }: { items: LegendItem[] }) {
  const t = useTranslation();
  return <footer className="bp-legend" aria-label={t("Controller prompts")}>
    {items.map((item) => <span className="bp-legend-item" key={item.action}><Prompt action={item.action} /><span>{t(item.label)}</span></span>)}
  </footer>;
}
