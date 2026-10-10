import { DISCOVER_QUERY_EVENT } from "../../lib/discoverQuery";
import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, RefreshCw, WifiOff } from "lucide-react";
import { getModrinthProject, type ModrinthProject, type ModrinthProjectDetails, type ModrinthProjectType } from "../../lib/modrinth";
import { CF_MINECRAFT_ID } from "../../lib/curseforge";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { minecraftFilterFor } from "../../lib/mods/gameVersion";
import { MINECRAFT_CLASS, minecraftSourceFor, resolveSources } from "../../lib/mods/resolveSources";
import { createModrinthSource, modrinthFile, modrinthItem } from "../../lib/mods/modrinthSource";
import type { Piko, Tofu } from "../../models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useApp } from "../../state/AppContext";
import { CurseforgeCredit } from "../mods/CurseforgeCredit";
import { DependencySheet } from "../mods/DependencySheet";
import { InstallNoticeBar } from "../mods/InstallNoticeBar";
import { ModsBrowser } from "../mods/ModsBrowser";
import { useModInstall } from "../mods/useModInstall";
import { Select } from "../ui/Select";
import { AddGamePicker } from "./AddGamePicker";
import { AllGamesFeed } from "./AllGamesFeed";
import { DiscoverTabs, type DiscoverTabItem } from "./DiscoverTabs";
import { GameDiscoverTab } from "./GameDiscoverTab";
import { MinecraftBrowser, minecraftTabs } from "./MinecraftBrowser";
import { MinecraftIcon } from "./DiscoveryImage";
import { ProjectDetails } from "./ProjectDetails";
import { TofuPicker } from "./TofuPicker";
import { metasOfItem } from "../../lib/mods/itemMeta";
import { metaFromModFile } from "../../lib/mods/compat";
import { useDiscoverGames } from "./useDiscoverGames";

type DiscoveryTab = { kind: "all" } | { kind: "minecraft"; category: ModrinthProjectType } | { kind: "game"; key: string };

type Props = {
  tofu: Tofu;
  pikos: Piko[];
  playtime?: Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>;
  supabase: SupabaseClient | null;
  /** The user saved a Nexus key: only then are the built-in Nexus-only seed games listed (added games are always browsable). */
  nexusConfigured: boolean;
  /** IGDB credentials are stored server-side; this flag only reports whether a key is configured. */
  igdbConfigured: boolean;
};

const loaderOptions = [{ value: "", label: "Any loader" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "neoforge", label: "NeoForge" }, { value: "quilt", label: "Quilt" }];
const cfLabels: Record<ModrinthProjectType, string> = { mod: "mods", modpack: "modpacks", resourcepack: "resource packs", shader: "shaders" };
const tabId = (tab: DiscoveryTab) => tab.kind === "game" ? tab.key : tab.kind;

