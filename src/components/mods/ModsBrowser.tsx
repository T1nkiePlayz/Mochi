import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Search, WifiOff } from "lucide-react";
import { getDownloads } from "../../lib/modrinth";
import type { ModCategory, ModFile, ModItem, ModSource } from "../../lib/mods/types";
import type { Tofu } from "../../models";
import { ProjectSkeletons } from "../discover/ProjectCard";
import { useSentinel } from "../discover/useSentinel";
import { Select } from "../ui/Select";
import { CurseforgeCredit } from "./CurseforgeCredit";
import { InstallNoticeBar } from "./InstallNoticeBar";
import { ModCard } from "./ModCard";
import { ModDetailsModal } from "./ModDetailsModal";
import { useModFeed } from "./useModFeed";
import { useModInstall } from "./useModInstall";

type Props = {
  source: ModSource;
  tofu: Tofu;
  onUpdateTofu: (patch: Partial<Tofu>) => void;
  /** Minecraft version / loader narrowing (Minecraft only). */
  filter?: { gameVersion?: string; loader?: string };
  /** Shown in empty and error text, e.g. "Stardew Valley mods". */
  noun: string;
};

/** Search, filter and download mods from one source straight into the selected Tofu. */
export function ModsBrowser({ source, tofu, onUpdateTofu, filter, noun }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState(source.defaultSort);
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<ModCategory[]>([]);
  const [viewing, setViewing] = useState<ModItem | null>(null);
  const [active, setActive] = useState(0);
  const install = useModInstall();

  useEffect(() => { const timer = window.setTimeout(() => setDebounced(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { setSort(source.defaultSort); setCategoryId(""); setCategories([]); void source.categories().then(setCategories).catch(() => setCategories([])); }, [source]);

  // A text query on a source without ranking by relevance falls back to its first sort; nothing else to adjust.
  const query = useMemo(() => ({ query: debounced, sort, categoryId: categoryId || undefined, gameVersion: filter?.gameVersion || undefined, loader: filter?.loader || undefined }), [debounced, sort, categoryId, filter?.gameVersion, filter?.loader]);
  const feed = useModFeed(source, query);
  const sentinel = useSentinel(feed.loadMore, feed.hasMore && !feed.loading && !feed.loadingMore && !feed.error, feed.items.length);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => { try { const mine = (await getDownloads()).filter((entry) => entry.tofuId === tofu.id && entry.status === "downloading").length; if (!cancelled) setActive(mine); } catch { /* browser/development mode */ } };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tofu.id]);

  /** The Tofu with a folder, asking for one when it has none yet. */
  const withFolder = useCallback(async (): Promise<Tofu | null> => {
    if (tofu.path) return tofu;
    const chosen = await open({ directory: true, multiple: false, title: `Choose a folder for ${tofu.name}` });
    if (typeof chosen !== "string") return null;
    onUpdateTofu({ path: chosen });
    return { ...tofu, path: chosen };
  }, [tofu, onUpdateTofu]);

  const download = useCallback(async (item: ModItem) => {
    const target = await withFolder();
    if (target) await install.installBest(source, item, target, filter);
  }, [withFolder, install, source, filter]);
  const downloadFile = useCallback(async (item: ModItem, file: ModFile) => {
    const target = await withFolder();
    if (target) await install.installFile(source, item, file, target);
  }, [withFolder, install, source]);

  const categoryOptions = [{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))];
  const filtered = Boolean(debounced || categoryId);
  const busy = install.busyId !== "";

  return <div className="mods-browser">
    <div className="mods-controls">
      <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${noun}...`} aria-label={`Search ${noun}`} /></label>
      {categories.length > 0 && <div className="discover-select-wrap"><span>Category</span><Select value={categoryId} onChange={setCategoryId} options={categoryOptions} label="Category" searchable={categories.length > 8} /></div>}
      <div className="discover-select-wrap"><span>Sort</span><Select value={sort} onChange={setSort} options={source.sorts} label="Sort" searchable={false} align="end" /></div>
    </div>
    <InstallNoticeBar notice={install.notice} onDismiss={() => install.setNotice(null)} />
    {active > 0 && <p className="metadata-note" role="status">{active} download{active === 1 ? "" : "s"} in progress. See Downloads.</p>}
    {!source.searchesServerSide && debounced && <p className="metadata-note">Nexus Mods cannot search by text, so this filters the mods Mochi has loaded so far. Scroll to load more.</p>}
    <div className="mods-heading"><span aria-live="polite">{feed.loading ? "Loading..." : `${feed.items.length.toLocaleString()} of ${feed.total.toLocaleString()} ${noun}`}</span>{source.id === "curseforge" && <CurseforgeCredit />}</div>
    {feed.loading && <div className="discover-grid mods-grid" aria-busy="true"><ProjectSkeletons count={6} /></div>}
    {!feed.loading && feed.items.length > 0 && <div className="discover-grid mods-grid">{feed.items.map((item) => <ModCard key={item.id} item={item} actionLabel="Download" busy={busy} onView={setViewing} onAction={(value) => void download(value)} />)}</div>}
    {feed.error && <div className="discover-error" role="alert">
      {feed.offline ? <p><WifiOff size={14} /> You appear to be offline</p> : <p>{feed.items.length ? "Could not load more." : `Could not load ${noun} from ${source.label}.`}</p>}
      <small>{feed.error}</small><button type="button" className="secondary-button" onClick={feed.retry}><RefreshCw size={13} /> Retry</button>
    </div>}
    {!feed.loading && !feed.error && feed.items.length === 0 && <div className="discover-empty"><p>No {noun} match{filtered ? " these filters" : ""}.</p>{filtered && <button type="button" className="secondary-button" onClick={() => { setSearch(""); setDebounced(""); setCategoryId(""); }}>Clear filters</button>}</div>}
    {feed.loadingMore && <div className="discover-grid mods-grid" aria-busy="true"><ProjectSkeletons count={3} /></div>}
    <div ref={sentinel} className="discover-sentinel" aria-hidden="true" />
    {!feed.hasMore && !feed.loading && !feed.error && feed.items.length > 0 && <p className="discover-end">You have reached the end. {feed.items.length.toLocaleString()} {noun}.</p>}
    {viewing && <ModDetailsModal source={source} item={viewing} filter={filter} installLabel={`Download to ${tofu.name}`} busy={busy} notice={install.notice} onDismissNotice={() => install.setNotice(null)} onInstall={(file) => void downloadFile(viewing, file)} onClose={() => setViewing(null)} />}
  </div>;
}
