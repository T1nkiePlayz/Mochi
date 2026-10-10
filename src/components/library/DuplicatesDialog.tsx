import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import type { DuplicateGroup } from "../../lib/duplicates";
import { launchSourceOf } from "../../lib/duplicates";
import { GameArtwork } from "../GameArtwork";
import { useTranslation } from "../../lib/useTranslation";

/** "2 games appear more than once": a quiet notice above the library. */
export function DuplicatesNotice({ count, onReview }: { count: number; onReview: () => void }) {
  const t = useTranslation();
  if (!count) return null;
  return <div className="duplicates-notice" role="status">
    <Copy size={16} aria-hidden="true" />
    <span className="duplicates-notice-text"><strong>{t(count === 1 ? "{count} game appears more than once." : "{count} games appear more than once.").replace("{count}", String(count))}</strong> {t("Merge them into one entry with a \"Play via\" choice. Nothing is deleted and you can undo it.")}</span>
    <button type="button" className="secondary-button" onClick={onReview}>{t("Review")}</button>
  </div>;
}

type Props = { groups: DuplicateGroup[]; onMerge: (group: DuplicateGroup, memberIds: string[]) => void; onDismiss: (group: DuplicateGroup) => void; onClose: () => void };

/** Lists each group of copies with a checkbox per copy: Merge folds the ticked ones together, "Not the same" remembers they are different games. */
export function DuplicatesDialog({ groups, onMerge, onDismiss, onClose }: Props) {
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const close = useRef<HTMLButtonElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  // Nothing left to review: close by itself.
  useEffect(() => { if (!groups.length) latest.current(); }, [groups.length]);
  const toggle = (id: string) => setUnticked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal duplicates-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicates-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="modal-header"><div><p className="eyebrow">Library</p><h2 id="duplicates-title">Games that appear more than once</h2></div><button type="button" ref={close} className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
      <p className="modal-description">Merging keeps one entry and lets you choose which launcher to play it with. The other entries are kept inside it, so you can unmerge from the game's page at any time. No game files are touched.</p>
      <ul className="duplicates-groups">
        {groups.map((group) => {
          const ids = group.members.filter((piko) => !unticked.has(piko.id)).map((piko) => piko.id);
          return <li key={group.key} className="duplicates-group">
            <fieldset>
              <legend>{group.members[0].name}</legend>
              {group.members.map((piko) => <label key={piko.id} className="duplicates-member">
                <input type="checkbox" checked={!unticked.has(piko.id)} onChange={() => toggle(piko.id)} />
                <GameArtwork className="duplicates-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} name={piko.name} kind={piko.kind} sourceId={piko.sourceId} />
                <span className="duplicates-member-copy"><strong>{piko.name}</strong><small>{launchSourceOf(piko).label} · <span className="path-text">{piko.executablePath}</span></small></span>
              </label>)}
            </fieldset>
            <div className="duplicates-actions">
              <button type="button" className="secondary-button" onClick={() => onDismiss(group)}>Not the same</button>
              <button type="button" className="play-button" disabled={ids.length < 2} onClick={() => onMerge(group, ids)}>Merge {ids.length >= 2 ? ids.length : ""}</button>
            </div>
          </li>;
        })}
      </ul>
    </div>
  </div>;
}
