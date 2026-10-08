import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Eye, ExternalLink, PackageOpen, Plus, RefreshCw, Search, WifiOff } from "lucide-react";
import {
  getModrinthProject,
  getModrinthVersions,
  startModrinthDownload,
  type ModrinthProject,
  type ModrinthProjectDetails,
  type ModrinthProjectType,
} from "../../lib/modrinth";
import type { Piko, Tofu } from "../../models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNexusGames, getNexusMods, type NexusGame, type NexusMod, type NexusModSort } from "../../lib/nexus";
import { Select } from "../ui/Select";
import { DiscoveryImage, MinecraftIcon } from "./DiscoveryImage";
import { MinecraftBrowser } from "./MinecraftBrowser";
import { NexusGamePicker, NexusModDetails } from "./NexusParts";
import { ProjectCard, ProjectSkeletons } from "./ProjectCard";
import { ProjectDetails } from "./ProjectDetails";
import { TofuPicker } from "./TofuPicker";
import { useModrinthFeed } from "./useModrinthFeed";

type DiscoveryTab = { kind: "all" } | { kind: "minecraft"; category: ModrinthProjectType } | { kind: "nexus"; game: NexusGame };

const defaultNexusGames: Array<{ domainName: string; search: string }> = [
  { domainName: "satisfactory", search: "Satisfactory" },
  { domainName: "fnafsecuritybreach", search: "Five Nights at Freddy's Security Breach" },
  { domainName: "subnautica", search: "Subnautica" },
  { domainName: "subnautica2", search: "Subnautica 2" },
  { domainName: "subnauticabelowzero", search: "Subnautica: Below Zero" },
  { domainName: "stardewvalley", search: "Stardew Valley" },
];

const defaultNexusGame = ({ domainName, search }: typeof defaultNexusGames[number]): NexusGame => ({
  id: "",
  domainName,
  name: search,
});

type Props = {
  tofu: Tofu;
  pikos: Piko[];
  playtime?: Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>;
  nexusConfigured: boolean;
  supabase: SupabaseClient | null;
};

