import { RemoteImage } from "./RemoteImage";
import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, FolderOpen, FolderPlus, Heart, Pencil, Play, Square, Trash2 } from "lucide-react";
import { openExternalUrl, type PlatformCapabilities } from "../lib/platform";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import type { Collection, Piko } from "../models";
import type { PlaytimeEntry } from "../lib/platform";
import { GameArtwork } from "./GameArtwork";
import { hasArtwork } from "../lib/fallbackArt";
import { useOnline } from "../lib/offline";
import { CollectionPicker } from "./library/CollectionPicker";
import { TagEditor } from "./library/TagEditor";
import { useDismiss } from "./library/useDismiss";
import { SteamAchievements } from "./SteamAchievements";
import { GameLogsButton } from "./GameLogs";
import { steamAppIdOf } from "../lib/metadata/merge";

type Props = {
  game: Piko;
  synced: boolean;
  running: boolean;
  playtime?: PlaytimeEntry;
  launchError: string;
  launching: boolean;
  workspace: ReactNode;
  /** Rendered last on the page (the mods widget). */
  mods?: ReactNode;
  canStop: boolean;
  capabilities: PlatformCapabilities | null;
  onBack: () => void;
  onPlay: () => void;
  onStop: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onOpenFolder: () => void;
  onShortcut: () => void;
  collections: Collection[];
  tagSuggestions: string[];
  onToggleFavorite: () => void;
  onToggleCollection: (collectionId: string, on: boolean) => void;
  onCreateCollection: (name: string) => Collection | null;
  onTagsChange: (tags: string[]) => void;
};

