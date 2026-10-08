import { useState } from "react";
import { ArrowLeft, ExternalLink, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { GameArtwork } from "./GameArtwork";

export function GameDetails({ game, synced, onBack, onPlay }: { game: Piko; synced: boolean; onBack: () => void; onPlay: () => void }) {
  const [playTrailer, setPlayTrailer] = useState(false);
  const trailer = game.trailerId && /^[A-Za-z0-9_-]{6,20}$/.test(game.trailerId) ? game.trailerId : "";
  return <section className="game-details-page">
    <button type="button" className="text-button game-details-back" onClick={onBack}><ArrowLeft size={15}/> Back to library</button>
    <div className="game-details-hero"><GameArtwork className="game-details-cover" cacheKey={game.artworkCacheKey} fallback={game.artwork} /><div className="game-details-title"><p className="eyebrow">{game.platformCategory || "Game"}{game.sourceId ? ` · ${game.sourceId}` : ""}</p><h2>{game.name}</h2><div className="game-details-badges">{game.categories?.map(category=><span key={category}>{category}</span>)}<span className={`game-cloud-status ${synced ? "is-synced" : "not-synced"}`} title={synced ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{synced ? "✓" : "!"} {synced ? "Synced" : "Not synced"}</span></div><p>{game.description || "No description is available yet."}</p><button type="button" className="play-button" onClick={onPlay}><Play size={15} fill="currentColor"/> Play</button></div></div>
    <div className="game-details-content">
      <section className="game-details-section"><div className="discover-section-heading"><div><h3>About {game.name}</h3><p>Game information from IGDB when available.</p></div></div><div className="game-details-info">{game.categories?.length ? <div><small>Genres</small><strong>{game.categories.join(", ")}</strong></div> : null}{game.firstReleaseDate ? <div><small>First released</small><strong>{new Date(game.firstReleaseDate * 1000).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}</strong></div> : null}<div><small>Platform</small><strong>{game.platformCategory || game.sourceId || "Custom"}</strong></div></div>{game.description && <p className="game-details-description">{game.description}</p>}</section>
      {game.screenshots?.length ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Screenshots</h3><p>Images from IGDB.</p></div></div><div className="game-screenshot-grid">{game.screenshots.map((url,index)=><img key={`${url}-${index}`} src={url} alt={`${game.name} screenshot ${index+1}`} loading="lazy" />)}</div></section> : null}
      {trailer ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Trailer</h3><p>Watch the trailer in Mochi.</p></div><button type="button" className="text-button" onClick={()=>void invoke("open_external_url",{url:`https://www.youtube.com/watch?v=${trailer}`})}><ExternalLink size={13}/> Open on YouTube</button></div><div className="game-trailer-frame">{playTrailer ? <iframe src={`https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&controls=1&playsinline=1`} title={`${game.name} trailer`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : <button type="button" className="game-trailer-start" onClick={()=>setPlayTrailer(true)}><GameArtwork className="game-trailer-poster" cacheKey={game.artworkCacheKey} fallback={game.artwork}/><span><Play size={23} fill="currentColor"/> Play trailer</span></button>}</div></section> : null}
    </div>
  </section>;
}