export function ModrinthDiscover({ tofu, pikos, playtime = [], nexusConfigured, supabase }: Props) {
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [nexusDetails, setNexusDetails] = useState<{ game: NexusGame; mod: NexusMod } | null>(null);
  const [tofuPicker, setTofuPicker] = useState<{ project: ModrinthProject; loader: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailsVersion, setDetailsVersion] = useState("");
  const [moreLoading, setMoreLoading] = useState(false);
  const [nexusGames, setNexusGames] = useState<NexusGame[]>([]);
  const [nexusModsByGame, setNexusModsByGame] = useState<Record<string, NexusMod[]>>({});
  const [nexusTotalByGame, setNexusTotalByGame] = useState<Record<string, number>>({});
  const [nexusSort, setNexusSort] = useState<NexusModSort>("catalog");
  const [nexusPageSize, setNexusPageSize] = useState(25);
  const [nexusLoading, setNexusLoading] = useState(false);
  const [nexusGameSearch, setNexusGameSearch] = useState("");
  const [nexusGameResults, setNexusGameResults] = useState<NexusGame[]>([]);
  const nexusSearchRequest = useRef(0);
  const nexusRequests = useRef(new Map<string, Promise<NexusMod[]>>());
  const [showNexusGamePicker, setShowNexusGamePicker] = useState(false);
  const [addedNexusDomains, setAddedNexusDomains] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("mochi:nexus-discovery-games") || "[]") as string[];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState<DiscoveryTab>({ kind: "all" });

  const nexusVisible = nexusConfigured && Boolean(supabase);
  const preview = useModrinthFeed({ projectType: "mod", sort: "downloads" }, tab.kind === "all", 8);
  const loading = preview.loading;

  const refreshNexusGames = async () => {
    if (!nexusVisible || !supabase) return;
    setNexusLoading(true);
    setMessage("");
    try {
      const catalog = await getNexusGames(supabase);
      const byDomain = new Map(catalog.map((game) => [game.domainName, game]));
      const seeded = defaultNexusGames.map((item) => byDomain.get(item.domainName) ?? defaultNexusGame(item));
      const custom = addedNexusDomains
        .map((domain) => byDomain.get(domain) ?? { id: "", name: domain, domainName: domain });
      setNexusGames([...seeded, ...custom.filter(game => !defaultNexusGames.some(item => item.domainName === game.domainName))]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods games.");
      setNexusGames([
        ...defaultNexusGames.map(defaultNexusGame),
        ...addedNexusDomains.map((domainName) => ({ id: "", name: domainName, domainName })),
      ]);
    } finally {
      setNexusLoading(false);
    }
  };

  const searchNexusGames = async (query = nexusGameSearch) => {
    if (!nexusVisible || !supabase) return;
    const requestId = ++nexusSearchRequest.current;
    setNexusLoading(true);
    setMessage("");
    try {
      const games = await getNexusGames(supabase, query);
      if (requestId === nexusSearchRequest.current) setNexusGameResults(games);
    } catch (error) {
      if (requestId === nexusSearchRequest.current) {
        setMessage(error instanceof Error ? error.message : "Unable to search Nexus Mods games.");
        setNexusGameResults([]);
      }
    } finally {
      if (requestId === nexusSearchRequest.current) setNexusLoading(false);
    }
  };

  const refreshNexusMods = async (game: NexusGame, sort = nexusSort, limit = nexusPageSize) => {
    if (!supabase) return;
    const domain = game.domainName;
    setNexusLoading(true);
    setMessage("");
    try {
      const page = await getNexusMods(supabase, domain, { sort, limit });
      setNexusModsByGame(current => ({ ...current, [domain]: page.mods }));
      setNexusTotalByGame(current => ({ ...current, [domain]: page.total }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods.");
      setNexusModsByGame(current => ({ ...current, [domain]: [] }));
    } finally {
      setNexusLoading(false);
    }
  };

  const loadNexusMods = async (game: NexusGame, limit = nexusPageSize) => {
    const cached = nexusModsByGame[game.domainName];
    if (cached && (cached.length >= limit || cached.length >= (nexusTotalByGame[game.domainName] ?? Infinity))) return cached;
    const pending = nexusRequests.current.get(game.domainName);
    if (pending) return pending;
    if (!supabase) return [];
    const offset = cached?.length ?? 0;
    const request = getNexusMods(supabase, game.domainName, { sort: nexusSort, offset, limit: Math.max(8, limit - offset) }).then(page => {
      setNexusTotalByGame(current => ({ ...current, [game.domainName]: page.total }));
      setNexusModsByGame(current => ({ ...current, [game.domainName]: [...(current[game.domainName] || []), ...page.mods] }));
      return page.mods;
    });
    nexusRequests.current.set(game.domainName, request);
    try {
      const mods = await request;
      return [...(cached || []), ...mods];
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods.");
      setNexusModsByGame(current => ({ ...current, [game.domainName]: [] }));
      return [];
    } finally {
      nexusRequests.current.delete(game.domainName);
    }
  };

  useEffect(() => {
    if (nexusVisible) void refreshNexusGames();
    else {
      setNexusGames([]);
      setNexusGameResults([]);
      setNexusModsByGame({});
      if (tab.kind === "nexus") setTab({ kind: "all" });
    }
  }, [nexusVisible, addedNexusDomains.join("|")]);

  useEffect(() => {
    if (!showNexusGamePicker || !nexusVisible) return;
    const timer = window.setTimeout(() => void searchNexusGames(nexusGameSearch), nexusGameSearch.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [showNexusGamePicker, nexusVisible, nexusGameSearch]);

  useEffect(() => {
    if (!nexusVisible || tab.kind !== "nexus") return;
    setNexusModsByGame(current => {
      const next = { ...current };
      delete next[tab.game.domainName];
      return next;
    });
    void refreshNexusMods(tab.game, nexusSort, nexusPageSize);
  }, [nexusVisible, tab.kind === "nexus" ? tab.game.domainName : "", nexusSort, nexusPageSize]);

  useEffect(() => {
    if (nexusVisible && tab.kind === "all") {
      for (const game of nexusGames) void loadNexusMods(game, 8);
    }
  }, [nexusVisible, nexusGames.map(game => game.domainName).join("|"), tab.kind]);

  const loadMoreNexusMods = async (game: NexusGame) => {
    const current = nexusModsByGame[game.domainName] || [];
    if (!supabase || nexusSort === "trending" || current.length >= 200 || current.length >= (nexusTotalByGame[game.domainName] ?? Infinity) || moreLoading) return;
    setMoreLoading(true);
    setMessage("");
    try {
      const page = await getNexusMods(supabase, game.domainName, { sort: "catalog", offset: current.length, limit: Math.min(nexusPageSize, 200 - current.length) });
      setNexusModsByGame(previous => ({ ...previous, [game.domainName]: [...(previous[game.domainName] || []), ...page.mods] }));
      setNexusTotalByGame(previous => ({ ...previous, [game.domainName]: page.total }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load more Nexus Mods.");
    } finally {
      setMoreLoading(false);
    }
  };

  useEffect(() => {
    window.localStorage.setItem("mochi:nexus-discovery-games", JSON.stringify(addedNexusDomains));
  }, [addedNexusDomains]);

  const install = async (project: ModrinthProject, target: Tofu, loader: string) => {
    if (!target.path) { setMessage("This Tofu does not have an install location yet."); return; }
    setBusyId(project.project_id);
    setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, target.version === "Local" ? undefined : target.version, project.project_type === "mod" ? loader || undefined : undefined);
      const version = versions.find(item => item.files.length > 0);
      const file = version?.files.find(item => item.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, target.path, target.id, target.name, project.title, file.filename);
      setMessage("Queued " + project.title + " for " + target.name + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue this download.");
    } finally { setBusyId(""); }
  };

  const nexusMatches = (mod: NexusMod) => {
    const value = query.trim().toLowerCase();
    return !value || mod.name.toLowerCase().includes(value) || (mod.summary || "").toLowerCase().includes(value) || (mod.author || "").toLowerCase().includes(value);
  };

  const addNexusGame = (game: NexusGame) => {
    setNexusGames(current => current.some(item => item.domainName === game.domainName) ? current : [...current, game]);
    if (!defaultNexusGames.some(item => item.domainName === game.domainName)) {
      setAddedNexusDomains(current => current.includes(game.domainName) ? current : [...current, game.domainName]);
    }
    setShowNexusGamePicker(false);
    setNexusGameSearch("");
    setNexusGameResults([]);
    setQuery("");
    setTab({ kind: "nexus", game });
  };

  const gameTabs = nexusVisible ? nexusGames : [];
  const recentPlay = [...playtime].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 3);
  const playedPikos = recentPlay.map(entry => pikos.find(piko => piko.id === entry.gameId)).filter((piko): piko is Piko => Boolean(piko));
  const playedCategories = [...new Set(playedPikos.flatMap(piko => piko.categories || []))].map(value => value.toLowerCase());
  const suggestedGames = [...gameTabs]
    .map(game => ({ game, score: playedCategories.filter(category => game.genre?.toLowerCase().includes(category)).length * 1000 + (game.modCount || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => item.game);
  const renderNexusMod = (game: NexusGame, mod: NexusMod, index: number) => <article className="discover-card" key={mod.id || mod.modPageUrl}>
    {mod.pictureUrl ? <DiscoveryImage src={mod.pictureUrl} alt="" className="discover-card-icon" label={mod.name}/> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}
    <div className="discover-card-copy"><div className="discover-card-title"><strong>{index + 1}. {mod.name}</strong><span>Nexus Mods</span></div><small>{game.name} · {mod.author || "Nexus Mods creator"}</small><p>{mod.summary || "No summary was provided by Nexus Mods."}</p><div className="discover-card-actions"><button type="button" className="secondary-button" onClick={() => setNexusDetails({ game, mod })}><Eye size={13}/> View</button><button type="button" className="secondary-button" onClick={() => void invoke("open_external_url", { url: mod.modPageUrl })}><ExternalLink size={13}/> Open on Nexus</button></div></div>
  </article>;

  return <>
    <section className="modrinth-discover">
      <div className="discover-header">
        <div><p className="eyebrow">Discovery</p><h2>Discover</h2><p>Browse community content from the platforms and games available to your Mochi setup.</p></div>
        <button className="secondary-button" onClick={() => tab.kind === "nexus" ? void refreshNexusMods(tab.game) : tab.kind === "minecraft" ? setRefreshKey(value => value + 1) : preview.retry()} disabled={loading || nexusLoading}>
          {(loading || nexusLoading) ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="discover-game-tabs" role="tablist" aria-label="Game discovery">
        <button className={tab.kind === "all" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "all"} onClick={() => { setQuery(""); setTab({ kind: "all" }); }}>All</button>
        <button className={tab.kind === "minecraft" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-label="Minecraft" title="Minecraft" aria-selected={tab.kind === "minecraft"} onClick={() => { setQuery(""); setTab({ kind: "minecraft", category: "mod" }); }}>
          <MinecraftIcon /><span className="discover-game-name">Minecraft</span>
        </button>
        {gameTabs.map(game => <button key={game.domainName} className={tab.kind === "nexus" && tab.game.domainName === game.domainName ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "nexus" && tab.game.domainName === game.domainName} onClick={() => { setQuery(""); setTab({ kind: "nexus", game }); }}>
          {game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name} /> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}
          <span className="discover-game-name">{game.name}</span>
        </button>)}
        {nexusVisible && <button className="discover-game-add" type="button" title="Search and add a Nexus Mods game" aria-label="Search and add a Nexus Mods game" onClick={() => { setNexusGameSearch(""); setNexusGameResults([]); setMessage(""); setShowNexusGamePicker(true); }}><Plus size={17} /></button>}
      </div>

      {tab.kind === "all" ? <>
        {message && <p className="metadata-note" role="alert">{message}</p>}
        <section className="discover-section"><div className="discover-section-heading"><div><h3>Popular Minecraft mods</h3><p>The most downloaded Minecraft mods from Modrinth.</p></div><button className="text-button" type="button" onClick={() => setTab({ kind: "minecraft", category: "mod" })}>Browse Minecraft</button></div>
          {preview.offline && <p className="metadata-note discover-offline" role="status"><WifiOff size={13} /> Showing cached results (offline).</p>}
          {loading ? <div className="discover-grid" aria-busy="true"><ProjectSkeletons count={8} /></div> : preview.error ? <div className="discover-error" role="alert"><p>Could not load projects from Modrinth.</p><small>{preview.error}</small><button type="button" className="secondary-button" onClick={preview.retry}><RefreshCw size={13} /> Retry</button></div> : <div className="discover-grid">{preview.items.slice(0, 8).map((project, index) => <ProjectCard key={project.project_id} project={project} index={index} badge="Modrinth" onView={project => void openDetails(project, "")} onChoose={project => setTofuPicker({ project, loader: "" })} />)}</div>}
        </section>
        {nexusVisible && gameTabs.map(game => {
          const mods = nexusModsByGame[game.domainName] || [];
          return <section className="discover-section all-game-section" key={game.domainName}><div className="discover-section-heading"><div><h3>{game.name}</h3><p>Game catalog · showing {Math.min(mods.length, 8)} of {(nexusTotalByGame[game.domainName] || mods.length).toLocaleString()} mods{game.genre ? ` · ${game.genre}` : ""}</p></div><button className="text-button" type="button" onClick={() => setTab({ kind: "nexus", game })}>Browse</button></div>
            {!Object.prototype.hasOwnProperty.call(nexusModsByGame, game.domainName) ? <div className="discover-loading"><RefreshCw size={16} className="spin"/><span>Loading {game.name}...</span></div> : mods.length ? <div className="discover-grid">{mods.slice(0, 8).map((mod, index) => renderNexusMod(game, mod, index))}</div> : <div className="discover-empty">Nexus Mods did not return mods for {game.name}.</div>}
          </section>;
        })}
        {nexusVisible && <section className="discover-section suggested-games"><div className="discover-section-heading"><div><h3>Suggested games</h3><p>{playedPikos.length ? `Based on ${playedPikos[0].name} and your ${playedCategories[0] || "recent play"} interests.` : "Popular games to explore on Nexus Mods."}</p></div></div><div className="suggested-game-list">{suggestedGames.map(game => <button type="button" className="suggested-game-card" key={game.domainName} onClick={() => { setQuery(""); setTab({ kind: "nexus", game }); }}>{game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name}/> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}<span><strong>{game.name}</strong><small>{game.genre || `${(game.modCount || 0).toLocaleString()} mods on Nexus`}</small></span><span className="text-button">Browse</span></button>)}</div></section>}
      </> : tab.kind === "minecraft" ? <>
        <MinecraftBrowser key={refreshKey} category={tab.category} onCategory={category => setTab({ kind: "minecraft", category })} tofuVersion={tofu.version} busy={busyId !== ""} onView={(project, version) => void openDetails(project, version)} onChoose={(project, loader) => setTofuPicker({ project, loader })} />
      </> : <>
        <div className="discover-controls nexus-discover-controls">
          <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + tab.game.name + " mods..."} /></label>
          <div className="discover-select-wrap"><span>Sort</span><Select<NexusModSort> value={nexusSort} label="Sort" searchable={false} options={[{ value: "catalog", label: "All mods" }, { value: "trending", label: "Trending popularity" }]} onChange={value => { setNexusModsByGame({}); setNexusTotalByGame({}); setNexusSort(value); }} /></div>
          {nexusSort === "catalog" && <div className="discover-select-wrap"><span>Show</span><Select value={String(nexusPageSize)} label="Page size" searchable={false} align="end" options={[8, 25, 50, 100].map(size => ({ value: String(size), label: `${size} per page` }))} onChange={value => { setNexusModsByGame({}); setNexusTotalByGame({}); setNexusPageSize(Number(value)); }} /></div>}
        </div>
        {message && <p className="metadata-note">{message}</p>}
        {nexusLoading || !Object.prototype.hasOwnProperty.call(nexusModsByGame, tab.game.domainName) ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>{nexusSort === "trending" ? "Loading trending mods from Nexus Mods..." : "Loading the Nexus Mods game catalog..."}</span></div> : (() => {
          const visible = (nexusModsByGame[tab.game.domainName] || []).filter(nexusMatches);
          const total = nexusTotalByGame[tab.game.domainName] ?? visible.length;
          return <div className="discover-sections"><section className="discover-section">
            <div className="discover-section-heading"><div><h3>{tab.game.name} Mods</h3><p>{nexusSort === "trending" ? "Nexus trending feed, ranked by endorsements (top 5)." : `Game catalog · showing up to 200 of ${total.toLocaleString()} mods.`}</p></div><span>{visible.length} shown</span></div>
            <div className="discover-grid">{visible.map((mod,index) => renderNexusMod(tab.game, mod, index))}</div>
            {nexusSort === "catalog" && (nexusModsByGame[tab.game.domainName]?.length || 0) < Math.min(200, total) && <div className="discover-load-more"><button className="secondary-button" type="button" onClick={() => void loadMoreNexusMods(tab.game)} disabled={moreLoading}>{moreLoading ? <RefreshCw size={14} className="spin"/> : <Plus size={14}/>} {moreLoading ? "Loading more..." : `Load ${Math.min(nexusPageSize, 200 - (nexusModsByGame[tab.game.domainName]?.length || 0))} more`}</button></div>}
            {!visible.length && <div className="discover-empty">No mods match this filter.</div>}
          </section></div>;
        })()}
      </>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={detailsVersion} onClose={() => setDetails(null)} />}
    {nexusDetails && <NexusModDetails game={nexusDetails.game} mod={nexusDetails.mod} onClose={() => setNexusDetails(null)} />}
    {tofuPicker && <TofuPicker project={tofuPicker.project} pikos={pikos} onClose={() => setTofuPicker(null)} onInstall={(target) => { const { project, loader } = tofuPicker; setTofuPicker(null); void install(project, target, loader); }} />}
    {showNexusGamePicker && <NexusGamePicker games={nexusGameResults} search={nexusGameSearch} setSearch={setNexusGameSearch} onClose={() => { setShowNexusGamePicker(false); setNexusGameSearch(""); }} onChoose={addNexusGame} loading={nexusLoading} error={message} />}
  </>;

  async function openDetails(project: ModrinthProject, version: string) {
    setMessage("");
    try {
      setDetailsVersion(version);
      const detail = await getModrinthProject(project.project_id);
      setDetails({ ...project, ...detail, author: project.author || detail.author });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  }
}