export function ModrinthDiscover({ tofu, pikos, supabase, nexusConfigured, igdbConfigured }: Props) {
  const { behavior, setActiveNav } = useApp();
  const settings = behavior.modSources;
  const discover = useDiscoverGames(settings, nexusConfigured, igdbConfigured, supabase);
  const [tab, setTab] = useState<DiscoveryTab>({ kind: "all" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [detailsVersion, setDetailsVersion] = useState("");
  const [loadError, setLoadError] = useState("");
  const [picker, setPicker] = useState<{ project: ModrinthProject; file?: ReturnType<typeof modrinthFile> } | null>(null);
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [cfVersion, setCfVersion] = useState("");
  const [cfLoader, setCfLoader] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const install = useModInstall();
  useEffect(() => { const toAll = () => setTab({ kind: "all" }); window.addEventListener(DISCOVER_QUERY_EVENT, toAll); return () => window.removeEventListener(DISCOVER_QUERY_EVENT, toAll); }, []);

  const minecraftSources = resolveSources({ minecraft: true }, settings);
  const nothingOn = !settings.modrinth && !settings.curseforge && !settings.nexus;
  const openSettings = () => setActiveNav("Settings");

  const detailsRequest = useRef(0);
  const openDetails = async (project: ModrinthProject, version: string) => {
    setLoadError("");
    const mine = ++detailsRequest.current;
    try {
      setDetailsVersion(version);
      const detail = await getModrinthProject(project.project_id);
      // Opening another project while this one loads must not let the slower answer replace it.
      if (mine === detailsRequest.current) setDetails({ ...project, ...detail, author: project.author || detail.author });
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load project details."); }
  };

  /** Modrinth downloads go through the same path as every other site: content folder, SHA-1, record, Downloads tab. */
  const installModrinth = (project: ModrinthProject, file: ReturnType<typeof modrinthFile> | undefined, target: Tofu, force: boolean) => {
    if (!target.path) { install.setNotice({ tone: "info", message: `${target.name} has no folder yet. Choose one in the game's Tofu settings first.` }); return; }
    const source = createModrinthSource(project.project_type);
    const item = modrinthItem(project);
    const filter = minecraftFilterFor(target, project.project_type === "mod");
    if (file) void install.installFile(source, item, file, target, filter, force);
    else void install.installBest(source, item, target, filter, force);
  };

  const minecraftCategory = tab.kind === "minecraft" ? tab.category : "mod";
  const effective = minecraftSourceFor(minecraftCategory, provider, settings);
  const minecraftCfSource = useMemo(() => createCurseforgeSource({ gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS[minecraftCategory] }), [minecraftCategory]);
  const reload = () => { setRefreshKey((value) => value + 1); discover.retry(); };
  // A game just added from the picker opens as soon as its tab exists.
  useEffect(() => {
    const game = pendingKey ? discover.games.find((candidate) => candidate.key === pendingKey) : undefined;
    if (game) { setTab({ kind: "game", key: game.key }); setPendingKey(""); }
  }, [pendingKey, discover.games]);
  // A removed or switched-off game must not leave an empty page behind.
  useEffect(() => { if (tab.kind === "game" && !discover.games.some((game) => game.key === tab.key)) setTab({ kind: "all" }); }, [tab, discover.games]);
  const activeGame = tab.kind === "game" ? discover.games.find((game) => game.key === tab.key) : undefined;

  const mc432 = discover.cfGames?.find((game) => game.id === CF_MINECRAFT_ID);
  const tabs: DiscoverTabItem[] = [
    { id: "all", label: "All", icon: <Layers size={15} />, hint: "Mods from every game" },
    ...(minecraftSources.length > 0 ? [{ id: "minecraft", label: "Minecraft", iconUrl: mc432?.assets?.iconUrl, icon: mc432?.assets?.iconUrl ? undefined : <MinecraftIcon /> }] : []),
    ...discover.games.map((game) => ({ id: game.key, label: game.name, iconUrl: game.iconUrl, removable: discover.removableKeys.has(game.key) })),
  ];
  const selectTab = (id: string) => {
    if (id === "all") setTab({ kind: "all" });
    else if (id === "minecraft") setTab({ kind: "minecraft", category: "mod" });
    else setTab({ kind: "game", key: id });
  };

  return <>
    <section className="modrinth-discover">
      <div className="discover-header">
        <div><p className="eyebrow">Discovery</p><h2>Discover</h2><p>Browse community content from the mod sites available to you. Most games need no account.</p></div>
        <button type="button" className="secondary-button" onClick={reload} disabled={discover.cfLoading}>{discover.cfLoading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button>
      </div>

      {nothingOn ? <p className="metadata-note" role="status">All mod sources are turned off. <button type="button" className="text-button" onClick={openSettings}>Open Settings</button> and enable one under Mod sources.</p> : <>
      <DiscoverTabs tabs={tabs} active={tabId(tab)} onSelect={selectTab} onRemove={discover.remove} onAdd={settings.curseforge || settings.nexus ? () => setShowPicker(true) : undefined} />
      {discover.cfError && <div className="discover-error" role="alert"><p><WifiOff size={14} /> CurseForge games are unavailable</p><small>{discover.cfError}</small><button type="button" className="secondary-button" onClick={discover.retry}><RefreshCw size={13} /> Retry</button></div>}
      {loadError && <p className="metadata-note" role="status">{loadError}</p>}
      {install.prompt && <DependencySheet prompt={install.prompt} />}
      {tab.kind === "minecraft" && effective === "modrinth" && <InstallNoticeBar notice={install.notice} onDismiss={() => install.setNotice(null)} />}

      {tab.kind === "all" && <>
        <AllGamesFeed games={discover.games} cfGames={discover.cfGames} onSeeAll={selectTab} onAddGame={(entry) => { discover.add(entry); if (entry.k === "cf") setPendingKey(`cf:${entry.id}`); }} pikos={pikos} supabase={supabase} settings={settings} refreshKey={refreshKey} />
        {settings.curseforge && <CurseforgeCredit />}
      </>}

      {tab.kind === "minecraft" && (minecraftSources.length === 0 ? <p className="metadata-note" role="status">Modrinth and CurseForge are both turned off. <button type="button" className="text-button" onClick={openSettings}>Open Settings</button> to enable one.</p> : <>
        {minecraftSources.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod source"><span>Source</span>{minecraftSources.map((id) => <button key={id} type="button" className={effective === id ? "active" : ""} aria-pressed={effective === id} onClick={() => setProvider(id as "modrinth" | "curseforge")}>{id === "modrinth" ? "Modrinth" : "CurseForge"}</button>)}</div>}
        {effective === "modrinth"
          ? <MinecraftBrowser key={refreshKey} category={tab.category} onCategory={(category) => setTab({ kind: "minecraft", category })} tofuVersion={tofu.version} busy={install.busyId !== ""} onView={(project, version) => void openDetails(project, version)} onChoose={(project) => setPicker({ project })} />
          : <>
            <div className="discover-tabs" role="tablist" aria-label="Minecraft content categories">{minecraftTabs.map((item) => <button key={item.id} className={tab.category === item.id ? "active" : ""} type="button" role="tab" aria-selected={tab.category === item.id} onClick={() => setTab({ kind: "minecraft", category: item.id })}>{item.label}</button>)}</div>
            <div className="mods-controls"><input className="compact-input" value={cfVersion} onChange={(event) => setCfVersion(event.target.value)} placeholder="Game version" aria-label="Game version" />{tab.category === "mod" && <Select value={cfLoader} onChange={setCfLoader} options={loaderOptions} label="Loader" searchable={false} />}</div>
            <ModsBrowser key={`${refreshKey}:${tab.category}`} source={minecraftCfSource} target={{ kind: "choose", pikos, gameName: "Minecraft", ecosystem: { source: "curseforge", gameId: CF_MINECRAFT_ID }, tofuFilter: (target) => minecraftFilterFor(target, tab.category === "mod") }} filter={{ gameVersion: cfVersion || undefined, loader: cfLoader || undefined }} noun={cfLabels[tab.category]} />
          </>}
      </>)}

      {activeGame && <GameDiscoverTab game={activeGame} pikos={pikos} supabase={supabase} settings={settings} below={behavior.modAutoExtendBelow} refreshKey={refreshKey} />}
      </>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={detailsVersion} tofu={tofu} onClose={() => setDetails(null)} onDownload={(project, file) => { setDetails(null); setPicker({ project, file }); }} />}
    {picker && <TofuPicker title={picker.project.title} pikos={pikos} ecosystem={{ source: "modrinth" }} gameName="Minecraft"
      metas={picker.file ? [metaFromModFile(picker.file)] : metasOfItem(modrinthItem(picker.project))} onClose={() => setPicker(null)}
      onInstall={(target, _piko, force) => { const { project, file } = picker; setPicker(null); installModrinth(project, file, target, force); }} />}
    {showPicker && <AddGamePicker cfGames={discover.cfGames} nexusGames={discover.nexusCatalog} cfEnabled={settings.curseforge} nexusEnabled={settings.nexus} supabase={supabase} igdbConfigured={igdbConfigured}
      onClose={() => setShowPicker(false)} onChoose={(entry) => { discover.add(entry); setShowPicker(false); setPendingKey(entry.k === "cf" ? `cf:${entry.id}` : `nx:${entry.domain}`); }} />}
  </>;
}
