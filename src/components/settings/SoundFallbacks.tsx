import { useId } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Select, type SelectOption } from "../ui/Select";
import { BUILTIN_PACKS } from "../../lib/sound";
import { MAX_SOUND_FALLBACKS } from "../../lib/sound/settings";
import type { SoundPackInfo } from "../../lib/sound/packs";

/** Settings > Sound: the user's ordered fallback packs, used when the theme names none or its packs are missing or fail. */
export function SoundFallbacks({ fallbacks, packs, loaded, onChange }: { fallbacks: string[]; packs: SoundPackInfo[]; loaded: boolean; onChange: (next: string[]) => void }) {
  const t = useTranslation();
  const headingId = useId();
  const nameOf = (id: string) => BUILTIN_PACKS.find((pack) => pack.id === id)?.name ?? packs.find((pack) => pack.id === id)?.name ?? id;
  const isKnown = (id: string) => BUILTIN_PACKS.some((pack) => pack.id === id) || packs.some((pack) => pack.id === id);
  const addable: Array<SelectOption<string>> = [
    ...BUILTIN_PACKS.map((pack) => ({ value: pack.id, label: pack.name, group: "Built in" })),
    ...packs.map((pack) => ({ value: pack.id, label: pack.name, group: "Installed" })),
  ].filter((option) => !fallbacks.includes(option.value));
  const move = (index: number, by: -1 | 1) => {
    const next = [...fallbacks];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  return <div className="setting-row sound-fallbacks">
    <span><strong id={headingId}>{t("Fallback sound packs")}</strong>
      <small>{t("Tried in this order when the theme has no pack of its own, or its packs are missing or fail to load. If everything fails Mochi uses the default pack.")}</small></span>
    <div className="sound-fallbacks-body">
      {fallbacks.length > 0 && <ol className="sound-fallbacks-list" aria-labelledby={headingId}>
        {fallbacks.map((id, index) => {
          const missing = loaded && !isKnown(id);
          const name = nameOf(id);
          return <li key={id} className={`sound-fallback ${missing ? "is-missing" : ""}`}>
            <span className="sound-fallback-name">{index + 1}. {name}{missing && <small> ({t("not installed, skipped")})</small>}</span>
            <span className="sound-pack-actions">
              <button type="button" className="secondary-button sound-fallback-button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
              <button type="button" className="secondary-button sound-fallback-button" aria-label={`Move ${name} down`} disabled={index === fallbacks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
              <button type="button" className="secondary-button sound-fallback-button" aria-label={`Remove ${name} from fallbacks`} onClick={() => onChange(fallbacks.filter((item) => item !== id))}><X size={14} aria-hidden="true" /></button>
            </span>
          </li>;
        })}
      </ol>}
      {fallbacks.length < MAX_SOUND_FALLBACKS && addable.length > 0 && <Select<string> label={t("Add a fallback pack")} placeholder={t("Add a fallback pack")} value="" options={addable} onChange={(id) => id && onChange([...fallbacks, id])} align="end" />}
      {fallbacks.length === 0 && <small className="sound-fallbacks-empty">{t("No fallbacks yet.")}</small>}
    </div>
  </div>;
}
