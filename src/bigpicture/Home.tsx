import { memo } from "react";
import { Play, Star } from "lucide-react";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import type { PlaytimeEntry } from "../lib/platform";
import type { Piko } from "../models";
import { Art, hasCardArt } from "./Art";
import { useTranslation } from "../lib/useTranslation";

export type ShelfData = { id: string; title: string; items: Piko[] };

export const GameCard = memo(function GameCard({ piko, running, onOpen, onFocus }: { piko: Piko; running: boolean; onOpen: (piko: Piko) => void; onFocus: (piko: Piko) => void }) {
  const t = useTranslation();
  // Generated covers keep their title even when titles are hidden: initials alone do not identify a game.
  return <button type="button" className={`bp-card ${hasCardArt(piko) ? "" : "is-generated"}`.trim()} data-card-id={piko.id} aria-label={`${piko.name}${running ? `, ${t("playing now")}` : ""}${piko.favorite ? `, ${t("favourite")}` : ""}`}
    onClick={() => onOpen(piko)} onFocus={() => onFocus(piko)}>
    <Art piko={piko} />
    <span className="bp-card-shade" aria-hidden="true" />
    {running && <span className="bp-badge bp-badge-live">{t("Playing")}</span>}
    {piko.favorite && <Star className="bp-card-star" size={20} fill="currentColor" aria-hidden="true" />}
    <span className="bp-card-title">{piko.name}</span>
  </button>;
});

function Hero({ piko, entry, running, onPlay, onOpen }: { piko: Piko; entry?: PlaytimeEntry; running: boolean; onPlay: (piko: Piko) => void; onOpen: (piko: Piko) => void }) {
  const t = useTranslation();
  return <section className="bp-hero" aria-label={t("Featured game")}>
    <div className="bp-hero-copy" key={piko.id}>
      <p className="bp-eyebrow">{running ? t("Playing now") : entry?.lastPlayed ? `${t("Last played")} ${formatRelativeTime(entry.lastPlayed)}` : piko.platformCategory || t("In your library")}</p>
      <h1 className="bp-hero-title">{piko.name}</h1>
      <p className="bp-hero-meta">
        {entry?.seconds ? <span>{formatPlaytime(entry.seconds)} {t("played")}</span> : <span>{t("Not played yet")}</span>}
        {piko.platformCategory && <span>{piko.platformCategory}</span>}
        {(piko.categories ?? []).slice(0, 2).map((category) => <span key={category}>{category}</span>)}
      </p>
      {piko.description && <p className="bp-hero-description">{piko.description}</p>}
      <div className="bp-hero-actions">
        <button type="button" className="bp-play" data-nav-default onClick={() => onPlay(piko)}><Play size={26} fill="currentColor" aria-hidden="true" /> {running ? t("Playing") : t("Play")}</button>
        <button type="button" className="bp-secondary" onClick={() => onOpen(piko)}>{t("Details")}</button>
      </div>
    </div>
  </section>;
}

type Props = {
  hero: Piko | undefined;
  entryFor: (id: string) => PlaytimeEntry | undefined;
  shelves: ShelfData[];
  query: string;
  isRunning: (id: string) => boolean;
  onOpen: (piko: Piko) => void;
  onPlay: (piko: Piko) => void;
  onFocusCard: (piko: Piko) => void;
  onExit: () => void;
  /** Wrap cards into a grid instead of horizontal shelves. */
  grid: boolean;
};

export function Home({ hero, entryFor, shelves, query, isRunning, onOpen, onPlay, onFocusCard, onExit, grid }: Props) {
  const t = useTranslation();
  if (!hero) {
    return <section className="bp-empty" aria-live="polite">
      <h1>{t("Nothing to play yet.")}</h1>
      <p>{t("Add games in Mochi, then come back. Everything you add shows up here.")}</p>
      <button type="button" className="bp-play" data-nav-default onClick={onExit}>{t("Exit Big Picture")}</button>
    </section>;
  }
  return <>
    {!query && <Hero piko={hero} entry={entryFor(hero.id)} running={isRunning(hero.id)} onPlay={onPlay} onOpen={onOpen} />}
    {query && !shelves.some((shelf) => shelf.items.length) && <section className="bp-empty" aria-live="polite"><h1>{t("No games match “{query}”.").replace("{query}", query)}</h1><p>{t("Press B to clear the search.")}</p></section>}
    {shelves.filter((shelf) => shelf.items.length).map((shelf) => <section className="bp-shelf" key={shelf.id} data-shelf={shelf.id} aria-label={shelf.title}>
      <h2 className="bp-shelf-title">{shelf.title}<span>{shelf.items.length}</span></h2>
      <div className={grid ? "bp-shelf-grid" : "bp-shelf-row"}>
        {shelf.items.map((piko) => <GameCard key={piko.id} piko={piko} running={isRunning(piko.id)} onOpen={onOpen} onFocus={onFocusCard} />)}
      </div>
    </section>)}
  </>;
}
