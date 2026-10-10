import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, FolderOpen, FolderPlus, Heart, Pencil, Play, Square, Trash2 } from "lucide-react";
import { GameScreenshots } from "./GameScreenshots";
import { GAME_LAUNCHER_METADATA } from "../lib/robloxCover";
import { ProtonDbBadge } from "./ProtonDbBadge";
import { openExternalUrl, type PlatformCapabilities } from "../lib/platform";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import type { Collection, Piko } from "../models";
import type { PlaytimeEntry } from "../lib/platform";
import { GameArtwork } from "./GameArtwork";
import { hasArtwork } from "../lib/fallbackArt";
import { useOnline } from "../lib/offline";
import { CloudBadge } from "./library/CloudBadge";
import type { CloudStatus } from "../lib/cloudStatus";
import { CollectionPicker } from "./library/CollectionPicker";
import { TagEditor } from "./library/TagEditor";
import { BacklogControl } from "./library/BacklogControl";
import { backlogLabel, type Backlog } from "../lib/backlog";
import { ShortcutMenu } from "./library/ShortcutMenu";
import { getShortcutTargets } from "../lib/shortcuts";
import { useDismiss } from "./library/useDismiss";
import { SteamAchievements } from "./SteamAchievements";
import { GameLogsButton } from "./GameLogs";
import { SaveBackupsButton } from "./SaveBackups";
import { steamAppIdOf } from "../lib/metadata/merge";
import { ScreenshotGallery, singleCredit } from "./details/ScreenshotGallery";
import { canPlayHlsNatively, pickTrailer } from "../lib/trailer";
import { imageSourceLabels } from "../lib/imageSource";
import { Select } from "./ui/Select";
import { GameSources } from "./details/GameSources";
import { activeSource, launchSourcesOf, sourceInstallPathFor } from "../lib/launchSources";
import { launchTargetFor } from "../lib/minecraftPiko";

type Props = {
  game: Piko;
  cloudStatus: CloudStatus;
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
  onShortcutLocation: (location: string) => void;
  onShortcutSteam: (userId: string) => void;
  collections: Collection[];
  tagSuggestions: string[];
  onToggleFavorite: () => void;
  onToggleCollection: (collectionId: string, on: boolean) => void;
  onCreateCollection: (name: string) => Collection | null;
  onTagsChange: (tags: string[]) => void;
  onBacklogChange: (backlog: Backlog | undefined) => void;
  onLaunchProfileChange?: (id: string | undefined) => void;
  /** Merged games: choose the launcher "Play" uses, and undo the merge (one source, or all). */
  onSourceChange?: (sourceId: string) => void;
  onUnmerge?: (sourceId?: string) => void;
};

