import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { RemoteImage } from "../RemoteImage";
import { creditFor, groupBySource, imageSourceOf } from "../../lib/imageSource";

const DEFAULT_RATIO = 16 / 9;
const clampRatio = (ratio: number) => Math.min(3.2, Math.max(0.4, ratio));

/**
 * Justified-rows gallery: every image keeps its own aspect ratio and rows fill the full width, so screenshots
 * of different sizes never leave holes. Images load lazily; each opens a keyboard-driven lightbox.
 */
export function ScreenshotGallery({ urls, gameName }: { urls: string[]; gameName: string }) {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<number | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const shown = useMemo(() => urls.map((url, index) => ({ url, index })).filter((item) => !failed.has(item.url)), [urls, failed]);
  const sets = useMemo(() => groupBySource(shown.map((item) => item.url)).map((set) => ({ ...set, items: set.items.map((item) => shown[item.index]) })), [shown]);
  const position = open === null ? -1 : shown.findIndex((item) => item.index === open);

  const close = useCallback(() => {
    const index = open;
    setOpen(null);
    if (index !== null) requestAnimationFrame(() => buttons.current.get(index)?.focus({ preventScroll: true }));
  }, [open]);
  const step = (delta: number) => { if (shown.length) setOpen(shown[(position + delta + shown.length) % shown.length].index); };

  if (!shown.length) return null;
  return <div className="shot-gallery-sets">
    {sets.map((set) => <figure className="shot-set" key={set.source}>
      {sets.length > 1 && <figcaption className="shot-set-credit">{set.label}</figcaption>}
      <div className="shot-gallery game-screenshot-grid" role="list">
        {set.items.map(({ url, index }) => {
          const ratio = clampRatio(ratios[url] ?? DEFAULT_RATIO);
          return <button type="button" role="listitem" key={`${url}-${index}`} className="shot-tile" ref={(node) => { if (node) buttons.current.set(index, node); else buttons.current.delete(index); }}
            style={{ "--shot-ratio": ratio } as CSSProperties} aria-label={`Open screenshot ${index + 1} of ${urls.length}`} onClick={() => setOpen(index)}>
            <RemoteImage src={url} alt={`${gameName} screenshot ${index + 1}`} loading="lazy"
              onLoad={(event) => { const { naturalWidth: w, naturalHeight: h } = event.currentTarget; if (w && h) setRatios((current) => (current[url] === w / h ? current : { ...current, [url]: w / h })); }}
              onError={() => setFailed((current) => new Set(current).add(url))} />
          </button>;
        })}
      </div>
    </figure>)}
    {position >= 0 && <Lightbox url={shown[position].url} alt={`${gameName} screenshot ${shown[position].index + 1}`} position={position} total={shown.length} onStep={step} onFirst={() => setOpen(shown[0].index)} onLast={() => setOpen(shown[shown.length - 1].index)} onClose={close} />}
  </div>;
}

/** The credit for the section heading when every screenshot comes from one place. */
export function singleCredit(urls: string[]): string | null {
  const sources = new Set(urls.map(imageSourceOf));
  return sources.size === 1 ? creditFor([...sources][0]) : null;
}

function Lightbox({ url, alt, position, total, onStep, onFirst, onLast, onClose }: { url: string; alt: string; position: number; total: number; onStep: (delta: number) => void; onFirst: () => void; onLast: () => void; onClose: () => void }) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = { ArrowRight: () => onStep(1), ArrowLeft: () => onStep(-1), Home: onFirst, End: onLast, Escape: onClose };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    action();
  };
  const source = creditFor(imageSourceOf(url));
  return <div className="modal-backdrop shot-lightbox-backdrop" onClick={onClose}>
    <div className="shot-lightbox" role="dialog" aria-modal="true" aria-label={`Screenshot ${position + 1} of ${total}`} onKeyDown={onKeyDown} onClick={(event) => event.stopPropagation()}>
      <div className="shot-lightbox-bar">
        <span className="shot-lightbox-count" aria-live="polite">{position + 1} / {total} · {source}</span>
        <button type="button" className="icon-button" aria-label="Close" autoFocus onClick={onClose}><X size={18} /></button>
      </div>
      <div className="shot-lightbox-stage">
        {total > 1 && <button type="button" className="icon-button shot-lightbox-nav prev" aria-label="Previous screenshot" onClick={() => onStep(-1)}><ChevronLeft size={22} /></button>}
        <img key={url} src={url} alt={alt} decoding="async" />
        {total > 1 && <button type="button" className="icon-button shot-lightbox-nav next" aria-label="Next screenshot" onClick={() => onStep(1)}><ChevronRight size={22} /></button>}
      </div>
    </div>
  </div>;
}
