import { useEffect, useState, type ReactNode } from "react";
import { Download, Eye, ExternalLink, PackageOpen, Plus, RefreshCw, Search, X } from "lucide-react";
import {
  getModrinthGameVersions,
  getModrinthProject,
  getModrinthVersions,
  getPopularModrinth,
  startModrinthDownload,
  type ModrinthProject,
  type ModrinthProjectDetails,
  type ModrinthProjectType,
} from "../lib/modrinth";
import type { Piko, Tofu } from "../models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNexusGames, getNexusMods, type NexusGame, type NexusMod } from "../lib/nexus";

type Props = { tofu: Tofu; pikos: Piko[] };

const sections: Array<{ type: ModrinthProjectType; title: string; description: string }> = [
  { type: "mod", title: "Most Popular Mods", description: "The most downloaded mods on Modrinth right now." },
  { type: "modpack", title: "Most Popular Modpacks", description: "Popular curated packs ready to add to a Tofu." },
  { type: "resourcepack", title: "Most Popular Resource Packs", description: "Popular resource packs, sorted by Modrinth downloads." },
  { type: "shader", title: "Most Popular Shaders", description: "Popular shaders, sorted by Modrinth downloads." },
];

type MinecraftTab = ModrinthProjectType;
type DiscoveryTab = { kind: "minecraft"; category: MinecraftTab } | { kind: "nexus"; game: NexusGame };

const minecraftTabs: Array<{ id: MinecraftTab; label: string }> = [
  { id: "mod", label: "Mods" },
  { id: "modpack", label: "Modpacks" },
  { id: "resourcepack", label: "Resource Packs" },
  { id: "shader", label: "Shaders" },
];

const defaultNexusDomains = [
  "subnautica",
  "fnafsecuritybreach",
  "subnautica2",
  "subnauticabelowzero",
  "stardewvalley",
];

type Props = {
  tofu: Tofu;
  pikos: Piko[];
  experimentalFeatures: boolean;
  nexusConfigured: boolean;
  supabase: SupabaseClient | null;
};