export function GameDetails({ game, capabilities, cloudStatus, running, playtime, launchError, launching, workspace, mods, canStop, onBack, onPlay, onStop, onEdit, onRemove, onOpenFolder, onShortcutLocation, onShortcutSteam, collections, tagSuggestions, onToggleFavorite, onToggleCollection, onCreateCollection, onTagsChange, onBacklogChange, onLaunchProfileChange, onSourceChange, onUnmerge }: Props) {
  const [playTrailer, setPlayTrailer] = useState(false);
  const online = useOnline();
  const [showCollections, setShowCollections] = useState(false);
  const collectionAnchor = useRef<HTMLDivElement>(null);
  useDismiss(collectionAnchor, showCollections, () => setShowCollections(false));
  const memberOf = collections.filter((collection) => game.collectionIds?.includes(collection.id));
  const [videoFailed, setVideoFailed] = useState(false);
  const choice = pickTrailer(game, { canPlayHls: canPlayHlsNatively(), skipSteam: videoFailed });
  const trailer = choice.kind === "youtube" ? choice.id : "";
  const youtubeEmbedUrl = trailer ? (() => {
    const params = new URLSearchParams({ autoplay: "1", controls: "1", playsinline: "1" });
    // YouTube identifies embedded players using their HTTP Referer. Explicit origin also
    // identifies Mochi to the iframe API in web builds with a normal http(s) origin.
    if (window.location.protocol === "http:" || window.location.protocol === "https:") params.set("origin", window.location.origin);
    return `https://www.youtube.com/embed/${encodeURIComponent(trailer)}?${params.toString()}`;
  })() : "";
  const steamAppId = steamAppIdOf(game);
  const screenshots = game.screenshots ?? [];
  const screenshotCredit = singleCredit(screenshots);
  // Name the providers this game's details can come from instead of always crediting IGDB.
  const textSources = [game.igdbId ? "IGDB" : "", steamAppId !== null ? "Steam" : ""].filter(Boolean);
  const infoCredit = game.lockedFields?.includes("description") ? "Description written by you." : textSources.length ? `Details from ${textSources.join(" and ")}.` : "Details you added.";
  const coverCredit = !game.artworkSource ? "" : game.artworkSource === "custom" ? "Chosen by you" : game.artworkSource === "icon" ? "Made from the app icon" : imageSourceLabels[game.artworkSource];
  const launchTarget = launchTargetFor(game);
  const folder = sourceInstallPathFor(game) || (launchTarget?.startsWith("/") ? launchTarget : "");
  const sources = launchSourcesOf(game);
  return <section className="game-details-page">
    <button type="button" className="text-button game-details-back" onClick={onBack}><ArrowLeft size={15}/> Back to library</button>
    <div className={`game-details-hero${hasArtwork(game) ? "" : " no-art"}`}><GameArtwork className="game-details-cover" cacheKey={game.artworkCacheKey} fallback={game.artwork} name={game.name} kind={game.kind} sourceId={game.sourceId} /><div className="game-details-title"><p className="eyebrow">{game.platformCategory || "Game"}{game.sourceId ? ` · ${game.sourceId}` : ""}</p><h2>{game.name}<button type="button" className={`details-heart ${game.favorite ? "on" : ""}`} aria-pressed={Boolean(game.favorite)} aria-label={game.favorite ? "Remove from favourites" : "Add to favourites"} onClick={onToggleFavorite}><Heart size={18} fill={game.favorite ? "currentColor" : "none"} /></button></h2><div className="game-details-badges">{game.categories?.map((category) => <span key={category}>{category}</span>)}{game.backlog && <span className="backlog-badge">{backlogLabel(game.backlog.status)}</span>}{running && <span className="running-badge">Running</span>}<CloudBadge status={cloudStatus} label />{capabilities?.platform === "linux" && game.kind !== "launcher" && steamAppId !== null && <ProtonDbBadge appid={steamAppId} />}</div><p>{game.description || "No description is available yet."}</p>
      <div className="game-details-actions">
        {sources.length > 1 && onSourceChange && <div className="details-play-via"><span className="detail-label">Play via</span><Select<string> label="Play via" value={activeSource(game)?.id ?? ""} onChange={onSourceChange} options={sources.map((source) => ({ value: source.id, label: source.label }))} /></div>}
        {!running && game.launchProfiles?.length && onLaunchProfileChange ? <select className="launch-profile-select" aria-label="Launch profile" value={game.activeLaunchProfile ?? ""} onChange={(event) => onLaunchProfileChange(event.target.value || undefined)}><option value="">Default options</option>{game.launchProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        {running ? <button type="button" className="play-button stop-button" onClick={onStop} disabled={!canStop} title={canStop ? "Quit this game" : "Close it from its own launcher"}><Square size={14} fill="currentColor"/> Stop</button> : <button type="button" className="play-button" onClick={onPlay} disabled={launching}><Play size={15} fill="currentColor"/> {launching ? "Launching…" : "Play"}</button>}
        <div className="details-popover-anchor" ref={collectionAnchor}>
          <button type="button" className="secondary-button" aria-expanded={showCollections} onClick={() => setShowCollections(!showCollections)}><FolderPlus size={14}/> Add to collection…</button>
          {showCollections && <div className="library-popover"><CollectionPicker collections={collections} games={[game]} onToggle={onToggleCollection} onCreate={onCreateCollection} /></div>}
        </div>
        <button type="button" className="secondary-button" onClick={onEdit}><Pencil size={14}/> Edit</button>
        <GameLogsButton game={game} />
        <SaveBackupsButton game={game} />
        {folder && <button type="button" className="secondary-button" onClick={onOpenFolder}><FolderOpen size={14}/> Open folder</button>}
        <ShortcutMenu loadTargets={getShortcutTargets} onLocation={onShortcutLocation} onSteam={onShortcutSteam} />
        <button type="button" className="secondary-button danger-outline" onClick={onRemove}><Trash2 size={14}/> Remove</button>
      </div>
      {launchError && <p className="auth-error launch-error">{launchError}</p>}
      {memberOf.length > 0 && <div className="details-collections" aria-label="Collections">{memberOf.map((collection) => <span key={collection.id}>{collection.icon ? `${collection.icon} ` : ""}{collection.name}</span>)}</div>}
      <div className="details-backlog"><span className="detail-label">Backlog</span><BacklogControl value={game.backlog} onChange={onBacklogChange} /></div>
      <div className="details-tags"><span className="detail-label">Tags</span><TagEditor tags={game.tags ?? []} suggestions={tagSuggestions} onChange={onTagsChange} /></div>
      <dl className="game-stats">
        <div><dt>Playtime</dt><dd>{playtime ? formatPlaytime(playtime.seconds) : "—"}</dd></div>
        <div><dt>Last played</dt><dd>{running ? "Playing now" : playtime?.lastPlayed ? formatRelativeTime(playtime.lastPlayed) : "Never"}</dd></div>
        <div><dt>Launch target</dt><dd className="path-text" title={launchTarget}>{launchTarget || "Not set"}</dd></div>
      </dl></div></div>
    <div className="game-details-content game-details-primary">
      {(game.kind !== "launcher" || Boolean(game.launcherId && game.launcherId in GAME_LAUNCHER_METADATA)) && <GameScreenshots game={game} />}
      {(game.notes || game.links?.length) && <section className="game-details-section game-details-notes" aria-label={`Your notes on ${game.name}`}><div className="discover-section-heading"><div><h3>Your notes</h3><p>Only on this device and in your backups.</p></div></div>{game.notes && <p className="game-details-description" style={{ whiteSpace: "pre-wrap" }}>{game.notes}</p>}{game.links?.length ? <ul className="game-details-links">{game.links.map((link) => <li key={link.url}><button type="button" className="link-button" title={link.url} onClick={() => void openExternalUrl(link.url).catch(() => {})}>{link.label}</button></li>)}</ul> : null}</section>}
      <section className="game-details-section game-details-about" aria-label={`About ${game.name}`}><div className="discover-section-heading"><div><h3>Game information</h3><p>{infoCredit}</p></div></div><div className="game-details-info">{game.categories?.length ? <div><small>Genres</small><strong>{game.categories.join(", ")}</strong></div> : null}{game.firstReleaseDate ? <div><small>First released</small><strong>{new Date(game.firstReleaseDate * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong></div> : null}<div><small>Platform</small><strong>{game.platformCategory || game.sourceId || "Custom"}</strong></div>{coverCredit ? <div><small>Cover art</small><strong>{coverCredit}</strong></div> : null}</div>{game.description && <p className="game-details-description">{game.description}</p>}</section>
      {screenshots.length ? <section className="game-details-section game-details-screenshots"><div className="discover-section-heading"><div><h3>Screenshots</h3><p>{screenshotCredit ?? "Images from several sources."}</p></div></div><ScreenshotGallery urls={screenshots} gameName={game.name} /></section> : null}
    </div>
    {onSourceChange && onUnmerge && <div className="game-details-content"><GameSources game={game} onUse={onSourceChange} onUnmerge={onUnmerge} /></div>}
    <div className="game-workspace">{workspace}</div>
    {(steamAppId !== null || choice.kind !== "none") && <div className="game-details-content">
      {steamAppId !== null && <SteamAchievements key={steamAppId} appid={steamAppId} gameName={game.name} />}
      {choice.kind === "steam" ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Trailer</h3><p>From the Steam store.</p></div></div><div className="game-trailer-frame">{online ? <video controls preload="none" playsInline poster={choice.video.thumbnail} title={`${game.name} trailer`} onError={() => setVideoFailed(true)}>{choice.video.webm && <source src={choice.video.webm} type="video/webm" onError={choice.video.mp4 ? undefined : () => setVideoFailed(true)} />}{choice.video.mp4 && <source src={choice.video.mp4} type="video/mp4" onError={() => setVideoFailed(true)} />}{choice.video.hls && <source src={choice.video.hls} type="application/vnd.apple.mpegurl" onError={() => setVideoFailed(true)} />}</video> : <p className="game-trailer-offline">Trailer needs internet</p>}</div></section> : null}
      {trailer ? <section className="game-details-section"><div className="discover-section-heading"><div><h3>Trailer</h3><p>If the player below shows an error, watch it on YouTube instead.</p></div><button type="button" className="text-button" onClick={() => void openExternalUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(trailer)}`).catch(() => undefined)}><ExternalLink size={13}/> Watch on YouTube</button></div><div className="game-trailer-frame">{playTrailer && online ? <iframe src={youtubeEmbedUrl} title={`${game.name} trailer`} referrerPolicy="origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : <button type="button" className="game-trailer-start" disabled={!online} onClick={() => setPlayTrailer(true)}><GameArtwork className="game-trailer-poster" cacheKey={game.artworkCacheKey} fallback={game.artwork} name={game.name} kind={game.kind} sourceId={game.sourceId} /><span><Play size={23} fill="currentColor"/> {online ? "Play trailer" : "Trailer needs internet"}</span></button>}</div></section> : null}
    </div>}
    {mods && <div className="game-workspace game-mods-section">{mods}</div>}
  </section>;
}
