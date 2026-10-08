import { useState } from "react";
import { ArrowLeft, ExternalLink, FolderOpen, Pencil, Play, Square, Trash2 } from "lucide-react";
import { openExternalUrl, type PlatformCapabilities } from "../lib/platform";
import type { Piko } from "../models";
import { GameArtwork } from "./GameArtwork";

type Props = {
  game: Piko;
  synced: boolean;
  running: boolean;
  canStop: boolean;
  capabilities: PlatformCapabilities | null;
  onBack: () => void;
  onPlay: () => void;
  onStop: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onOpenFolder: () => void;
  onShortcut: () => void;
};

export function GameDetails({ game, synced, running, canStop, capabilities, onBack, onPlay, onStop, onEdit, onRemove, onOpenFolder, onShortcut }: Props) {
  const [playTrailer, setPlayTrailer] = useState(false);
  const trailer = game.trailerId && /^[A-Za-z0-9_-]{6,20}$/.test(game.trailerId) ? game.trailerId : "";
  const folder = game.installPath || (game.executablePath?.startsWith("/") ? game.executablePath : "");
  return <section className="game-details-page">
    <button type="button" className="text-button game-details-back" onClick={onBack}><ArrowLeft size={15}/> Back to library</button>
    <div className="game-details-hero"><GameArtwork className="game-details-cover" cacheKey={game.artworkCacheKey} fallback={game.artwork} /><div className="game-details-title"><p className="eyebrow">{game.platformCategory || "Game"}{game.sourceId ? ` · ${game.sourceId}` : ""}</p><h2>{game.name}</h2><div className="game-details-badges">{game.categories?.map((category) => <span key={category}>{category}</span>)}{running && <span className="running-badge">Running</span>}<span className={`game-cloud-status ${synced ? "is-synced" : "not-synced"}`} title={synced ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{synced ? "✓" : "!"} {synced ? "Synced" : "Not synced"}</span></div><p>{game.description || "No description is available yet."}</p>
      <div className="game-details-actions">
        {running ? <button type="button" className="play-button stop-button" onClick={onStop} disabled={!canStop} title={canStop ? "Quit this game" : "Close it from its own launcher"}><Square size={14} fill="currentColor"/> Stop</button> : <button type="button" className="play-button" onClick={onPlay}><Play size={15} fill="currentColor"/> Play</button>}
        <button type="button" className="secondary-button" onClick={onEdit}><Pencil size={14}/> Edit</button>
        {folder && <button type="button" className="secondary-button" onClick={onOpenFolder}><FolderOpen size={14}/> Open folder</button>}
        {capabilities?.supportsShortcuts && <button type="button" className="secondary-button" onClick={onShortcut}>Add to app menu</button>}
        <button type="button" className="secondary-button danger-outline" onClick={onRemove}><Trash2 size={14}/> Remove</button>
      </div></div></div>
    <div className="game-details-content">
      <section className="game-details-section"><div className="discover-section-heading"><div><h3>About {game.name}</h3><p>Game information from IGDB when available.</p></div></div><div className="game-details-info">{game.categories?.length ? <div><small>Genres</small><strong>{game.categories.join(", ")}</strong></div> : null}{game.firstReleaseDate ? <div><small>First released</small><strong>{new Date(game.firstReleaseDate * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong></div> : null}<div><small>Platform</small><strong>{game.platformCategory || game.sourceId || "Custom"}</strong></div></div>{game.description && <p className="game-details-description">{game.description}</p>}</section>
      {game.screenshots?.length ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Screenshots</h3><p>Images from IGDB.</p></div></div><div className="game-screenshot-grid">{game.screenshots.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${game.name} screenshot ${index + 1}`} loading="lazy" />)}</div></section> : null}
      {trailer ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Trailer</h3><p>Watch the trailer in Mochi.</p></div><button type="button" className="text-button" onClick={() => void openExternalUrl(`https://www.youtube.com/watch?v=${trailer}`)}><ExternalLink size={13}/> Open on YouTube</button></div><div className="game-trailer-frame">{playTrailer ? <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&controls=1&playsinline=1`} title={`${game.name} trailer`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : <button type="button" className="game-trailer-start" onClick={() => setPlayTrailer(true)}><GameArtwork className="game-trailer-poster" cacheKey={game.artworkCacheKey} fallback={game.artwork}/><span><Play size={23} fill="currentColor"/> Play trailer</span></button>}</div></section> : null}
    </div>
  </section>;
}
