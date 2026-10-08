import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Heart, Play } from "lucide-react";
import type { Piko } from "../../models";
import { GameArtwork } from "../GameArtwork";
import { MochiIcon } from "../MochiIcon";

type Props = {
  piko: Piko;
  selected: boolean;
  running: boolean;
  synced: boolean;
  selecting: boolean;
  checked: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onToggleChecked: () => void;
  onMenu: (x: number, y: number) => void;
};

const LONG_PRESS_MS = 550;

export function GameCard({ piko, selected, running, synced, selecting, checked, onOpen, onToggleFavorite, onToggleChecked, onMenu }: Props) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const cancel = () => window.clearTimeout(timer.current);

  const onPointerDown = (event: PointerEvent) => {
    fired.current = false;
    if (event.pointerType === "mouse") return;
    const { clientX, clientY } = event;
    timer.current = window.setTimeout(() => { fired.current = true; onMenu(clientX, clientY); }, LONG_PRESS_MS);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      onMenu(box.left + box.width / 2, box.top + box.height / 2);
    }
  };

  return <article className={`game-card ${selected ? "selected" : ""} ${checked ? "multi-selected" : ""} ${running ? "is-running" : ""}`}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
    onPointerDown={onPointerDown} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onKeyDown={onKeyDown}>
    <button type="button" className="game-card-main" aria-pressed={selecting ? checked : undefined}
      onClick={() => { if (fired.current) { fired.current = false; return; } if (selecting) onToggleChecked(); else onOpen(); }}>
      <GameArtwork className="game-card-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} />
      <div className="game-card-copy">
        <strong><span className="game-card-name">{piko.name}</span><span className={`game-cloud-status ${synced ? "is-synced" : "not-synced"}`} title={synced ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{synced ? "✓" : "!"}</span></strong>
        <small>{running ? "Running now" : piko.categories?.join(" · ") || piko.platformCategory || "Other"}</small>
        {piko.tags?.length ? <span className="game-card-tags">{piko.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</span> : null}
      </div>
      {!selecting && <span className="game-card-play"><MochiIcon name="play" fallback={Play} size={15} fill="currentColor" /></span>}
    </button>
    {selecting
      ? <span className={`game-card-check ${checked ? "on" : ""}`} aria-hidden="true">{checked && <Check size={13} />}</span>
      : <button type="button" className={`game-card-heart ${piko.favorite ? "on" : ""}`} aria-pressed={Boolean(piko.favorite)} aria-label={piko.favorite ? `Remove ${piko.name} from favourites` : `Add ${piko.name} to favourites`} onClick={onToggleFavorite}><Heart size={15} fill={piko.favorite ? "currentColor" : "none"} /></button>}
  </article>;
}