export function ModrinthDiscover({ tofu, pikos, experimentalFeatures, nexusConfigured, supabase }: Props) {
  const [projects, setProjects] = useState<Record<ModrinthProjectType, ModrinthProject[]>>({ mod: [], modpack: [], resourcepack: [], shader: [] });
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version);
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [loader, setLoader] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [tofuPicker, setTofuPicker] = useState<ModrinthProject | null>(null);
  const [nexusGames, setNexusGames] = useState<NexusGame[]>([]);
  const [nexusMods, setNexusMods] = useState<NexusMod[]>([]);
  const [nexusLoading, setNexusLoading] = useState(false);
  const [nexusGameSearch, setNexusGameSearch] = useState("");
  const [showNexusGamePicker, setShowNexusGamePicker] = useState(false);
  const [addedNexusDomains, setAddedNexusDomains] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("mochi:nexus-discovery-games") || "[]") as string[];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState<DiscoveryTab>({ kind: "minecraft", category: "mod" });

  const nexusVisible = experimentalFeatures && nexusConfigured && Boolean(supabase);

  const refreshMinecraft = async () => {
    setLoading(true);
    setMessage("");
    try {
      const values = await Promise.all(minecraftTabs.map(async ({ id }) => [id, await getPopularModrinth(id, gameVersion)] as const));
      setProjects(Object.fromEntries(values) as Record<ModrinthProjectType, ModrinthProject[]>);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load popular Modrinth projects.");
    } finally {
      setLoading(false);
    }
  };

  const refreshNexusGames = async () => {
    if (!nexusVisible || !supabase) return;
    setNexusLoading(true);
    try {
      const games = await getNexusGames(supabase);
      const byDomain = new Map(games.map(game => [game.domainName, game]));
      const seeded = defaultNexusDomains
        .map(domain => byDomain.get(domain))
        .filter((game): game is NexusGame => Boolean(game));
      const custom = addedNexusDomains
        .map(domain => byDomain.get(domain))
        .filter((game): game is NexusGame => Boolean(game));
      const merged = [...seeded, ...custom.filter(game => !defaultNexusDomains.includes(game.domainName))];
      setNexusGames(merged);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods games.");
      setNexusGames([]);
    } finally {
      setNexusLoading(false);
    }
  };

  const refreshNexusMods = async (game: NexusGame) => {
    if (!supabase) return;
    setNexusLoading(true);
    setMessage("");
    try {
      setNexusMods(await getNexusMods(supabase, game.domainName));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods.");
      setNexusMods([]);
    } finally {
      setNexusLoading(false);
    }
  };

  useEffect(() => {
    void getModrinthGameVersions().then(versions => {
      setGameVersions(versions);
      if (tofu.version !== "Local" && versions.includes(tofu.version)) setGameVersion(tofu.version);
    }).catch(() => setGameVersions(tofu.version === "Local" ? [] : [tofu.version]));
  }, [tofu.version]);

  useEffect(() => { void refreshMinecraft(); }, [gameVersion]);
  useEffect(() => {
    if (nexusVisible) void refreshNexusGames();
    else {
      setNexusGames([]);
      setNexusMods([]);
      if (tab.kind === "nexus") setTab({ kind: "minecraft", category: "mod" });
    }
  }, [nexusVisible, addedNexusDomains.join("|")]);

  useEffect(() => {
    if (tab.kind === "nexus" && nexusVisible) void refreshNexusMods(tab.game);
  }, [tab.kind === "nexus" ? tab.game.domainName : "", nexusVisible]);

  useEffect(() => {
    window.localStorage.setItem("mochi:nexus-discovery-games", JSON.stringify(addedNexusDomains));
  }, [addedNexusDomains]);

  const install = async (project: ModrinthProject, target: Tofu) => {
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

  const matches = (project: ModrinthProject) => {
    const value = query.trim().toLowerCase();
    return !value || project.title.toLowerCase().includes(value) || project.description.toLowerCase().includes(value);
  };
  const nexusMatches = (mod: NexusMod) => {
    const value = query.trim().toLowerCase();
    return !value || mod.name.toLowerCase().includes(value) || (mod.summary || "").toLowerCase().includes(value) || (mod.author || "").toLowerCase().includes(value);
  };

  const addNexusGame = (game: NexusGame) => {
    if (!nexusGames.some(item => item.domainName === game.domainName)) setNexusGames(current => [...current, game]);
    if (!defaultNexusDomains.includes(game.domainName)) setAddedNexusDomains(current => current.includes(game.domainName) ? current : [...current, game.domainName]);
    setShowNexusGamePicker(false);
    setNexusGameSearch("");
    setQuery("");
    setTab({ kind: "nexus", game });
  };

  const gameTabs = nexusVisible ? nexusGames : [];

  return <>
    <section className="modrinth-discover">
      <div className="discover-header">
        <div><p className="eyebrow">Discovery</p><h2>Discover</h2><p>Browse community content from the platforms and games available to your Mochi setup.</p></div>
        <button className="secondary-button" onClick={() => tab.kind === "minecraft" ? void refreshMinecraft() : void refreshNexusMods(tab.game)} disabled={loading || nexusLoading}>
          {(loading || nexusLoading) ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="discover-game-tabs" role="tablist" aria-label="Game discovery">
        <button className={tab.kind === "minecraft" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "minecraft"} onClick={() => { setQuery(""); setTab({ kind: "minecraft", category: "mod" }); }}>
          <span className="discover-game-icon minecraft-generic-icon" aria-hidden="true">M</span><span>Minecraft</span>
        </button>
        {gameTabs.map(game => <button key={game.domainName} className={tab.kind === "nexus" && tab.game.domainName === game.domainName ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "nexus" && tab.game.domainName === game.domainName} onClick={() => { setQuery(""); setTab({ kind: "nexus", game }); }}>
          {game.iconUrl ? <img className="discover-game-icon" src={game.iconUrl} alt="" /> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}
          <span>{game.name}</span>
        </button>)}
        {nexusVisible && <button className="discover-game-add" type="button" title="Add a Nexus Mods game" aria-label="Add a Nexus Mods game" onClick={() => setShowNexusGamePicker(true)}><Plus size={17} /></button>}
      </div>

      {tab.kind === "minecraft" ? <>
        <div className="discover-tabs" role="tablist" aria-label="Minecraft content categories">
          {minecraftTabs.map(item => <button key={item.id} className={tab.category === item.id ? "active" : ""} type="button" role="tab" aria-selected={tab.category === item.id} onClick={() => setTab({ kind: "minecraft", category: item.id })}>{item.label}</button>)}
        </div>
        <div className="discover-controls">
          <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + (minecraftTabs.find(item => item.id === tab.category)?.label || "content").toLowerCase() + "..."} /></label>
          <label className="discover-select-wrap"><span>Minecraft</span><select className="discover-select" value={gameVersion} onChange={event => setGameVersion(event.target.value)}><option value="">All versions</option>{gameVersions.map(version => <option key={version} value={version}>{version}</option>)}</select></label>
          {tab.category === "mod" && <label className="discover-select-wrap"><span>Loader</span><select className="discover-select" value={loader} onChange={event => setLoader(event.target.value)}><option value="">Any loader</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label>}
        </div>
        {message && <p className="metadata-note">{message}</p>}
        {loading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading popular Minecraft content from Modrinth...</span></div> : (() => {
          const section = sections.find(item => item.type === tab.category)!;
          const visible = projects[tab.category].filter(matches);
          return <div className="discover-sections"><section className="discover-section">
            <div className="discover-section-heading"><div><h3>{section.title}</h3><p>{section.description}</p></div><span>{visible.length} projects</span></div>
            <div className="discover-grid">{visible.map((project,index) => <article className="discover-card" key={project.project_id}>{project.icon_url ? <img src={project.icon_url} alt="" className="discover-card-icon" /> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}<div className="discover-card-copy"><div className="discover-card-title"><strong>{index+1}. {project.title}</strong><span>{projectTypeLabel(project.project_type)}</span></div><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p><div className="discover-card-actions"><button className="secondary-button" onClick={() => void openDetails(project)}><Eye size={13}/> View</button><button className="secondary-button" onClick={() => setTofuPicker(project)} disabled={busyId !== ""}><Download size={13}/> Choose Tofu instance</button></div></div></article>)}</div>
            {!visible.length && <div className="discover-empty">No popular {projectTypeLabel(tab.category)} projects match this filter.</div>}
          </section></div>;
        })()}
      </> : <>
        <div className="discover-controls nexus-discover-controls">
          <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + tab.game.name + " mods..."} /></label>
        </div>
        {message && <p className="metadata-note">{message}</p>}
        {nexusLoading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading trending mods from Nexus Mods...</span></div> : (() => {
          const visible = nexusMods.filter(nexusMatches);
          return <div className="discover-sections"><section className="discover-section">
            <div className="discover-section-heading"><div><h3>{tab.game.name} Mods</h3><p>Trending mods from Nexus Mods.</p></div><span>{visible.length} mods</span></div>
            <div className="discover-grid">{visible.map((mod,index) => <article className="discover-card" key={mod.id || mod.modPageUrl}>
              {mod.pictureUrl ? <img src={mod.pictureUrl} alt="" className="discover-card-icon" /> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}
              <div className="discover-card-copy"><div className="discover-card-title"><strong>{index+1}. {mod.name}</strong><span>Nexus Mods</span></div><small>{mod.author || "Nexus Mods creator"}</small><p>{mod.summary || "No summary was provided by Nexus Mods."}</p><div className="discover-card-actions"><a className="secondary-button" href={mod.modPageUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open on Nexus</a></div></div>
            </article>)}</div>
            {!visible.length && <div className="discover-empty">No trending mods match this filter.</div>}
          </section></div>;
        })()}
      </>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={gameVersion} onClose={() => setDetails(null)} />}
    {tofuPicker && <TofuPicker project={tofuPicker} pikos={pikos} onClose={() => setTofuPicker(null)} onInstall={(target) => { setTofuPicker(null); void install(tofuPicker, target); }} />}
    {showNexusGamePicker && <NexusGamePicker games={nexusGames} search={nexusGameSearch} setSearch={setNexusGameSearch} onClose={() => { setShowNexusGamePicker(false); setNexusGameSearch(""); }} onChoose={addNexusGame} loading={nexusLoading} />}
  </>;

  async function openDetails(project: ModrinthProject) {
    setMessage("");
    try {
      const detail = await getModrinthProject(project.project_id);
      setDetails({ ...project, ...detail, author: project.author || detail.author });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  }
}

function NexusGamePicker({ games, search, setSearch, onClose, onChoose, loading }: { games: NexusGame[]; search: string; setSearch: (value: string) => void; onClose: () => void; onChoose: (game: NexusGame) => void; loading: boolean }) {
  const value = search.trim().toLowerCase();
  const visible = games.filter(game => !value || game.name.toLowerCase().includes(value) || game.domainName.toLowerCase().includes(value));
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window nexus-game-picker-window" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Nexus Mods</p><h2>Add a game</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <p className="modal-description">Search the Nexus Mods game catalog and add a game as a permanent Discovery tab.</p>
    <label className="search-box nexus-game-search"><Search size={15}/><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Nexus games..." /></label>
    {loading ? <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Loading games...</span></div> : <div className="nexus-game-picker-list">{visible.slice(0, 30).map(game => <button key={game.domainName} className="nexus-game-picker-row" type="button" onClick={() => onChoose(game)}>
      {game.iconUrl ? <img src={game.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>{game.domainName}{game.modCount ? " · " + game.modCount.toLocaleString() + " mods" : ""}</small></div><Plus size={15}/>
    </button>)}{!visible.length && <div className="discover-empty">No Nexus Mods games match your search.</div>}</div>}
  </div></div>;
}

function ProjectDetails({ project, gameVersion, onClose }: { project: ModrinthProjectDetails; gameVersion: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<import("../lib/modrinth").ModrinthVersion[]>([]);
  useEffect(() => { void getModrinthVersions(project.project_id).then(setVersions).catch(() => setVersions([])); }, [project.project_id]);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window" onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{project.icon_url ? <img src={project.icon_url} alt="" /> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{projectTypeLabel(project.project_type)}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{project.author || "Unknown creator"}</strong> · {project.downloads.toLocaleString()} downloads</small></div></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <div className="project-tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="versions"?"active":""} onClick={()=>setTab("versions")}>Versions</button></div>
    {tab==="overview" ? <div className="project-overview">
      <section className="project-creator-primary">
        <div className="project-creator-primary-avatar">
          {project.members?.find(member => member.user.username === project.author)?.user.avatar_url || project.members?.[0]?.user.avatar_url
            ? <img src={project.members?.find(member => member.user.username === project.author)?.user.avatar_url || project.members?.[0]?.user.avatar_url} alt="" />
            : <div className="project-creator-primary-fallback">{(project.author || "?").slice(0, 1).toUpperCase()}</div>}
        </div>
        <div><span>Created by</span><strong>{project.author || "Unknown creator"}</strong></div>
      </section>
      <div className="project-info-grid">
        <span><strong>Downloads</strong>{project.downloads.toLocaleString()}</span>
        <span><strong>Followers</strong>{(project.followers||0).toLocaleString()}</span>
        <span><strong>Project type</strong>{projectTypeLabel(project.project_type)}</span>
        <span><strong>Categories</strong>{project.categories?.join(", ")||"Not provided"}</span>
        <span><strong>License</strong>{project.license?.name||"Not provided"}</span>
        <span><strong>Members</strong>{project.members?.length ?? 0}</span>
      </div>
      <h3 className="project-overview-heading">Overview</h3>
      <Markdown source={project.body || project.description} />
      {project.members?.length ? <section className="project-creators">
        <div className="project-creators-heading"><div><h3>Creators & contributors</h3><p>{project.members.length} team member{project.members.length === 1 ? "" : "s"} credited on Modrinth.</p></div></div>
        <div className="project-creator-grid">{project.members.map(member => <div className="project-creator" key={member.user.id}>
          <img src={member.user.avatar_url} alt="" />
          <div><strong>{member.user.name || member.user.username}</strong><small>@{member.user.username} · {member.role}</small></div>
        </div>)}</div>
      </section> : null}
    </div> : <div className="project-version-list">{versions.length ? versions.map(version=><div className="project-version" key={version.id}><div><strong>{version.name || version.version_number}</strong><small><strong>{version.version_number}</strong> · {version.version_type || "release"} · Published {formatDate(version.date_published)}</small><small>Minecraft: {version.game_versions.join(", ") || "Unknown"} · Loaders: {version.loaders.join(", ") || "Unknown"} · {version.files.length} file{version.files.length === 1 ? "" : "s"} · {version.dependencies.length} dependenc{version.dependencies.length === 1 ? "y" : "ies"}</small>{version.changelog ? <details><summary>Changelog</summary><Markdown source={version.changelog} /></details> : null}<details><summary>Files</summary><div className="project-file-list">{version.files.map(file => <div key={file.filename}><span>{file.filename}</span><small>{formatBytes(file.size)}{file.primary ? " · Primary" : ""}</small></div>)}</div></details></div><span>{version.files.length} file{version.files.length===1?"":"s"}</span></div>) : <div className="discover-empty">No versions found for this Minecraft version.</div>}</div>}
  </div></div>;
}

function TofuPicker({ project, pikos, onClose, onInstall }: { project: ModrinthProject; pikos: Piko[]; onClose: () => void; onInstall: (tofu: Tofu) => void }) {
  const tofus = pikos.flatMap(piko => piko.tofus || []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Install {project.title}</p><h2>Choose Tofu instance</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p className="modal-description">Choose the Minecraft instance that should receive this download.</p>{tofus.length ? <div className="tofu-picker-list">{tofus.map(tofu=><div className="tofu-picker-row" key={tofu.id}><div><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No install location"}</small></div><button className="secondary-button" title={"Download to " + tofu.name} disabled={!tofu.path} onClick={()=>onInstall(tofu)}><Plus size={15}/></button></div>)}</div> : <div className="discover-empty">No Minecraft instances were found.</div>}</div></div>;
}