export function GameDetails({ game, synced, running, playtime, launchError, launching, workspace, mods, canStop, capabilities, onBack, onPlay, onStop, onEdit, onRemove, onOpenFolder, onShortcut, collections, tagSuggestions, onToggleFavorite, onToggleCollection, onCreateCollection, onTagsChange }: Props) {
  const [playTrailer, setPlayTrailer] = useState(false);
  const online = useOnline();
  const [showCollections, setShowCollections] = useState(false);
  const collectionAnchor = useRef<HTMLDivElement>(null);
  useDismiss(collectionAnchor, showCollections, () => setShowCollections(false));
  const memberOf = collections.filter((collection) => game.collectionIds?.includes(collection.id));
  const trailer = game.trailerId && /^[A-Za-z0-9_-]{6,20}$/.test(game.trailerId) ? game.trailerId : "";
  const steamAppId = steamAppIdOf(game);
  const folder = game.installPath || (game.executablePath?.startsWith("/") ? game.executablePath : "");
  return <section className="game-details-page">
    <button type="button" className="text-button game-details-back" onClick={onBack}><ArrowLeft size={15}/> Back to library</button>
    <div className={`game-details-hero${hasArtwork(game) ? "" : " no-art"}`}><GameArtwork className="game-details-cover" cacheKey={game.artworkCacheKey} fallback={game.artwork} name={game.name} kind={game.kind} sourceId={game.sourceId} /><div className="game-details-title"><p className="eyebrow">{game.platformCategory || "Game"}{game.sourceId ? ` · ${game.sourceId}` : ""}</p><h2>{game.name}<button type="button" className={`details-heart ${game.favorite ? "on" : ""}`} aria-pressed={Boolean(game.favorite)} aria-label={game.favorite ? "Remove from favourites" : "Add to favourites"} onClick={onToggleFavorite}><Heart size={18} fill={game.favorite ? "currentColor" : "none"} /></button></h2><div className="game-details-badges">{game.categories?.map((category) => <span key={category}>{category}</span>)}{running && <span className="running-badge">Running</span>}<span className={`game-cloud-status ${synced ? "is-synced" : "not-synced"}`} title={synced ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{synced ? "✓" : "!"} {synced ? "Synced" : "Not synced"}</span></div><p>{game.description || "No description is available yet."}</p>
      <div className="game-details-actions">
        {running ? <button type="button" className="play-button stop-button" onClick={onStop} disabled={!canStop} title={canStop ? "Quit this game" : "Close it from its own launcher"}><Square size={14} fill="currentColor"/> Stop</button> : <button type="button" className="play-button" onClick={onPlay} disabled={launching}><Play size={15} fill="currentColor"/> {launching ? "Launching…" : "Play"}</button>}
        <div className="details-popover-anchor" ref={collectionAnchor}>
          <button type="button" className="secondary-button" aria-expanded={showCollections} onClick={() => setShowCollections(!showCollections)}><FolderPlus size={14}/> Add to collection…</button>
          {showCollections && <div className="library-popover"><CollectionPicker collections={collections} games={[game]} onToggle={onToggleCollection} onCreate={onCreateCollection} /></div>}
        </div>
        <button type="button" className="secondary-button" onClick={onEdit}><Pencil size={14}/> Edit</button>
        <GameLogsButton game={game} />
        {folder && <button type="button" className="secondary-button" onClick={onOpenFolder}><FolderOpen size={14}/> Open folder</button>}
        {capabilities?.supportsShortcuts && <button type="button" className="secondary-button" onClick={onShortcut}>Add to app menu</button>}
        <button type="button" className="secondary-button danger-outline" onClick={onRemove}><Trash2 size={14}/> Remove</button>
      </div>
      {launchError && <p className="auth-error launch-error">{launchError}</p>}
      {memberOf.length > 0 && <div className="details-collections" aria-label="Collections">{memberOf.map((collection) => <span key={collection.id}>{collection.icon ? `${collection.icon} ` : ""}{collection.name}</span>)}</div>}
      <div className="details-tags"><span className="detail-label">Tags</span><TagEditor tags={game.tags ?? []} suggestions={tagSuggestions} onChange={onTagsChange} /></div>
      <dl className="game-stats">
        <div><dt>Playtime</dt><dd>{playtime ? formatPlaytime(playtime.seconds) : "—"}</dd></div>
        <div><dt>Last played</dt><dd>{running ? "Playing now" : playtime?.lastPlayed ? formatRelativeTime(playtime.lastPlayed) : "Never"}</dd></div>
        <div><dt>Launch target</dt><dd className="path-text" title={game.executablePath}>{game.executablePath || "Not set"}</dd></div>
      </dl></div></div>
    <div className="game-workspace">{workspace}</div>
    <div className="game-details-content">
      <section className="game-details-section"><div className="discover-section-heading"><div><h3>About {game.name}</h3><p>Game information from IGDB when available.</p></div></div><div className="game-details-info">{game.categories?.length ? <div><small>Genres</small><strong>{game.categories.join(", ")}</strong></div> : null}{game.firstReleaseDate ? <div><small>First released</small><strong>{new Date(game.firstReleaseDate * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong></div> : null}<div><small>Platform</small><strong>{game.platformCategory || game.sourceId || "Custom"}</strong></div></div>{game.description && <p className="game-details-description">{game.description}</p>}</section>
      {steamAppId !== null && <SteamAchievements key={steamAppId} appid={steamAppId} gameName={game.name} />}
      {game.screenshots?.length ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Screenshots</h3><p>Images from IGDB.</p></div></div><div className="game-screenshot-grid">{game.screenshots.map((url, index) => <RemoteImage key={`${url}-${index}`} src={url} alt={`${game.name} screenshot ${index + 1}`} loading="lazy" />)}</div></section> : null}
      {trailer ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Trailer</h3><p>Watch the trailer in Mochi.</p></div><button type="button" className="text-button" onClick={() => void openExternalUrl(`https://www.youtube.com/watch?v=${trailer}`).catch(() => undefined)}><ExternalLink size={13}/> Open on YouTube</button></div><div className="game-trailer-frame">{playTrailer && online ? <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&controls=1&playsinline=1`} title={`${game.name} trailer`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : <button type="button" className="game-trailer-start" disabled={!online} onClick={() => setPlayTrailer(true)}><GameArtwork className="game-trailer-poster" cacheKey={game.artworkCacheKey} fallback={game.artwork} name={game.name} kind={game.kind} sourceId={game.sourceId} /><span><Play size={23} fill="currentColor"/> {online ? "Play trailer" : "Trailer needs internet"}</span></button>}</div></section> : null}
    </div>
    {mods && <div className="game-workspace game-mods-section">{mods}</div>}
  </section>;
}
