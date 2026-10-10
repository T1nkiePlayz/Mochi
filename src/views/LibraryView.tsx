import { useCallback, useMemo, useRef, useState } from "react";
import { CheckSquare, ChevronDown, ChevronRight, Gamepad2, LayoutGrid, List, Maximize2, Play, Dices, Plus, Rows3, SlidersHorizontal, Settings, Grid3x3, X } from "lucide-react";
import { BulkActionBar } from "../components/library/BulkActionBar";
import { ConfirmDialog } from "../components/library/ConfirmDialog";
import { CollectionManager } from "../components/library/CollectionManager";
import { GameCard } from "../components/library/GameCard";
import { TofuEntryCard } from "../components/library/TofuEntryCard";
import { GameContextMenu } from "../components/library/GameContextMenu";
import { LibraryFilterBar } from "../components/library/LibraryFilterBar";
import { cloudStatusFor } from "../lib/cloudStatus";
import { removeGameShortcut } from "../lib/platform";
import { cycleViewMode, readViewMode, viewModeLabel, viewModes, writeViewMode, type LibraryViewMode } from "../lib/libraryView";
import { tagCounts } from "../lib/library";
import { useWishlist } from "../lib/wishlist";
import { WishlistPanel } from "../components/library/WishlistPanel";
import { PickerDialog } from "../components/library/PickerDialog";
import { DuplicatesDialog, DuplicatesNotice } from "../components/library/DuplicatesDialog";
import { useDuplicates } from "../state/useDuplicates";
import type { Piko } from "../models";
import { GameArtwork } from "../components/GameArtwork";
import { GameDetails } from "../components/GameDetails";
import { LibraryModSearch } from "../components/LibraryModSearch";
import { MochiIcon } from "../components/MochiIcon";
import { Select } from "../components/ui/Select";
import { GameMods } from "../components/mods/GameMods";
import { supabase } from "../lib/supabase";
import { lookupTimeToBeat } from "../lib/igdb";
import { formatPlaytime, formatRelativeTime } from "../lib/format";
import { useApp } from "../state/AppContext";
import { usernameOf } from "../state/useAccount";
import type { LibrarySort } from "../state/useLibrary";

const viewIcons: Record<LibraryViewMode, typeof LayoutGrid> = { grid: LayoutGrid, compact: Grid3x3, list: List, shelves: Rows3, large: Maximize2 };

