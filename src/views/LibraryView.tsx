import { Gamepad2, Play, Plus, SlidersHorizontal, Settings, X } from "lucide-react";
import { GameArtwork } from "../components/GameArtwork";
import { GameDetails } from "../components/GameDetails";
import { LibraryModSearch } from "../components/LibraryModSearch";
import { MochiIcon } from "../components/MochiIcon";
import { ModrinthManager } from "../components/ModrinthManager";
import { supabase } from "../lib/supabase";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import { useApp } from "../state/AppContext";
import { usernameOf } from "../state/useAccount";
import type { LibrarySort } from "../state/useLibrary";

const greeting = () => { const hour = new Date().getHours(); return hour < 5 || hour >= 18 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon"; };

export function LibraryView() {
  const app = useApp();
  const { lib, actions, sessions, playtime, cloud, add, account, credentials, platformCapabilities } = app;
  const { selectedPiko, selectedTofu, gameDetailsId, search } = lib;
  const details = lib.library.find((piko) => piko.id === gameDetailsId);

  const addButton = <button className="secondary-button" onClick={() => add.setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button>;

  if (details) {
    return <GameDetails
      game={details}
      playtime={playtime.find((entry) => entry.gameId === gameDetailsId)}
      launchError={actions.launchError}
      launching={actions.isLaunching}
      synced={cloud.syncState === "synced"}
      running={sessions.isRunning(details.id)}
      canStop={Boolean(sessions.sessions.find((session) => session.gameId === details.id)?.canStop)}
      capabilities={platformCapabilities}
      onBack={() => lib.setGameDetailsId("")}
      onPlay={() => { lib.selectPiko(details); void actions.launchGame(details); }}
      onStop={() => void actions.stopRunningGame(details)}
      onEdit={() => app.setEditingGameId(details.id)}
      onRemove={() => actions.removeGame(details)}
      onOpenFolder={() => actions.openGameFolder(details)}
      onShortcut={() => void actions.addShortcut(details)}
      workspace={<>
        <section className="tofu-section">
          <div className="section-heading"><div><p className="eyebrow">Environments</p><h3>Your Tofus</h3></div><button className="text-button" onClick={() => app.setShowTofuManager(true)}><MochiIcon name="manage" fallback={SlidersHorizontal} size={15} /> Manage</button></div>
          <div className="tofu-grid">
            {selectedPiko.tofus.map((tofu) => (
              <button className={`tofu-card ${selectedTofu.id === tofu.id ? "active" : ""}`} key={tofu.id} onClick={() => lib.setSelectedTofuId(tofu.id)}>
                <div className="tofu-card-top"><span className="tofu-symbol">🧊</span><span className={`ready-status ${tofu.status === "Ready" ? "" : "attention"}`}><span />{tofu.status}</span></div>
                <strong>{tofu.name}</strong>
                <span className="tofu-details">{tofu.version} <i /> {tofu.runtime}</span>
                <span className="tofu-mods">{tofu.mods ? `${tofu.mods} mods installed` : "No mods installed"}</span>
              </button>
            ))}
            <button className="new-tofu-card" onClick={() => { lib.createTofu(); app.setShowTofuManager(true); }}><MochiIcon name="plus" fallback={Plus} size={17} /><span>New Tofu</span><small>Set up another environment</small></button>
          </div>
        </section>
        <section className="details-strip">
          <div><span className="detail-label">Selected Tofu</span><strong>🧊 {selectedTofu.name}</strong></div>
          <div><span className="detail-label">Runtime</span><strong>{selectedTofu.runtime} <span className="muted">· {selectedTofu.version}</span></strong></div>
          <div><span className="detail-label">Install location</span><strong className="path-text">{selectedTofu.path || "No folder chosen yet"}</strong></div>
          <button className="icon-button" aria-label="Tofu settings" onClick={() => app.setShowTofuManager(true)}><MochiIcon name="settings" fallback={Settings} size={16} /></button>
        </section>
        <ModrinthManager key={selectedTofu.id} tofu={selectedTofu} onUpdate={lib.updateSelectedTofu} />
      </>}
    />;
  }

  const user = account.user;
  const heading = <section className="page-heading">
    <div><p className="eyebrow">Your collection</p><h1>{greeting()}{user ? ", " + usernameOf(user) : ""}.</h1></div>
    {addButton}
  </section>;

  if (!lib.library.length) {
    return <>{heading}<div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>Your Mochi library is empty.</h2><p>Mochi starts clean. Add a game when you are ready.</p>{addButton}</div></>;
  }

  return <>
    {heading}
    {lib.continuePlaying.length > 0 && !search.trim() && <section className="continue-playing">
      <div className="section-heading"><div><p className="eyebrow">Jump back in</p><h3>Continue playing</h3></div></div>
      <div className="continue-grid">{lib.continuePlaying.map(({ piko, entry }) => <article className="continue-card" key={piko.id}>
        <button type="button" className="continue-main" onClick={() => { lib.selectPiko(piko); lib.setGameDetailsId(piko.id); }}>
          <GameArtwork className="continue-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} />
          <span className="continue-copy"><strong>{piko.name}</strong><small>{sessions.isRunning(piko.id) ? "Running now" : `Last played ${formatRelativeTime(entry.lastPlayed)}`} · {formatPlaytime(entry.seconds)} played</small></span>
        </button>
        {sessions.isRunning(piko.id)
          ? <button type="button" className="icon-button continue-play stop-button" aria-label={`Stop ${piko.name}`} onClick={() => void actions.stopRunningGame(piko)}><X size={15} /></button>
          : <button type="button" className="icon-button continue-play" aria-label={`Play ${piko.name}`} onClick={() => { lib.selectPiko(piko); void actions.launchGame(piko); }}><MochiIcon name="play" fallback={Play} size={15} fill="currentColor" /></button>}
      </article>)}</div>
      {actions.launchError && <p className="metadata-note">{actions.launchError}</p>}
    </section>}
    <section className="library-toolbar">
      <span className="library-count">{lib.visiblePikos.length} game{lib.visiblePikos.length === 1 ? "" : "s"}{search.trim() ? ` matching “${search.trim()}”` : ""}</span>
      <label className="library-sort"><span>Sort by</span><select value={lib.librarySort} onChange={(event) => lib.setLibrarySort(event.target.value as LibrarySort)}><option value="category">Category</option><option value="name">Name</option><option value="recent">Recently played</option><option value="playtime">Most played</option></select></label>
    </section>
    <section className="library-grid-view">
      {lib.groupedPikos.map(([category, games]) => <div className="library-category" key={category}>
        <div className="section-heading"><div><p className="eyebrow">Category</p><h3>{category}</h3></div><span className="category-count">{games.length} game{games.length === 1 ? "" : "s"}</span></div>
        <div className="game-card-grid">{games.map((piko) => <button className={`game-card ${selectedPiko.id === piko.id ? "selected" : ""}`} key={piko.id} onClick={() => { lib.selectPiko(piko); lib.setGameDetailsId(piko.id); }}>
          <GameArtwork className="game-card-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} />
          <div className="game-card-copy"><strong>{piko.name}<span className={`game-cloud-status ${cloud.syncState === "synced" ? "is-synced" : "not-synced"}`} title={cloud.syncState === "synced" ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{cloud.syncState === "synced" ? "✓" : "!"}</span></strong><small>{sessions.isRunning(piko.id) ? "Running now" : piko.categories?.join(" · ") || piko.platformCategory || "Other"}</small></div>
          <span className="game-card-play"><MochiIcon name="play" fallback={Play} size={15} fill="currentColor"/></span>
        </button>)}</div>
      </div>)}
    </section>
    <LibraryModSearch query={search} nexusEnabled={credentials.status.nexus} supabase={supabase} />
  </>;
}
