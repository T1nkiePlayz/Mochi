import { memo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Heart, Play } from "lucide-react";
import type { Piko } from "../../models";
import { GameArtwork } from "../GameArtwork";
import { hasArtwork } from "../../lib/fallbackArt";
import { CloudBadge } from "./CloudBadge";
import type { CloudStatus } from "../../lib/cloudStatus";
import { MochiIcon } from "../MochiIcon";

type Props = {
  piko: Piko;
  selected: boolean;
  running: boolean;
  cloudStatus: CloudStatus;
  selecting: boolean;
  checked: boolean;
  // Handlers receive the game so one stable function serves every card (lets memo skip untouched cards).
  onOpen: (piko: Piko) => void;
  onToggleFavorite: (gameId: string) => void;
  onToggleChecked: (gameId: string) => void;
  onMenu: (gameId: string, x: number, y: number) => void;
};

const LONG_PRESS_MS = 550;

export const GameCard = memo(function GameCard({ piko, selected, running, cloudStatus, selecting, checked, onOpen, onToggleFavorite, onToggleChecked, onMenu }: Props) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const cancel = () => window.clearTimeout(timer.current);

  const onPointerDown = (event: PointerEvent) => {
    fired.current = false;
    if (event.pointerType === "mouse") return;
    const { clientX, clientY } = event;
    timer.current = window.setTimeout(() => { fired.current = true; onMenu(piko.id, clientX, clientY); }, LONG_PRESS_MS);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      onMenu(piko.id, box.left + box.width / 2, box.top + box.height / 2);
    }
  };

  return <article className={`game-card ${hasArtwork(piko) ? "" : "no-art"} ${selected ? "selected" : ""} ${checked ? "multi-selected" : ""} ${running ? "is-running" : ""}`}
    onContextMenu={(event) => { event.preventDefault(); onMenu(piko.id, event.clientX, event.clientY); }}
    onPointerDown={onPointerDown} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onKeyDown={onKeyDown}>
    <button type="button" className="game-card-main" aria-pressed={selecting ? checked : undefined}
      onClick={() => { if (fired.current) { fired.current = false; return; } if (selecting) onToggleChecked(piko.id); else onOpen(piko); }}>
      <GameArtwork className="game-card-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} name={piko.name} kind={piko.kind} sourceId={piko.sourceId} />
      <div className="game-card-copy">
        <strong><span className="game-card-name" title={piko.name}>{piko.name}</span><CloudBadge status={cloudStatus} /></strong>
        <small>{running ? "Running now" : piko.categories?.join(" · ") || piko.platformCategory || "Other"}</small>
        {piko.tags?.length ? <span className="game-card-tags">{piko.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</span> : null}
      </div>
      {!selecting && <span className="game-card-play"><MochiIcon name="play" fallback={Play} size={15} fill="currentColor" /></span>}
    </button>
    {selecting
      ? <span className={`game-card-check ${checked ? "on" : ""}`} aria-hidden="true">{checked && <Check size={13} />}</span>
      : <button type="button" className={`game-card-heart ${piko.favorite ? "on" : ""}`} aria-pressed={Boolean(piko.favorite)} aria-label={piko.favorite ? `Remove ${piko.name} from favourites` : `Add ${piko.name} to favourites`} onClick={() => onToggleFavorite(piko.id)}><Heart size={15} fill={piko.favorite ? "currentColor" : "none"} /></button>}
  </article>;
});
