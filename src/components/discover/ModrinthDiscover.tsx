import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, WifiOff } from "lucide-react";
import {
  getModrinthProject, getModrinthVersions, startModrinthDownload,
  type ModrinthProject, type ModrinthProjectDetails, type ModrinthProjectType,
} from "../../lib/modrinth";
import { CF_MINECRAFT_ID } from "../../lib/curseforge";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { createNexusSource } from "../../lib/mods/nexusSource";
import { isLinkedTo } from "../../lib/mods/gameSupport";
import { MINECRAFT_CLASS, minecraftSourceFor, resolveSources } from "../../lib/mods/resolveSources";
import type { Piko, Tofu } from "../../models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useApp } from "../../state/AppContext";
import { CurseforgeCredit } from "../mods/CurseforgeCredit";
import { ModsBrowser } from "../mods/ModsBrowser";
import { Select } from "../ui/Select";
import { AddGamePicker } from "./AddGamePicker";
import { DiscoveryImage, MinecraftIcon } from "./DiscoveryImage";
import { MinecraftBrowser, minecraftTabs } from "./MinecraftBrowser";
import { ProjectCard, ProjectSkeletons } from "./ProjectCard";
import { ProjectDetails } from "./ProjectDetails";
import { TofuPicker } from "./TofuPicker";
import { useDiscoverGames, type DiscoverGame } from "./useDiscoverGames";
import { useModrinthFeed } from "./useModrinthFeed";

type DiscoveryTab = { kind: "all" } | { kind: "minecraft"; category: ModrinthProjectType } | { kind: "game"; game: DiscoverGame };

type Props = {
  tofu: Tofu;
  pikos: Piko[];
  playtime?: Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>;
  nexusConfigured: boolean;
  supabase: SupabaseClient | null;
};

const loaderOptions = [{ value: "", label: "Any loader" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "neoforge", label: "NeoForge" }, { value: "quilt", label: "Quilt" }];
const cfLabels: Record<ModrinthProjectType, string> = { mod: "mods", modpack: "modpacks", resourcepack: "resource packs", shader: "shaders" };
const releaseOf = (tofu: Tofu) => /^\d+\.\d+(\.\d+)?$/.test(tofu.version) ? tofu.version : undefined;

