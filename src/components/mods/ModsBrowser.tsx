import { useCallback, useEffect, useMemo, useState } from "react";
import { metaFromModFile } from "../../lib/mods/compat";
import { metasOfItem } from "../../lib/mods/itemMeta";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Search, WifiOff } from "lucide-react";
import type { ModCategory, ModFile, ModItem, ModSource } from "../../lib/mods/types";
import { type EcosystemRef } from "../../lib/mods/gameSupport";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { TofuPicker } from "../discover/TofuPicker";
import { ProjectSkeletons } from "../discover/ProjectCard";
import { useSentinel } from "../discover/useSentinel";
import { Select } from "../ui/Select";
import { CurseforgeCredit } from "./CurseforgeCredit";
import { InstallNoticeBar } from "./InstallNoticeBar";
import { ModCard } from "./ModCard";
import { ModDetailsModal } from "./ModDetailsModal";
import { useModFeed } from "./useModFeed";
import { useModInstall } from "./useModInstall";
import { ensureTofuFolder } from "../../lib/mods/autoFolder";
import { applyUpdates } from "../../state/modUpdates";
import { useInstallState } from "./useInstallState";
import { WindowedGrid } from "./WindowedGrid";

type Filter = { gameVersion?: string; loader?: string };

/** Where downloads go: one known Tofu (game page), or whichever Tofu the user picks per mod (Discover). */
export type ModsTarget =
  | { kind: "tofu"; tofu: Tofu; onUpdateTofu: (patch: Partial<Tofu>) => void; /** The game that owns the Tofu, so a missing folder can be detected instead of asked for. */ piko?: Piko }
  | { kind: "choose"; pikos: Piko[]; ecosystem: EcosystemRef; /** Name of the game, used to find its Tofus when the game is not linked to the mod site yet. */ gameName?: string; /** Version/loader narrowing derived from the chosen Tofu. */ tofuFilter?: (tofu: Tofu, item: ModItem) => Filter | undefined };

type Props = {
  source: ModSource;
  target: ModsTarget;
  /** Minecraft version / loader narrowing of the list itself (Minecraft only). */
  filter?: Filter;
  /** Shown in empty and error text, e.g. "Stardew Valley mods". */
  noun: string;
  /** Game pages: show this many first, then "Show more" switches to infinite scrolling. */
  collapsedCount?: number;
};