const greeting = () => { const hour = new Date().getHours(); return hour < 5 || hour >= 18 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon"; };

/** IGDB time-to-beat (hours) keyed by Piko id, for pikos that have an IGDB id. */
async function loadPickerHours(pikos: Piko[]): Promise<Map<string, number>> {
  const byGame = await lookupTimeToBeat(supabase!, pikos.flatMap((piko) => (piko.igdbId ? [piko.igdbId] : [])));
  return new Map(pikos.flatMap((piko) => (piko.igdbId && byGame.has(piko.igdbId) ? [[piko.id, byGame.get(piko.igdbId)!] as const] : [])));
}

export function LibraryView() {
  const app = useApp();
  const { lib, actions, sessions, cloud, add, account, credentials, platformCapabilities, collections } = app;
  const { selectedPiko, selectedTofu, gameDetailsId, search } = lib;
  const cloudCtx = { enabled: cloud.cloudSyncEnabled, confirmed: cloud.confirmedIds, syncState: cloud.syncState };
  const details = lib.library.find((piko) => piko.id === gameDetailsId);
  const [menu, setMenu] = useState<{ gameId: string; x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showCollections, setShowCollections] = useState(false);
  const [showWishlist, setShowWishlist] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const duplicates = useDuplicates(lib.library, lib.setLibrary);
  const wishlist = useWishlist();
  const [view, setView] = useState<LibraryViewMode>(readViewMode);
  const changeView = (step: number) => setView((current) => { const next = cycleViewMode(current, step); writeViewMode(next); return next; });
  const ViewIcon = viewIcons[view];
  const [showExtras, setShowExtras] = useState(false);
  const [removal, setRemoval] = useState<Piko[] | null>(null);
  const allTags = useMemo(() => tagCounts(lib.library), [lib.library]);
  const menuGame = menu ? lib.library.find((piko) => piko.id === menu.gameId) : undefined;
  const checkedGames = lib.library.filter((piko) => checked.has(piko.id));
  const endSelecting = () => { setSelecting(false); setChecked(new Set()); };
  const hasFolder = (game: Piko) => Boolean(game.installPath || game.executablePath?.startsWith("/"));
  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    lib.library.forEach((piko) => piko.collectionIds?.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
    return counts;
  }, [lib.library]);

  const { selectPiko, setGameDetailsId, toggleFavorite } = lib;
  const openGame = useCallback((piko: Piko) => { selectPiko(piko); setGameDetailsId(piko.id); }, [selectPiko, setGameDetailsId]);
  const { launchGame } = actions;
  const launchRef = useRef(launchGame);
  launchRef.current = launchGame;
  const openInstance = useCallback((piko: Piko, tofuId: string) => { selectPiko(piko, tofuId); setGameDetailsId(piko.id); }, [selectPiko, setGameDetailsId]);
  const playInstance = useCallback((piko: Piko, tofuId: string) => { selectPiko(piko, tofuId); void launchRef.current(piko, { tofuId }); }, [selectPiko]);
  /** The game card followed by its instance sub-entries (Minecraft), kept in one group so they flow together. */
  const cardWithInstances = (piko: Piko) => {
    const instances = lib.instancesByPiko.get(piko.id);
    const card = <GameCard key={piko.id} piko={piko}
      selected={selectedPiko.id === piko.id} running={sessions.isRunning(piko.id)} cloudStatus={cloudStatusFor(piko, cloudCtx)}
      selecting={selecting} checked={checked.has(piko.id)}
      onOpen={openGame} onToggleFavorite={toggleFavorite} onToggleChecked={toggleChecked} onMenu={openMenu} />;
    if (!instances) return card;
    return [card, <div className="tofu-entry-group" key={`${piko.id}:instances`} role="group" aria-label={`${piko.name} instances`}>
      <span className="tofu-entry-title">{piko.name} instances · {instances.length}</span>
      <div className="tofu-entry-list">{instances.map((tofu) => <TofuEntryCard key={tofu.id} piko={piko} tofu={tofu} onOpen={openInstance} onPlay={playInstance} />)}</div>
    </div>];
  };
  const toggleChecked = useCallback((gameId: string) => setChecked((current) => { const next = new Set(current); if (!next.delete(gameId)) next.add(gameId); return next; }), []);
  const openMenu = useCallback((gameId: string, x: number, y: number) => setMenu({ gameId, x, y }), []);

  const addButton = <button className="secondary-button" onClick={() => add.setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button>;

  if (details) {
    return <GameDetails
      game={details}
      playtime={lib.playtimeById.get(gameDetailsId)}
      launchError={actions.launchError}
      launching={actions.isLaunching}
      cloudStatus={cloudStatusFor(details, cloudCtx)}
      running={sessions.isRunning(details.id)}
      canStop={Boolean(sessions.sessions.find((session) => session.gameId === details.id)?.canStop)}
      capabilities={platformCapabilities}
      onBack={() => lib.setGameDetailsId("")}
      onPlay={() => { const tofuId = selectedPiko.id === details.id ? selectedTofu.id : undefined; lib.selectPiko(details, tofuId); void actions.launchGame(details, { tofuId }); }}
      onStop={() => void actions.stopRunningGame(details)}
      onEdit={() => app.setEditingGameId(details.id)}
      onRemove={() => actions.removeGame(details)}
      collections={collections.collections}
      tagSuggestions={allTags.map(([tag]) => tag)}
      onToggleFavorite={() => lib.toggleFavorite(details.id)}
      onToggleCollection={(collectionId, on) => lib.setCollectionMembership([details.id], collectionId, on)}
      onCreateCollection={(name) => collections.createCollection(name)}
      onTagsChange={(tags) => lib.updateGame(details.id, { tags })}
      onBacklogChange={(backlog) => lib.updateGame(details.id, { backlog })}
      onSourceChange={(sourceId) => lib.updateGame(details.id, { preferredSource: sourceId })}
      onUnmerge={(sourceId) => duplicates.unmerge(details.id, sourceId)}
      onOpenFolder={() => actions.openGameFolder(details)}
      onShortcutLocation={(location) => void actions.createShortcut(details, location)}
      onShortcutSteam={(userId) => void actions.addToSteam(details, userId)}
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
      </>}
      mods={<GameMods key={`${details.id}:${selectedTofu.id}`} piko={details} tofu={selectedTofu} onUpdate={lib.updateSelectedTofu} />}
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
          <GameArtwork className="continue-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} name={piko.name} kind={piko.kind} sourceId={piko.sourceId} />
          <span className="continue-copy"><strong>{piko.name}</strong><small>{sessions.isRunning(piko.id) ? "Running now" : `Last played ${formatRelativeTime(entry.lastPlayed)}`} · {formatPlaytime(entry.seconds)} played</small></span>
        </button>
        {sessions.isRunning(piko.id)
          ? <button type="button" className="icon-button continue-play stop-button" aria-label={`Stop ${piko.name}`} onClick={() => void actions.stopRunningGame(piko)}><X size={15} /></button>
          : <button type="button" className="icon-button continue-play" aria-label={`Play ${piko.name}`} onClick={() => { lib.selectPiko(piko); void actions.launchGame(piko); }}><MochiIcon name="play" fallback={Play} size={15} fill="currentColor" /></button>}
      </article>)}</div>
      {actions.launchError && <p className="metadata-note">{actions.launchError}</p>}
    </section>}
    <DuplicatesNotice count={duplicates.groups.length} onReview={() => setShowDuplicates(true)} />
    <LibraryFilterBar lib={lib} collections={collections.collections} tags={allTags} onManageCollections={() => setShowCollections(true)}
      wishlist={{ active: showWishlist, count: wishlist.items.length, onToggle: () => setShowWishlist((on) => !on) }} />
    {showWishlist ? <WishlistPanel /> : <>
    <section className="library-toolbar">
      <span className="library-count">{lib.visiblePikos.length} game{lib.visiblePikos.length === 1 ? "" : "s"}{search.trim() ? ` matching “${search.trim()}”` : ""}</span>
      <div className="library-toolbar-actions">
        <button type="button" className="secondary-button view-switcher" title={`View: ${viewModeLabel(view)}. Click for the next view, Shift+click for the previous.`}
          aria-label={`Library view: ${viewModeLabel(view)}. Activate to switch to ${viewModeLabel(cycleViewMode(view))}.`}
          onClick={(event) => changeView(event.shiftKey ? -1 : 1)}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); changeView(-1); } else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); changeView(1); } }}>
          <span className="view-switcher-icon" key={view}><ViewIcon size={14} /></span> <span className="view-switcher-label">{viewModeLabel(view)}</span>
          <span className="view-switcher-dots" aria-hidden="true">{viewModes.map((mode) => <i key={mode.id} className={mode.id === view ? "on" : ""} />)}</span>
        </button>
        <span className="library-view-announce" role="status" aria-live="polite">{`${viewModeLabel(view)} view`}</span>
        <button type="button" className="secondary-button" onClick={() => setShowPicker(true)}><Dices size={14} /> What should I play?</button>
        <button type="button" className={`secondary-button ${selecting ? "active" : ""}`} aria-pressed={selecting} onClick={() => (selecting ? endSelecting() : setSelecting(true))}><CheckSquare size={14} /> {selecting ? "Done selecting" : "Select"}</button>
        <div className="library-sort"><span>Sort by</span><Select<LibrarySort> label="Sort by" value={lib.librarySort} onChange={lib.setLibrarySort} align="end" options={[{ value: "category", label: "Category" }, { value: "name", label: "Name" }, { value: "recent", label: "Recently played" }, { value: "playtime", label: "Most played" }]} /></div>
      </div>
    </section>
    {selecting && <BulkActionBar games={checkedGames} collections={collections.collections}
      onToggleCollection={(collectionId, on) => lib.setCollectionMembership(checkedGames.map((piko) => piko.id), collectionId, on)}
      onCreateCollection={(name) => collections.createCollection(name)}
      onAddTag={(tag) => lib.addTagToGames(checkedGames.map((piko) => piko.id), tag)}
      onFavorite={(on) => lib.setFavorites(checkedGames.map((piko) => piko.id), on)}
      onRemove={() => setRemoval(checkedGames)}
      onSelectAll={() => setChecked(new Set(lib.visiblePikos.map((piko) => piko.id)))}
      onDone={endSelecting} />}
    {!lib.visiblePikos.length && <div className="empty-state library-no-match"><h2>No games match.</h2><p>Try another filter or clear the search.</p><button type="button" className="secondary-button" onClick={() => { lib.setFilter({ kind: "smart", id: "all" }); lib.setTagFilters([]); lib.setSearch(""); }}>Show everything</button></div>}
    <section className="library-grid-view" data-view={view} data-groups={lib.groupedPikos.length} key={view}>
      {lib.groupedPikos.map(([category, games]) => <div className="library-category" key={category}>
        <div className="section-heading"><div><p className="eyebrow">Category</p><h3>{category}</h3></div><span className="category-count">{games.length} game{games.length === 1 ? "" : "s"}</span></div>
        <div className="game-card-grid">{games.map(cardWithInstances)}</div>
      </div>)}
    </section>
    {lib.extraPikos.length > 0 && <section className="library-extras" aria-label="Soundtracks and extras">
      <button type="button" className="text-button library-extras-toggle" aria-expanded={showExtras} aria-controls="library-extras-grid" onClick={() => setShowExtras(!showExtras)}>
        {showExtras ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Soundtracks &amp; extras ({lib.extraPikos.length})
      </button>
      {showExtras && <div className="game-card-grid" id="library-extras-grid">{lib.extraPikos.map((piko) => <GameCard key={piko.id} piko={piko}
        selected={selectedPiko.id === piko.id} running={sessions.isRunning(piko.id)} cloudStatus={cloudStatusFor(piko, cloudCtx)}
        selecting={selecting} checked={checked.has(piko.id)}
        onOpen={openGame} onToggleFavorite={toggleFavorite} onToggleChecked={toggleChecked} onMenu={openMenu} />)}</div>}
    </section>}
    </>}
    {menu && menuGame && <GameContextMenu game={menuGame} x={menu.x} y={menu.y} collections={collections.collections} canOpenFolder={hasFolder(menuGame)}
      onClose={() => setMenu(null)}
      onPlay={() => { lib.selectPiko(menuGame); void actions.launchGame(menuGame); }}
      onFavorite={() => lib.toggleFavorite(menuGame.id)}
      onToggleCollection={(collectionId, on) => lib.setCollectionMembership([menuGame.id], collectionId, on)}
      onCreateCollection={(name) => collections.createCollection(name)}
      onBacklog={(backlog) => lib.updateGame(menuGame.id, { backlog })}
      onEdit={() => app.setEditingGameId(menuGame.id)}
      onOpenFolder={() => actions.openGameFolder(menuGame)}
      onRemove={() => setRemoval([menuGame])} />}
    {showPicker && <PickerDialog library={lib.library} loadHours={credentials.status.igdb && supabase ? loadPickerHours : undefined} context={{ playtime: lib.playtimeById, isInstalled: (piko) => Boolean(piko.executablePath) && lib.installed.get(piko.executablePath ?? "") !== false }}
      onPlay={(piko) => { lib.selectPiko(piko); void actions.launchGame(piko); }} onClose={() => setShowPicker(false)} />}
    {showDuplicates && <DuplicatesDialog groups={duplicates.groups} onMerge={duplicates.merge} onDismiss={duplicates.dismiss} onClose={() => setShowDuplicates(false)} />}
    {showCollections && <CollectionManager state={collections} counts={collectionCounts} onClose={() => setShowCollections(false)} />}
    {removal && <ConfirmDialog title={removal.length === 1 ? `Remove ${removal[0].name}?` : `Remove ${removal.length} games?`} message="They are removed from your Mochi library only, with their Tofus, tags and collection memberships. Nothing is uninstalled and no game files are deleted." items={removal.map((game) => game.name)} confirmLabel={removal.length === 1 ? "Remove" : `Remove ${removal.length} games`} danger
      onCancel={() => setRemoval(null)}
      onConfirm={() => { removal.forEach((game) => void removeGameShortcut(game.id).catch(() => {})); lib.removeGames(removal.map((game) => game.id)); setChecked(new Set()); setRemoval(null); }} />}
    <LibraryModSearch query={search} nexusEnabled={credentials.status.nexus} supabase={supabase} />
  </>;
}