export function ModrinthDiscover({ tofu, pikos, nexusConfigured, supabase }: Props) {
  const { behavior, setActiveNav } = useApp();
  const settings = behavior.modSources;
  const discover = useDiscoverGames(settings, nexusConfigured);
  const [tab, setTab] = useState<DiscoveryTab>({ kind: "all" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [detailsVersion, setDetailsVersion] = useState("");
  const [tofuPicker, setTofuPicker] = useState<{ project: ModrinthProject; loader: string } | null>(null);
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [cfVersion, setCfVersion] = useState("");
  const [cfLoader, setCfLoader] = useState("");
  const [pendingKey, setPendingKey] = useState("");

  const minecraftSources = resolveSources({ minecraft: true }, settings);
  const modrinthOn = settings.modrinth;
  const nothingOn = !settings.modrinth && !settings.curseforge && !(settings.nexus && nexusConfigured);
  const preview = useModrinthFeed({ projectType: "mod", sort: "downloads" }, tab.kind === "all" && modrinthOn, 8);

  const detailsRequest = useRef(0);
  const openDetails = async (project: ModrinthProject, version: string) => {
    setMessage("");
    const mine = ++detailsRequest.current;
    try {
      setDetailsVersion(version);
      const detail = await getModrinthProject(project.project_id);
      // Opening another project while this one loads must not let the slower answer replace it.
      if (mine === detailsRequest.current) setDetails({ ...project, ...detail, author: project.author || detail.author });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  };

  const install = async (project: ModrinthProject, target: Tofu, loader: string) => {
    if (!target.path) { setMessage(`${target.name} has no folder yet. Choose one in the game's Tofu settings first.`); return; }
    setBusyId(project.project_id);
    setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, target.version === "Local" ? undefined : target.version, project.project_type === "mod" ? loader || undefined : undefined);
      const version = versions.find((item) => item.files.length > 0);
      const file = version?.files.find((item) => item.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, target.path, target.id, target.name, project.title, file.filename);
      setMessage("Queued " + project.title + " for " + target.name + ".");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to queue this download."); }
    finally { setBusyId(""); }
  };

  const gameSource = useMemo(() => {
    if (tab.kind !== "game") return null;
    const game = tab.game;
    if (game.source === "curseforge" && game.cf) return createCurseforgeSource({ gameId: game.cf.id, gameSlug: game.cf.slug });
    if (game.source === "nexus" && game.nexusDomain && supabase) return createNexusSource(supabase, { domain: game.nexusDomain, name: game.name });
    return null;
  }, [tab, supabase]);

  const minecraftCategory = tab.kind === "minecraft" ? tab.category : "mod";
  const effective = minecraftSourceFor(minecraftCategory, provider, settings);
  const minecraftCfSource = useMemo(() => createCurseforgeSource({ gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS[minecraftCategory] }), [minecraftCategory]);
  const mcTofuFilter = (target: Tofu) => ({ gameVersion: releaseOf(target) });
  const reload = () => { setRefreshKey((value) => value + 1); if (tab.kind === "all") preview.retry(); discover.retry(); };
  // A game just added from the picker opens as soon as its tab exists.
  useEffect(() => {
    const game = pendingKey ? discover.games.find((candidate) => candidate.key === pendingKey) : undefined;
    if (game) { setTab({ kind: "game", game }); setPendingKey(""); }
  }, [pendingKey, discover.games]);
  const loading = preview.loading || discover.cfLoading;

  const gameCard = (game: DiscoverGame) => <button type="button" className="suggested-game-card" key={game.key} onClick={() => setTab({ kind: "game", game })}>
    {game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name} /> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}
    <span><strong>{game.name}</strong><small>{game.source === "curseforge" ? "CurseForge" : "Nexus Mods"}</small></span><span className="text-button">Browse</span>
  </button>;

  return <>
    <section className="modrinth-discover">
      <div className="discover-header">
        <div><p className="eyebrow">Discovery</p><h2>Discover</h2><p>Browse community content from the mod sites available to you. Most games need no account.</p></div>
        <button type="button" className="secondary-button" onClick={reload} disabled={loading}>{loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button>
      </div>

      {nothingOn ? <p className="metadata-note" role="status">All mod sources are turned off. <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button> and enable one under Mod sources.</p> : <>
      <div className="discover-game-tabs" role="tablist" aria-label="Game discovery">
        <button className={tab.kind === "all" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "all"} onClick={() => setTab({ kind: "all" })}>All</button>
        {minecraftSources.length > 0 && <button className={tab.kind === "minecraft" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-label="Minecraft" title="Minecraft" aria-selected={tab.kind === "minecraft"} onClick={() => setTab({ kind: "minecraft", category: "mod" })}><MinecraftIcon /><span className="discover-game-name">Minecraft</span></button>}
        {discover.games.map((game) => {
          const active = tab.kind === "game" && tab.game.key === game.key;
          return <button key={game.key} className={active ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={active} onClick={() => setTab({ kind: "game", game })}>
            {game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name} /> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}
            <span className="discover-game-name">{game.name}</span>
          </button>;
        })}
        {(settings.curseforge || discover.nexusOn) && <button className="discover-game-add" type="button" title="Add a game" aria-label="Add a game" onClick={() => setShowPicker(true)}><Plus size={17} /></button>}
      </div>
      {discover.cfError && <div className="discover-error" role="alert"><p><WifiOff size={14} /> CurseForge games are unavailable</p><small>{discover.cfError}</small><button type="button" className="secondary-button" onClick={discover.retry}><RefreshCw size={13} /> Retry</button></div>}
      {message && <p className="metadata-note" role="status">{message}</p>}

      {tab.kind === "all" && <>
        {modrinthOn && <section className="discover-section"><div className="discover-section-heading"><div><h3>Popular Minecraft mods</h3><p>The most downloaded Minecraft mods from Modrinth.</p></div><button className="text-button" type="button" onClick={() => setTab({ kind: "minecraft", category: "mod" })}>Browse Minecraft</button></div>
          {preview.offline && <p className="metadata-note discover-offline" role="status"><WifiOff size={13} /> Showing cached results (offline).</p>}
          {preview.loading ? <div className="discover-grid" aria-busy="true"><ProjectSkeletons count={8} /></div> : preview.error ? <div className="discover-error" role="alert"><p>Could not load projects from Modrinth.</p><small>{preview.error}</small><button type="button" className="secondary-button" onClick={preview.retry}><RefreshCw size={13} /> Retry</button></div> : <div className="discover-grid">{preview.items.slice(0, 8).map((project, index) => <ProjectCard key={project.project_id} project={project} index={index} badge="Modrinth" onView={(value) => void openDetails(value, "")} onChoose={(value) => setTofuPicker({ project: value, loader: "" })} />)}</div>}
        </section>}
        <section className="discover-section"><div className="discover-section-heading"><div><h3>Games</h3><p>Pick a game to browse its mods. Each game uses one source: CurseForge when it is there, otherwise Nexus Mods.</p></div></div>
          <div className="suggested-game-list">{minecraftSources.length > 0 && <button type="button" className="suggested-game-card" onClick={() => setTab({ kind: "minecraft", category: "mod" })}><MinecraftIcon /><span><strong>Minecraft</strong><small>{minecraftSources.map((id) => id === "modrinth" ? "Modrinth" : "CurseForge").join(" and ")}</small></span><span className="text-button">Browse</span></button>}{discover.games.map(gameCard)}</div>
          {settings.curseforge && <CurseforgeCredit />}
        </section>
      </>}

      {tab.kind === "minecraft" && (minecraftSources.length === 0 ? <p className="metadata-note" role="status">Modrinth and CurseForge are both turned off. <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button> to enable one.</p> : <>
        {minecraftSources.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod source"><span>Source</span>{minecraftSources.map((id) => <button key={id} type="button" className={effective === id ? "active" : ""} aria-pressed={effective === id} onClick={() => setProvider(id as "modrinth" | "curseforge")}>{id === "modrinth" ? "Modrinth" : "CurseForge"}</button>)}</div>}
        {effective === "modrinth"
          ? <MinecraftBrowser key={refreshKey} category={tab.category} onCategory={(category) => setTab({ kind: "minecraft", category })} tofuVersion={tofu.version} busy={busyId !== ""} onView={(project, version) => void openDetails(project, version)} onChoose={(project, loader) => setTofuPicker({ project, loader })} />
          : <>
            <div className="discover-tabs" role="tablist" aria-label="Minecraft content categories">{minecraftTabs.map((item) => <button key={item.id} className={tab.category === item.id ? "active" : ""} type="button" role="tab" aria-selected={tab.category === item.id} onClick={() => setTab({ kind: "minecraft", category: item.id })}>{item.label}</button>)}</div>
            <div className="mods-controls"><input className="compact-input" value={cfVersion} onChange={(event) => setCfVersion(event.target.value)} placeholder="Game version" aria-label="Game version" />{tab.category === "mod" && <Select value={cfLoader} onChange={setCfLoader} options={loaderOptions} label="Loader" searchable={false} />}</div>
            <ModsBrowser key={`${refreshKey}:${tab.category}`} source={minecraftCfSource} target={{ kind: "choose", pikos, ecosystem: { source: "curseforge", gameId: CF_MINECRAFT_ID }, tofuFilter: mcTofuFilter }} filter={{ gameVersion: cfVersion || undefined, loader: cfLoader || undefined }} noun={cfLabels[tab.category]} />
          </>}
      </>)}

      {tab.kind === "game" && <section className="discover-section">
        <div className="discover-section-heading"><div><h3>{tab.game.name} mods</h3><p>From {tab.game.source === "curseforge" ? "CurseForge" : "Nexus Mods"}.{tab.game.source === "nexus" ? " Free Nexus accounts download the file on the Nexus site." : ""}</p></div></div>
        {gameSource
          ? <ModsBrowser key={`${tab.game.key}:${refreshKey}`} source={gameSource} target={{ kind: "choose", pikos, ecosystem: tab.game.source === "curseforge" && tab.game.cf ? { source: "curseforge", gameId: tab.game.cf.id } : { source: "nexus", domain: tab.game.nexusDomain ?? "" } }} noun="mods" />
          : <div className="discover-empty">This game is not available right now.</div>}
      </section>}
      </>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={detailsVersion} onClose={() => setDetails(null)} />}
    {tofuPicker && <TofuPicker title={tofuPicker.project.title} pikos={pikos} prefer={(piko) => isLinkedTo(piko, { source: "modrinth" })} onClose={() => setTofuPicker(null)} onInstall={(target) => { const { project, loader } = tofuPicker; setTofuPicker(null); void install(project, target, loader); }} />}
    {showPicker && <AddGamePicker cfGames={discover.cfGames} cfEnabled={settings.curseforge} nexusEnabled={discover.nexusOn} onClose={() => setShowPicker(false)} onChoose={(entry) => { discover.add(entry); setShowPicker(false); setPendingKey(entry.k === "cf" ? `cf:${entry.id}` : `nx:${entry.domain}`); }} />}
  </>;
}
