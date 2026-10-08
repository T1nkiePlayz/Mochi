import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Gem, Hammer, Layers, RefreshCw, Search, Shirt, WifiOff } from "lucide-react";
import type { DiscoverSort, ModrinthProject, ModrinthProjectType } from "../../lib/modrinth";
import { isKnownVersion, recordRecentVersion } from "../../lib/gameVersions";
import { Select, type SelectOption } from "../ui/Select";
import { ProjectCard, ProjectSkeletons } from "./ProjectCard";
import { VersionPicker } from "./VersionPicker";
import { useGameVersions } from "./useGameVersions";
import { useModrinthFeed } from "./useModrinthFeed";
import { useSentinel } from "./useSentinel";
import { projectTypeLabel } from "./utils";

export const minecraftTabs: Array<{ id: ModrinthProjectType; label: string; title: string; description: string }> = [
  { id: "mod", label: "Mods", title: "Mods", description: "Browse Minecraft mods from Modrinth." },
  { id: "modpack", label: "Modpacks", title: "Modpacks", description: "Curated packs ready to add to a Tofu." },
  { id: "resourcepack", label: "Resource Packs", title: "Resource Packs", description: "Texture and sound packs for Minecraft." },
  { id: "shader", label: "Shaders", title: "Shaders", description: "Shader packs for lighting and atmosphere." },
];

const loaderOptions: SelectOption[] = [
  { value: "", label: "Any loader", icon: <Layers size={14} /> },
  { value: "fabric", label: "Fabric", icon: <Shirt size={14} /> },
  { value: "forge", label: "Forge", icon: <Hammer size={14} /> },
  { value: "neoforge", label: "NeoForge", icon: <Flame size={14} /> },
  { value: "quilt", label: "Quilt", icon: <Gem size={14} /> },
];

const sortOptions: SelectOption<DiscoverSort>[] = [
  { value: "downloads", label: "Most downloaded" },
  { value: "follows", label: "Most followed" },
  { value: "relevance", label: "Best match", description: "Ranks by your search text" },
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
];

type Props = {
  category: ModrinthProjectType;
  onCategory: (category: ModrinthProjectType) => void;
  tofuVersion: string;
  busy: boolean;
  onView: (project: ModrinthProject, gameVersion: string) => void;
  onChoose: (project: ModrinthProject, loader: string) => void;
};

/** A real Minecraft release id, as opposed to "Local" or free text a Tofu may carry. */
const looksLikeRelease = (version: string) => /^\d+\.\d+(\.\d+)?$/.test(version);

export function MinecraftBrowser({ category, onCategory, tofuVersion, busy, onView, onChoose }: Props) {
  const { versions, loading: versionsLoading } = useGameVersions();
  const [gameVersion, setGameVersion] = useState(looksLikeRelease(tofuVersion) ? tofuVersion : "");
  const [loader, setLoader] = useState("");
  const [sort, setSort] = useState<DiscoverSort>("downloads");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  // A Tofu version Modrinth does not know would silently filter everything out.
  useEffect(() => {
    if (versions.length && gameVersion && !isKnownVersion(versions, gameVersion)) setGameVersion("");
  }, [versions, gameVersion]);

  const effectiveSort: DiscoverSort = debounced && sort === "downloads" ? "relevance" : sort;
  const query = useMemo(() => ({ projectType: category, gameVersion, loader: category === "mod" ? loader : "", query: debounced, sort: effectiveSort }), [category, gameVersion, loader, debounced, effectiveSort]);
  const feed = useModrinthFeed(query);
  const sentinel = useSentinel(feed.loadMore, feed.hasMore && !feed.loading && !feed.loadingMore && !feed.error, feed.items.length);
  const filtered = Boolean(gameVersion || loader || debounced);
  const tab = minecraftTabs.find((item) => item.id === category)!;

  const view = useCallback((project: ModrinthProject) => onView(project, gameVersion), [onView, gameVersion]);
  const choose = useCallback((project: ModrinthProject) => onChoose(project, loader), [onChoose, loader]);
  const pickVersion = (version: string) => { setGameVersion(version); recordRecentVersion(version); };

  return <>
    <div className="discover-tabs" role="tablist" aria-label="Minecraft content categories">
      {minecraftTabs.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} type="button" role="tab" aria-selected={category === item.id} onClick={() => onCategory(item.id)}>{item.label}</button>)}
    </div>
    <div className={`discover-controls minecraft-controls${category === "mod" ? "" : " no-loader"}`}>
      <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${tab.label.toLowerCase()}...`} aria-label={`Search ${tab.label}`} /></label>
      <div className="discover-select-wrap"><span>Minecraft</span><VersionPicker value={gameVersion} onChange={pickVersion} versions={versions} loading={versionsLoading} /></div>
      {category === "mod" && <div className="discover-select-wrap"><span>Loader</span><Select value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} /></div>}
      <div className="discover-select-wrap"><span>Sort</span><Select value={effectiveSort} onChange={setSort} options={sortOptions} label="Sort" searchable={false} align="end" /></div>
    </div>
    {feed.offline && <p className="metadata-note discover-offline" role="status"><WifiOff size={13} /> Showing cached results (offline). They will refresh when Modrinth is reachable.</p>}
    <div className="discover-sections"><section className="discover-section">
      <div className="discover-section-heading"><div><h3>{tab.title}</h3><p>{tab.description}</p></div><span aria-live="polite">{feed.loading ? "Loading..." : `${feed.items.length.toLocaleString()} of ${feed.total.toLocaleString()} projects`}</span></div>
      {feed.loading && <div className="discover-grid" aria-busy="true"><ProjectSkeletons count={9} /></div>}
      {!feed.loading && feed.items.length > 0 && <div className="discover-grid">{feed.items.map((project) => <ProjectCard key={project.project_id} project={project} badge={projectTypeLabel(project.project_type)} chooseLabel="Choose Tofu instance" busy={busy} onView={view} onChoose={choose} />)}</div>}
      {feed.error && <div className="discover-error" role="alert"><p>{feed.items.length ? "Could not load more projects." : "Could not load projects from Modrinth."}</p><small>{feed.error}</small><button type="button" className="secondary-button" onClick={feed.retry}><RefreshCw size={13} /> Retry</button></div>}
      {!feed.loading && !feed.error && feed.items.length === 0 && <div className="discover-empty">
        <p>No {projectTypeLabel(category).toLowerCase()} projects match{filtered ? " these filters" : ""}.</p>
        {filtered && <button type="button" className="secondary-button" onClick={() => { setSearch(""); setDebounced(""); setGameVersion(""); setLoader(""); }}>Clear filters</button>}
      </div>}
      {feed.loadingMore && !feed.loading && <div className="discover-grid" aria-busy="true"><ProjectSkeletons count={3} /></div>}
      <div ref={sentinel} className="discover-sentinel" aria-hidden="true" />
      {!feed.hasMore && !feed.loading && feed.items.length > 0 && <p className="discover-end">You have reached the end. {feed.items.length.toLocaleString()} projects.</p>}
    </section></div>
  </>;
}
