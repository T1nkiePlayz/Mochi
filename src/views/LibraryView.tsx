import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useGridKeyboard } from "../state/useGridKeyboard";
import type { Piko, Tofu } from "../models";
import { GameArtwork } from "../components/GameArtwork";
import { subscribePickerRequest, takePickerRequest } from "../lib/pickerRequest";
import { selectLaunchProfile } from "../lib/launchProfiles";
import { mergeHours } from "../state/hoursStore";
import { ruleUsesHours } from "../lib/savedFilters";
import { remainingHours } from "../lib/hoursCache";
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
import { useTranslation } from "../lib/useTranslation";

function MinecraftInstancesGroup({ piko, instances, onOpen, onPlay, onShowAll }: {
  piko: Piko;
  instances: Tofu[];
  onOpen: (piko: Piko, tofuId: string) => void;
  onPlay: (piko: Piko, tofuId: string) => void;
  onShowAll: (piko: Piko) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setHasOverflow(list.scrollHeight > list.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => observer?.disconnect();
  }, [instances.length]);

  return <div className={`tofu-entry-group${hasOverflow ? " has-overflow" : ""}`} role="group" aria-label={`${piko.name} instances`}>
    <span className="tofu-entry-title">{piko.name} instances · {instances.length}</span>
    <div className="tofu-entry-list" ref={listRef}>{instances.map((tofu) => <TofuEntryCard key={tofu.id} piko={piko} tofu={tofu} onOpen={onOpen} onPlay={onPlay} />)}</div>
    {hasOverflow && <button type="button" className="tofu-entry-more" onClick={() => onShowAll(piko)} aria-label={`Show all ${instances.length} ${piko.name} instances`}>
      Show all {instances.length} <ChevronRight size={14} />
    </button>}
  </div>;
}
import type { LibrarySort } from "../state/useLibrary";

const viewIcons: Record<LibraryViewMode, typeof LayoutGrid> = { grid: LayoutGrid, compact: Grid3x3, list: List, shelves: Rows3, large: Maximize2 };

const greeting = (t: (message: string) => string) => { const hour = new Date().getHours(); return hour < 5 || hour >= 18 ? t("Good evening") : hour < 12 ? t("Good morning") : t("Good afternoon"); };

/** IGDB time-to-beat (hours) keyed by Piko id, for pikos that have an IGDB id. */
async function loadPickerHours(pikos: Piko[]): Promise<Map<string, number>> {
  const byGame = await lookupTimeToBeat(supabase!, pikos.flatMap((piko) => (piko.igdbId ? [piko.igdbId] : [])));
  const found = new Map(pikos.flatMap((piko) => (piko.igdbId && byGame.has(piko.igdbId) ? [[piko.id, byGame.get(piko.igdbId)!] as const] : [])));
  mergeHours(found);
  return found;
}

