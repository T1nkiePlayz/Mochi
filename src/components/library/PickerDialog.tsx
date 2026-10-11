import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { Dices, Play, X } from "lucide-react";
import type { Piko } from "../../models";
import { GameArtwork } from "../GameArtwork";
import { backlogLabel } from "../../lib/backlog";
import { formatPlaytime } from "../../lib/format";
import { moods, pickGame, times, type PickerContext, type PickerOptions } from "../../lib/picker";

type Props = { library: Piko[]; context: PickerContext; loadHours?: (pikos: Piko[]) => Promise<Map<string, number>>; onPlay: (piko: Piko) => void; onClose: () => void };

const choice = <T extends string>(label: string, items: Array<{ id: T; label: string }>, value: T, set: (value: T) => void) =>
  <div className="picker-group" role="group" aria-label={label}><span className="detail-label">{label}</span>
    <div className="filter-row">{items.map((item) => <button type="button" key={item.id} className={`filter-chip ${value === item.id ? "active" : ""}`} aria-pressed={value === item.id} onClick={() => set(item.id)}>{item.label}</button>)}</div></div>;

/** "What should I play?": a weighted random pick from the backlog and barely-played games, by mood, time and length. */
export function PickerDialog({ library, context: baseContext, loadHours, onPlay, onClose }: Props) {
  const t = useTranslation();
  const [hoursToBeat, setHoursToBeat] = useState<ReadonlyMap<string, number> | undefined>();
  useEffect(() => {
    if (!loadHours) return;
    let live = true;
    loadHours(library.filter((piko) => piko.igdbId)).then((hours) => { if (live) setHoursToBeat(hours); }).catch(() => {});
    return () => { live = false; };
  }, [loadHours, library]);
  const context = hoursToBeat ? { ...baseContext, hoursToBeat } : baseContext;
  const [options, setOptions] = useState<PickerOptions>({ mood: "relaxed", time: "hour", length: "any" });
  const [result, setResult] = useState<Piko | null | undefined>(undefined);
  const shown = useRef(new Set<string>());
  const change = (changes: Partial<PickerOptions>) => { setOptions((current) => ({ ...current, ...changes })); shown.current.clear(); setResult(undefined); };
  const pick = () => {
    const next = pickGame(library, options, context, Math.random, shown.current);
    if (next) { shown.current.add(next.id); setResult(next); } else setResult(null);
  };
  const seconds = result ? context.playtime.get(result.id)?.seconds ?? 0 : 0;
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal picker-dialog" role="dialog" aria-modal="true" aria-label={t("What should I play?")} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal-header"><div><p className="eyebrow">Library</p><h2>{t("What should I play?")}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
      {choice("Mood", moods, options.mood, (mood) => change({ mood }))}
      {choice("Time available", times, options.time, (time) => change({ time }))}
      {choice("Length", [{ id: "any" as const, label: "Any length" }, { id: "short" as const, label: "Short games" }], options.length, (length) => change({ length }))}
      <div aria-live="polite" className="picker-result">
        {result === null && <p className="metadata-note">Nothing to suggest. Mark games as “Want to play”, or install a few you have not tried yet.</p>}
        {result && <div className="picker-card">
          <GameArtwork className="picker-art" cacheKey={result.artworkCacheKey} fallback={result.artwork} name={result.name} kind={result.kind} sourceId={result.sourceId} />
          <div className="picker-copy"><strong>{result.name}</strong>
            <small>{result.backlog ? backlogLabel(result.backlog.status) : seconds > 0 ? `${formatPlaytime(seconds)} played` : "Never played"}{result.categories?.length ? ` · ${result.categories.slice(0, 2).join(", ")}` : ""}</small>
            {result.backlog?.note && <small className="picker-note">“{result.backlog.note}”</small>}</div>
        </div>}
      </div>
      <div className="modal-actions picker-actions">
        <button type="button" className="secondary-button" onClick={pick} autoFocus><Dices size={15} /> {result ? "Pick again" : "Pick a game"}</button>
        {result && <button type="button" className="play-button" onClick={() => { onClose(); onPlay(result); }}><Play size={15} /> Play</button>}
      </div>
    </div>
  </div>;
}
