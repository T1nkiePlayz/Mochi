import { memo } from "react";
import { Play } from "lucide-react";
import type { Piko, Tofu } from "../../models";
import { GameArtwork } from "../GameArtwork";
import { instanceLabel } from "../../lib/libraryInstances";
import { MochiIcon } from "../MochiIcon";

type Props = {
  piko: Piko;
  tofu: Tofu;
  // Stable handlers that receive the ids, so memo can skip untouched entries.
  onOpen: (piko: Piko, tofuId: string) => void;
  onPlay: (piko: Piko, tofuId: string) => void;
};

/** One launcher instance (a Tofu) listed under its game: opens the game page on that Tofu, or launches it directly. */
export const TofuEntryCard = memo(function TofuEntryCard({ piko, tofu, onOpen, onPlay }: Props) {
  return <div className="tofu-entry">
    <button type="button" className="tofu-entry-main" aria-label={`Open ${tofu.name}`} onClick={() => onOpen(piko, tofu.id)}>
      <GameArtwork className="tofu-entry-art" cacheKey={tofu.artworkCacheKey} fallback={tofu.artwork || piko.artwork} name={tofu.name} kind={piko.kind} sourceId={piko.sourceId} />
      <span className="tofu-entry-copy"><strong title={tofu.name}>{tofu.name}</strong><small>{instanceLabel(tofu)}</small></span>
    </button>
    <button type="button" className="tofu-entry-play" aria-label={`Play ${tofu.name} (${piko.name})`} title={`Play ${tofu.name}`} onClick={() => onPlay(piko, tofu.id)}><MochiIcon name="play" fallback={Play} size={13} fill="currentColor" /></button>
  </div>;
});