export function LibraryView() {
  const t = useTranslation();
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
  useEffect(() => {
    if (takePickerRequest()) setShowPicker(true);
    return subscribePickerRequest(() => { if (takePickerRequest()) setShowPicker(true); });
  }, []);
  // Hours are only fetched when something needs them (an hours filter, or the backlog totals), once per game.
  const needsHours = lib.savedFilters.filters.some((item) => ruleUsesHours(item.rule)) || (lib.filter.kind === "smart" && (lib.filter.id === "backlog" || lib.filter.id === "next-up"));
  const hoursAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!needsHours || !credentials.status.igdb || !supabase) return;
    const missing = lib.library.filter((piko) => piko.igdbId && !lib.hours.has(piko.id) && !hoursAsked.current.has(piko.id));
    if (!missing.length) return;
    missing.forEach((piko) => hoursAsked.current.add(piko.id));
    void (async () => { for (let index = 0; index < missing.length; index += 100) await loadPickerHours(missing.slice(index, index + 100)).catch(() => undefined); })();
  }, [needsHours, credentials.status.igdb, lib.library, lib.hours]);
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
      selecting={selecting} checked={checked.has(piko.id)} tabStop={grid.tabId === piko.id}
      onOpen={openGame} onToggleFavorite={toggleFavorite} onToggleChecked={toggleChecked} onMenu={openMenu} />;
    if (!instances) return card;
    return [card, <MinecraftInstancesGroup key={`${piko.id}:instances`} piko={piko} instances={instances} onOpen={openInstance} onPlay={playInstance} onShowAll={openGame} />];
  };
  const toggleChecked = useCallback((gameId: string) => setChecked((current) => { const next = new Set(current); if (!next.delete(gameId)) next.add(gameId); return next; }), []);
  const openMenu = useCallback((gameId: string, x: number, y: number) => setMenu({ gameId, x, y }), []);
  const gridIds = useMemo(() => lib.groupedPikos.flatMap(([, games]) => games.map((piko) => piko.id)), [lib.groupedPikos]);
  const gridNames = useMemo(() => new Map(lib.library.map((piko) => [piko.id, piko.name] as const)), [lib.library]);
  const playById = useCallback((id: string) => { const piko = lib.library.find((item) => item.id === id); if (piko) { selectPiko(piko); void launchRef.current(piko); } }, [lib.library, selectPiko]);
  const grid = useGridKeyboard({ ids: gridIds, names: gridNames, play: playById, toggleFavorite });

  const addButton = <button className="secondary-button" onClick={() => add.setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> {t("Add Piko")}</button>;

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
      onLaunchProfileChange={(id) => lib.updateGame(details.id, { activeLaunchProfile: selectLaunchProfile(details, id) })}
      onSourceChange={(sourceId) => lib.updateGame(details.id, { preferredSource: sourceId })}
      onUnmerge={(sourceId) => duplicates.unmerge(details.id, sourceId)}
      onOpenFolder={() => actions.openGameFolder(details)}
      onShortcutLocation={(location) => void actions.createShortcut(details, location)}
      onShortcutSteam={(userId) => void actions.addToSteam(details, userId)}
      workspace={<>
        <section className="tofu-section">
          <div className="section-heading"><div><p className="eyebrow">Environments</p><h3>{t("Your Tofus")}</h3></div><button className="text-button" onClick={() => app.setShowTofuManager(true)}><MochiIcon name="manage" fallback={SlidersHorizontal} size={15} /> {t("Manage")}</button></div>
          <div className="tofu-grid">
            {selectedPiko.tofus.map((tofu) => (
              <button className={`tofu-card ${selectedTofu.id === tofu.id ? "active" : ""}`} key={tofu.id} onClick={() => lib.setSelectedTofuId(tofu.id)}>
                <div className="tofu-card-top"><span className="tofu-symbol">🧊</span><span className={`ready-status ${tofu.status === "Ready" ? "" : "attention"}`}><span />{tofu.status}</span></div>
                <strong>{tofu.name}</strong>
                <span className="tofu-details">{tofu.version} <i /> {tofu.runtime}</span>
                <span className="tofu-mods">{tofu.mods ? `${tofu.mods} mods installed` : "No mods installed"}</span>
              </button>
            ))}
            <button className="new-tofu-card" onClick={() => { lib.createTofu(); app.setShowTofuManager(true); }}><MochiIcon name="plus" fallback={Plus} size={17} /><span>{t("New Tofu")}</span><small>Set up another environment</small></button>
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
    <div><p className="eyebrow">{t("Your collection")}</p><h1>{greeting(t)}{user ? ", " + usernameOf(user) : ""}.</h1></div>
    {addButton}
  </section>;

  if (!lib.library.length) {
    return <>{heading}<div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>{t("Your Mochi library is empty.")}</h2><p>{t("Mochi starts clean. Add a game when you are ready.")}</p>{addButton}</div></>;
  }

  return <>
    {heading}
    {lib.continuePlaying.length > 0 && !search.trim() && <section className="continue-playing">
      <div className="section-heading"><div><p className="eyebrow">{t("Jump back in")}</p><h3>{t("Continue playing")}</h3></div></div>
      <div className="continue-grid">{lib.continuePlaying.map(({ piko, entry }) => <article className="continue-card" key={piko.id}>
        <button type="button" className="continue-main" onClick={() => { lib.selectPiko(piko); lib.setGameDetailsId(piko.id); }}>
          <GameArtwork className="continue-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} name={piko.name} kind={piko.kind} sourceId={piko.sourceId} />
          <span className="continue-copy"><strong>{piko.name}</strong><small>{sessions.isRunning(piko.id) ? "Running now" : `Last played ${formatRelativeTime(entry.lastPlayed)}`} · {formatPlaytime(entry.seconds)} played</small></span>
        </button>
        {sessions.isRunning(piko.id)
          ? <button type="button" className="icon-button continue-play stop-button" aria-label={t("Stop {name}").replace("{name}", piko.name)} onClick={() => void actions.stopRunningGame(piko)}><X size={15} /></button>
          : <button type="button" className="icon-button continue-play" aria-label={t("Play {name}").replace("{name}", piko.name)} onClick={() => { lib.selectPiko(piko); void actions.launchGame(piko); }}><MochiIcon name="play" fallback={Play} size={15} fill="currentColor" /></button>}
      </article>)}</div>
      {actions.launchError && <p className="metadata-note">{actions.launchError}</p>}
    </section>}
    <DuplicatesNotice count={duplicates.groups.length} onReview={() => setShowDuplicates(true)} />
    <LibraryFilterBar lib={lib} collections={collections.collections} tags={allTags} onManageCollections={() => setShowCollections(true)}
      wishlist={{ active: showWishlist, count: wishlist.items.length, onToggle: () => setShowWishlist((on) => !on) }} />
    {showWishlist ? <WishlistPanel /> : <>
    <section className="library-toolbar">
      <span className="library-count">{lib.visiblePikos.length} game{lib.visiblePikos.length === 1 ? "" : "s"}{search.trim() ? ` matching “${search.trim()}”` : ""}{(() => { if (lib.filter.kind !== "smart" || (lib.filter.id !== "backlog" && lib.filter.id !== "next-up")) return ""; const left = remainingHours(lib.visiblePikos.map((piko) => piko.id), lib.hours); return left.known ? ` · about ${left.total} h to beat (${left.known} with data)` : ""; })()}</span>
      <div className="library-toolbar-actions">
        <button type="button" className="secondary-button view-switcher" title={t("View: {view}. Click for the next view, Shift+click for the previous.").replace("{view}", t(viewModeLabel(view)))}
          aria-label={t("Library view: {view}. Activate to switch to {nextView}.").replace("{view}", t(viewModeLabel(view))).replace("{nextView}", t(viewModeLabel(cycleViewMode(view))))}
          onClick={(event) => changeView(event.shiftKey ? -1 : 1)}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); changeView(-1); } else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); changeView(1); } }}>
          <span className="view-switcher-icon" key={view}><ViewIcon size={14} /></span> <span className="view-switcher-label">{t(viewModeLabel(view))}</span>
          <span className="view-switcher-dots" aria-hidden="true">{viewModes.map((mode) => <i key={mode.id} className={mode.id === view ? "on" : ""} />)}</span>
        </button>
        <span className="library-view-announce" role="status" aria-live="polite">{`${t(viewModeLabel(view))} view`}</span>
        <button type="button" className="secondary-button" onClick={() => setShowPicker(true)}><Dices size={14} /> {t("What should I play?")}</button>
        <button type="button" className={`secondary-button ${selecting ? "active" : ""}`} aria-pressed={selecting} onClick={() => (selecting ? endSelecting() : setSelecting(true))}><CheckSquare size={14} /> {selecting ? t("Done selecting") : t("Select")}</button>
        <div className="library-sort"><span>{t("Sort by")}</span><Select<LibrarySort> label={t("Sort by")} value={lib.librarySort} onChange={lib.setLibrarySort} align="end" options={[{ value: "category", label: "Category" }, { value: "name", label: t("Name") }, { value: "recent", label: t("Recently played") }, { value: "playtime", label: t("Most played") }]} /></div>
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
    {!lib.visiblePikos.length && <div className="empty-state library-no-match"><h2>{t("No games match.")}</h2><p>Try another filter or clear the search.</p><button type="button" className="secondary-button" onClick={() => { lib.setFilter({ kind: "smart", id: "all" }); lib.setTagFilters([]); lib.setSearch(""); }}>{t("Show everything")}</button></div>}
    <section className="library-grid-view" data-view={view} data-groups={lib.groupedPikos.length} key={view} {...grid.gridProps}>
      {lib.groupedPikos.map(([category, games]) => <div className="library-category" key={category}>
        <div className="section-heading"><div><p className="eyebrow">{t("Category")}</p><h3>{category}</h3></div><span className="category-count">{t(games.length === 1 ? "{count} game" : "{count} games").replace("{count}", String(games.length))}</span></div>
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
    {removal && <ConfirmDialog title={removal.length === 1 ? t("Remove {name}?").replace("{name}", removal[0].name) : t("Remove {count} games?").replace("{count}", String(removal.length))} message="They are removed from your Mochi library only, with their Tofus, tags and collection memberships. Nothing is uninstalled and no game files are deleted." items={removal.map((game) => game.name)} confirmLabel={removal.length === 1 ? "Remove" : `Remove ${removal.length} games`} danger
      onCancel={() => setRemoval(null)}
      onConfirm={() => { removal.forEach((game) => void removeGameShortcut(game.id).catch(() => {})); lib.removeGames(removal.map((game) => game.id)); setChecked(new Set()); setRemoval(null); }} />}
    <LibraryModSearch query={search} nexusEnabled={credentials.status.nexus} supabase={supabase} />
  </>;
}