/** Search, filter and download mods from one source straight into the selected Tofu. */
export function ModsBrowser({ source, target, filter, noun, collapsedCount }: Props) {
  const { lib, downloads } = useApp();
  const active = downloads.filter((entry) => (tofu ? entry.tofuId === tofu.id : true) && entry.status === "downloading").length;
  const tofu = target.kind === "tofu" ? target.tofu : null;
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState(source.defaultSort);
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<ModCategory[]>([]);
  const [viewing, setViewing] = useState<ModItem | null>(null);
  const [picking, setPicking] = useState<{ item: ModItem; file?: ModFile } | null>(null);
  const install = useModInstall();
  const stateOf = useInstallState(tofu);
  const [expanded, setExpanded] = useState(!collapsedCount);

  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    let live = true;
    setSort(source.defaultSort); setCategoryId(""); setCategories([]);
    void source.categories().then((next) => { if (live) setCategories(next); }).catch(() => { if (live) setCategories([]); });
    return () => { live = false; };
  }, [source]);

  // A text query on a source without ranking by relevance falls back to its first sort; nothing else to adjust.
  const query = useMemo(() => ({ query: debounced, sort, categoryId: categoryId || undefined, gameVersion: filter?.gameVersion || undefined, loader: filter?.loader || undefined }), [debounced, sort, categoryId, filter?.gameVersion, filter?.loader]);
  const feed = useModFeed(source, query);
  const sentinel = useSentinel(feed.loadMore, expanded && feed.hasMore && !feed.loading && !feed.loadingMore && !feed.error, feed.items.length);
  // A new search or filter starts collapsed again.
  useEffect(() => { if (collapsedCount) setExpanded(false); }, [collapsedCount, query]);


  /** The Tofu with a folder: the detected one when it has none yet, and only when nothing was detected, the user's pick. `owner` is the game that holds the Tofu. */
  const withFolder = useCallback(async (chosen: Tofu, owner?: Piko): Promise<Tofu | null> => {
    if (chosen.path) return chosen;
    const game = owner ?? (target.kind === "tofu" ? target.piko : undefined);
    const save = (patch: Partial<Tofu>) => {
      if (target.kind === "tofu") target.onUpdateTofu(patch);
      else if (owner) lib.updateGame(owner.id, { tofus: owner.tofus.map((entry) => entry.id === chosen.id ? { ...entry, ...patch } : entry) });
    };
    const detected = game ? await ensureTofuFolder(game, chosen, save) : null;
    if (detected) return detected;
    const folder = await open({ directory: true, multiple: false, title: `Choose a folder for ${chosen.name}` });
    if (typeof folder !== "string") return null;
    if (target.kind === "tofu") target.onUpdateTofu({ path: folder });
    else if (owner) lib.updateGame(owner.id, { tofus: owner.tofus.map((entry) => entry.id === chosen.id ? { ...entry, path: folder } : entry) });
    return { ...chosen, path: folder };
  }, [target, lib]);

  const run = useCallback(async (item: ModItem, file: ModFile | undefined, chosen: Tofu, owner?: Piko, force = false) => {
    const ready = await withFolder(chosen, owner);
    if (!ready) return;
    if (file) await install.installFile(source, item, file, ready);
    else await install.installBest(source, item, ready, target.kind === "choose" ? target.tofuFilter?.(ready, item) : filter, force);
  }, [withFolder, install, source, target, filter]);

  /** Card or modal action: download now (known Tofu) or ask which Tofu (Discover). */
  const act = useCallback((item: ModItem, file?: ModFile) => {
    if (target.kind === "tofu") void run(item, file, target.tofu);
    else setPicking({ item, file });
  }, [target, run]);

  const shown = expanded || !collapsedCount ? feed.items : feed.items.slice(0, collapsedCount);
  /** "Update available" on a card: install the update found by the Tofu's update check. */
  const update = useCallback((item: ModItem) => {
    const state = stateOf(item);
    if (!tofu || state.kind !== "update") return;
    void applyUpdates(tofu, [state.update]);
  }, [stateOf, tofu]);

  const categoryOptions = [{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))];
  const filtered = Boolean(debounced || categoryId);
  const busy = install.busyId !== "";
  const actionLabel = target.kind === "tofu" ? "Download" : "Choose Tofu instance";

  return <div className="mods-browser">
    <div className="mods-controls">
      <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${noun}...`} aria-label={`Search ${noun}`} /></label>
      {categories.length > 0 && <div className="discover-select-wrap"><span>Category</span><Select value={categoryId} onChange={setCategoryId} options={categoryOptions} label="Category" searchable={categories.length > 8} /></div>}
      <div className="discover-select-wrap"><span>Sort</span><Select value={sort} onChange={setSort} options={source.sorts} label="Sort" searchable={false} align="end" /></div>
    </div>
    <InstallNoticeBar notice={install.notice} onDismiss={() => install.setNotice(null)} />
    {active > 0 && <p className="metadata-note" role="status">{active} download{active === 1 ? "" : "s"} in progress. See Downloads.</p>}
    {!source.searchesServerSide && debounced && <p className="metadata-note">Nexus Mods cannot search by text, so this filters the mods Mochi has loaded so far. Scroll to load more.</p>}
    <div className="mods-heading"><span aria-live="polite">{feed.loading ? "Loading..." : `${feed.items.length.toLocaleString()} of ${feed.total.toLocaleString()} ${noun}`}</span>{(source.id === "curseforge" || feed.items.some((item) => item.source === "curseforge")) && <CurseforgeCredit />}</div>
    {feed.loading && <div className="discover-grid mods-grid" aria-busy="true"><ProjectSkeletons count={6} /></div>}
    {!feed.loading && feed.items.length > 0 && <WindowedGrid className="discover-grid mods-grid" items={shown} keyOf={(item) => `${item.source}:${item.id}`}
      render={(item) => <ModCard showSource={source.mixed === true || Boolean(item.game)} item={item} actionLabel={actionLabel} busy={busy} onView={setViewing} onAction={act} state={tofu ? stateOf(item) : undefined} onUpdate={tofu ? update : undefined} />} />}
    {!expanded && !feed.loading && !feed.error && (feed.items.length > shown.length || feed.hasMore) && <div className="mods-show-more"><button type="button" className="secondary-button" onClick={() => { setExpanded(true); if (feed.items.length <= shown.length) feed.loadMore(); }}>Show more {noun}</button></div>}
    {feed.error && <div className="discover-error" role="alert">
      {feed.offline ? <p><WifiOff size={14} /> You appear to be offline</p> : <p>{feed.items.length ? "Could not load more." : `Could not load ${noun} from ${source.label}.`}</p>}
      <small>{feed.error}</small><button type="button" className="secondary-button" onClick={feed.retry}><RefreshCw size={13} /> Retry</button>
    </div>}
    {!feed.loading && !feed.error && feed.items.length === 0 && <div className="discover-empty"><p>No {noun} match{filtered ? " these filters" : ""}.</p>{filtered && <button type="button" className="secondary-button" onClick={() => { setSearch(""); setDebounced(""); setCategoryId(""); }}>Clear filters</button>}</div>}
    {expanded && feed.loadingMore && <div className="discover-grid mods-grid" aria-busy="true"><ProjectSkeletons count={3} /></div>}
    <div ref={sentinel} className="discover-sentinel" aria-hidden="true" />
    {expanded && !feed.hasMore && !feed.loading && !feed.error && feed.items.length > 0 && <p className="discover-end">You have reached the end. {feed.items.length.toLocaleString()} {noun}.</p>}
    {viewing && <ModDetailsModal source={source} item={viewing} filter={filter} installLabel={tofu ? `Download to ${tofu.name}` : "Choose Tofu instance"} busy={busy} notice={install.notice} onDismissNotice={() => install.setNotice(null)} onInstall={(file) => act(viewing, file)} onClose={() => setViewing(null)} />}
    {picking && target.kind === "choose" && <TofuPicker title={picking.item.name} pikos={target.pikos} ecosystem={picking.item.ecosystem ?? target.ecosystem} gameName={picking.item.game ?? target.gameName}
      metas={picking.file ? [metaFromModFile(picking.file)] : metasOfItem(picking.item)} onClose={() => setPicking(null)}
      onInstall={(chosen, owner, force) => { const pending = picking; setPicking(null); void run(pending.item, pending.file, chosen, owner, force); }} />}
  </div>;
}
