import { Play, Square, Star } from "lucide-react";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import type { PlaytimeEntry } from "../lib/platform";
import type { Piko } from "../models";
import { Art } from "./Art";

type Props = {
  piko: Piko;
  entry?: PlaytimeEntry;
  running: boolean;
  busy: boolean;
  onPlay: () => void;
  onStop: () => void;
  onFavorite: () => void;
  onPreview: (url: string) => void;
};

export function GamePage({ piko, entry, running, busy, onPlay, onStop, onFavorite, onPreview }: Props) {
  const genres = [piko.platformCategory, ...(piko.categories ?? [])].filter((value): value is string => Boolean(value));
  const year = piko.firstReleaseDate ? new Date(piko.firstReleaseDate * 1000).getFullYear() : null;
  return <section className="bp-game" aria-label={piko.name}>
    <Art piko={piko} className="bp-game-cover" />
    <div className="bp-game-info">
      <p className="bp-eyebrow">{running ? "Playing now" : entry?.lastPlayed ? `Last played ${formatRelativeTime(entry.lastPlayed)}` : "Ready to play"}</p>
      <h1 className="bp-hero-title">{piko.name}</h1>
      <div className="bp-stats">
        <div><small>Playtime</small><strong>{entry?.seconds ? formatPlaytime(entry.seconds) : "0m"}</strong></div>
        {year && <div><small>Released</small><strong>{year}</strong></div>}
        <div><small>Environments</small><strong>{piko.tofus.length}</strong></div>
      </div>
      {genres.length > 0 && <ul className="bp-genres">{genres.slice(0, 6).map((genre) => <li key={genre}>{genre}</li>)}</ul>}
      <div className="bp-hero-actions">
        {running
          ? <button type="button" className="bp-play bp-stop" data-nav-default onClick={onStop}><Square size={24} fill="currentColor" aria-hidden="true" /> Stop</button>
          : <button type="button" className="bp-play" data-nav-default disabled={busy} onClick={onPlay}><Play size={26} fill="currentColor" aria-hidden="true" /> {busy ? "Starting…" : "Play"}</button>}
        <button type="button" className="bp-secondary" aria-pressed={Boolean(piko.favorite)} onClick={onFavorite}><Star size={22} fill={piko.favorite ? "currentColor" : "none"} aria-hidden="true" /> {piko.favorite ? "Favourite" : "Add to favourites"}</button>
      </div>
      {piko.description ? <p className="bp-game-description">{piko.description}</p> : <p className="bp-game-description bp-muted">No description yet. Edit this game in Mochi to add one.</p>}
      {(piko.screenshots?.length ?? 0) > 0 && <div className="bp-screens" role="list" aria-label="Screenshots">
        {piko.screenshots!.slice(0, 12).map((url, index) => <button type="button" role="listitem" className="bp-screen" key={url} aria-label={`Screenshot ${index + 1}`} style={{ backgroundImage: `url("${url}")` }} onClick={() => onPreview(url)} />)}
      </div>}
    </div>
  </section>;
}
