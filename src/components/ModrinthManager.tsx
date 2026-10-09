import { RemoteImage } from "./RemoteImage";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, FolderOpen, PackageOpen, RefreshCw, Save, Search, Settings2, Trash2 } from "lucide-react";
import { applyModProfile, searchModrinth, type ModrinthProject, type ModrinthProjectType } from "../lib/modrinth";
import { openPath } from "../lib/platform";
import { Select } from "./ui/Select";
import { ModsBrowser } from "./mods/ModsBrowser";
import { InstalledModsPanel } from "./mods/InstalledModsPanel";
import { ModFolderModal } from "./mods/ModFolderModal";
import { UpdatesPanel } from "./mods/UpdatesPanel";
import { ModSyncStatus } from "./mods/ModSyncStatus";
import { useAutoModFolder } from "./mods/useAutoModFolder";
import { InstallNoticeBar } from "./mods/InstallNoticeBar";
import { DependencySheet } from "./mods/DependencySheet";
import { useModInstall } from "./mods/useModInstall";
import { useInstalledFiles } from "./mods/useInstalledFiles";
import { useInstallState } from "./mods/useInstallState";
import type { InstallState } from "../lib/mods/installState";
import { createCurseforgeSource } from "../lib/mods/curseforgeSource";
import { createModrinthSource, modrinthItem } from "../lib/mods/modrinthSource";
import { describeFolders } from "../lib/mods/folders";
import { ensureTofuFolder } from "../lib/mods/autoFolder";
import { contentFolder, tofusSharing, type ContentKind } from "../lib/mods/targets";
import { useTofuSwitch } from "./mods/useTofuSwitch";
import { MINECRAFT_CLASS, minecraftSourceFor, resolveSources } from "../lib/mods/resolveSources";
import { CF_MINECRAFT_ID } from "../lib/curseforge";
import { ALL_LOADERS, loaderLabels, tofuTarget } from "../lib/mods/compat";
import { useApp } from "../state/AppContext";
import { confirmAction } from "../lib/confirm";
import { ensureChecked, updateCount, useTofuUpdates } from "../state/modUpdates";
import type { ModProfile, Piko, Tofu } from "../models";

const loaderOptions = [{ value: "", label: "Any loader" }, ...ALL_LOADERS.filter((loader) => loader !== "vanilla").map((loader) => ({ value: loader as string, label: loaderLabels[loader] }))];

type Props = { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void };
type Tab = ModrinthProjectType | "profiles" | "updates";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "mod", label: "Mods" }, { id: "resourcepack", label: "Resource Packs" }, { id: "shader", label: "Shaders" },
  { id: "profiles", label: "Profiles" }, { id: "updates", label: "Updates" },
];
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);
const baseName = (filename: string) => filename.replace(/\.disabled$/, "");
const kindOf = (tab: Tab): ContentKind => (tab === "resourcepack" ? "resourcepack" : tab === "shader" ? "shader" : "mod");
const noun = (tab: Tab) => (tab === "resourcepack" ? "resource packs" : tab === "shader" ? "shaders" : "mods");

export function ModrinthManager({ piko, tofu, onUpdate }: Props) {
  const { behavior, setActiveNav } = useApp();
  const enabledSources = resolveSources({ minecraft: true }, behavior.modSources);
  const target = useMemo(() => tofuTarget(tofu), [tofu.loader, tofu.version, tofu.runtime, tofu.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [tab, setTab] = useState<Tab>("mod");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [gameVersion, setGameVersion] = useState(target.gameVersion ?? "");
  const [loader, setLoader] = useState(target.loader && target.loader !== "vanilla" ? target.loader : "");
  const [profileName, setProfileName] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const install = useModInstall();
  const updates = useTofuUpdates(tofu.id);
  const auto = useAutoModFolder(piko, tofu, onUpdate);
  const stateOf = useInstallState(tofu);

  // Follow the Tofu's own loader/version when the user sets them in its folder settings.
  useEffect(() => { setGameVersion(target.gameVersion ?? ""); setLoader(target.loader && target.loader !== "vanilla" ? target.loader : ""); }, [tofu.id, target.gameVersion, target.loader]);

  const folder = contentFolder(tofu, kindOf(tab === "profiles" || tab === "updates" ? "mod" : tab));
  const siblingIds = useMemo(() => tofusSharing(piko.tofus, tofu).map((other) => other.id), [piko.tofus, tofu]);
  const { files: installed, loading: loadingFiles, error: filesError, refresh: refreshInstalled, pending: pendingDownloads } = useInstalledFiles(tofu, folder, siblingIds);
  const switching = useTofuSwitch(piko, tofu, installed.map((file) => `${file.filename}:${file.record?.source ?? ""}`).join("|"), () => void refreshInstalled());
  useEffect(() => { if (filesError) setMessage(filesError); }, [filesError]);

  // Keep the Tofu's mod count truthful (main folder only).
  useEffect(() => {
    if (folder && !folder.subdir && tofu.path && installed.length !== tofu.mods) onUpdate({ mods: installed.length });
  }, [installed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look for updates once when this Tofu is opened (and again only after a few hours); never blocks anything.
  useEffect(() => { if (tofu.path) void ensureChecked(tofu, piko, behavior.modSources); }, [tofu.id, tofu.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true); setMessage("");
    try { setResults(await searchModrinth(query, tab === "mod" || tab === "resourcepack" || tab === "shader" ? tab : "mod")); }
    catch (error) { setMessage(errorText(error, "Unable to search Modrinth.")); } finally { setBusy(false); }
  };

  const installProject = async (project: ModrinthProject) => {
    // A Tofu without a folder takes the detected one; only when nothing was found does the user have to choose.
    const ready = await ensureTofuFolder(piko, tofu, onUpdate);
    if (!ready) { setMessage("Mochi could not find where Minecraft loads mods. Choose the folder under Mod folders."); setFolderOpen(true); return; }
    const type: ModrinthProjectType = tab === "resourcepack" || tab === "shader" ? tab : "mod";
    await install.installBest(createModrinthSource(type), modrinthItem(project), ready, { gameVersion: gameVersion || undefined, loader: loader || undefined });
  };

  // ----- Profiles -----
  const profiles = tofu.profiles ?? [];
  const enabledNames = () => installed.filter((file) => file.enabled).map((file) => baseName(file.filename));
  const saveProfile = () => {
    const name = profileName.trim();
    if (!name) return;
    const profile: ModProfile = { id: `profile-${crypto.randomUUID()}`, name, files: enabledNames() };
    onUpdate({ profiles: [...profiles, profile], activeProfileId: profile.id });
    setProfileName("");
  };
  const applyProfile = async (profile: ModProfile) => {
    if (!tofu.path) return;
    setBusy(true);
    try { await applyModProfile(tofu.path, profile.files); onUpdate({ activeProfileId: profile.id }); } catch (error) { setMessage(errorText(error, "Unable to apply the profile.")); }
    await refreshInstalled();
    setBusy(false);
  };
  const updateProfile = (profile: ModProfile) => onUpdate({ profiles: profiles.map((item) => item.id === profile.id ? { ...item, files: enabledNames() } : item) });
  const deleteProfile = async (profile: ModProfile) => {
    if (!await confirmAction({ title: "Delete profile?", message: `The “${profile.name}” profile will be removed. Your installed mods and files are not touched.`, confirmLabel: "Delete", danger: true })) return;
    onUpdate({ profiles: profiles.filter((item) => item.id !== profile.id), activeProfileId: tofu.activeProfileId === profile.id ? undefined : tofu.activeProfileId });
  };

  const isSearchTab = tab === "mod" || tab === "resourcepack" || tab === "shader";
  const effective = isSearchTab ? minecraftSourceFor(tab, provider, behavior.modSources) : null;
  const curseforgeSource = useMemo(() => isSearchTab ? createCurseforgeSource({ gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS[tab], kind: tab === "resourcepack" ? "Resource Packs" : tab === "shader" ? "Shaders" : "Mods" }) : null, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = updateCount(updates);
  const updatesLabel = count ? `Updates (${count})` : "Updates";

  if (!enabledSources.length) return <section className="modrinth-manager"><div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace</p><h3>{tofu.name}</h3></div></div>
    <p className="metadata-note" role="status">All mod sources are turned off. <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button> and enable Modrinth or CurseForge under Mod sources.</p></section>;

  const fileFilter = { gameVersion: gameVersion || undefined, loader: loader || undefined };
  const installedPanel = folder ? <InstalledModsPanel piko={piko} tofu={tofu} folder={folder} withUpdates={!folder.subdir} files={installed} loading={loadingFiles} refresh={refreshInstalled} onMessage={setMessage} /> : <p className="muted">Choose a Tofu folder to manage {noun(tab)}.</p>;
  const openTarget = tofu.gameDir && !tofu.path ? tofu.gameDir : tofu.path;

  return <section className="modrinth-manager">
    <div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace</p><h3>{tofu.name}{target.loader || target.gameVersion ? <small className="workspace-meta"> {[target.loader ? loaderLabels[target.loader] : "", target.gameVersion ?? ""].filter(Boolean).join(" ")}</small> : null}</h3><p className="workspace-path">{tofu.path ? describeFolders(tofu) : "Choose a folder to enable content management."}</p></div>
      <div className="tofu-workspace-actions">{openTarget && <button type="button" className="secondary-button" onClick={() => void openPath(openTarget).catch((error) => setMessage(errorText(error, "Unable to open the folder.")))}><FolderOpen size={14}/> Open</button>}<button type="button" className="secondary-button" onClick={() => setFolderOpen(true)}><Settings2 size={14}/> Mod folders</button></div></div>
    {auto.state === "applied" && auto.applied && <p className="metadata-note" role="status">Found {auto.applied.label}. Mochi will manage mods in {auto.applied.modsDir}.{auto.others > 0 && <> {auto.others} other place{auto.others === 1 ? "" : "s"} found. <button type="button" className="text-button" onClick={() => setFolderOpen(true)}>Change</button></>}</p>}
    {auto.state === "missing" && <p className="metadata-note" role="status">Mochi could not find a Minecraft folder. <button type="button" className="text-button" onClick={() => setFolderOpen(true)}>Choose the folder</button></p>}
    <div className="workspace-tabs">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.id === "updates" ? updatesLabel : item.label}</button>)}</div>
    <ModSyncStatus tofuId={tofu.id} />
    {switching.message && <p className="metadata-note" role="status">{switching.message}</p>}
    {message && <p className="metadata-note" role="status">{message}</p>}
    <InstallNoticeBar notice={install.notice} onDismiss={() => install.setNotice(null)} />
    {install.prompt && <DependencySheet prompt={install.prompt} />}
    {pendingDownloads > 0 && <p className="metadata-note">{pendingDownloads} download{pendingDownloads === 1 ? "" : "s"} in progress. See Downloads.</p>}
    {isSearchTab && enabledSources.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod source">
      <span>Source</span>{enabledSources.map((id) => <button key={id} type="button" className={effective === id ? "active" : ""} aria-pressed={effective === id} onClick={() => setProvider(id as "modrinth" | "curseforge")}>{id === "modrinth" ? "Modrinth" : "CurseForge"}</button>)}
    </div>}
    {isSearchTab && effective === "curseforge" && curseforgeSource ? <>
      <div className="modrinth-controls"><input className="compact-input" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} placeholder="Game version" aria-label="Game version" />{tab === "mod" && <Select className="compact-select" value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} />}</div>
      <div className="content-split">{installedPanel}
      <div><div className="workspace-section-title"><strong>Discover on CurseForge</strong></div><ModsBrowser key={tab} source={curseforgeSource} target={{ kind: "tofu", tofu, onUpdateTofu: onUpdate, piko }} filter={fileFilter} noun={noun(tab)} collapsedCount={8} /></div></div>
    </> : isSearchTab ? <>
      <div className="modrinth-controls"><label className="search-box"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder={"Search Modrinth " + noun(tab) + "..."} aria-label={"Search Modrinth " + noun(tab)} /><kbd>Enter</kbd></label><input className="compact-input" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} placeholder="Game version" aria-label="Game version" />{tab === "mod" && <Select className="compact-select" value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} />}<button type="button" className="secondary-button" onClick={() => void search()} disabled={busy}>{busy ? <RefreshCw size={14} className="spin"/> : <Search size={14}/>} Search</button></div>
      <div className="content-split">{installedPanel}
      <div><div className="workspace-section-title"><strong>Discover on Modrinth</strong><span>{results.length} results</span></div><div className="modrinth-results">{results.map((project) => <article className="modrinth-result" key={project.project_id}>{project.icon_url ? <RemoteImage src={project.icon_url} alt="" /> : <div className="modrinth-result-icon"><PackageOpen size={17}/></div>}<div><strong>{project.title}</strong><small>{project.author || "Modrinth creator"} · {(project.downloads ?? 0).toLocaleString()} downloads</small><p>{project.description}</p></div><ModrinthInstallButton project={project} state={stateOf({ source: "modrinth", id: project.project_id })} busy={install.busyId === project.project_id} onInstall={() => void installProject(project)} /></article>)}</div></div></div>
    </> : tab === "profiles" ? <div className="profile-panel">
      {!tofu.path ? <p className="muted">Choose a Tofu folder to create mod profiles.</p> : <>
        <p className="muted">A profile remembers which mods are enabled. Switch profiles to enable exactly that set and disable the rest. Nothing is deleted.</p>
        <div className="profile-create"><input className="compact-input" value={profileName} onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveProfile(); }} placeholder="Profile name" aria-label="Profile name" maxLength={60} /><button type="button" className="secondary-button" onClick={saveProfile} disabled={!profileName.trim()}><Save size={13}/> Save current mods</button></div>
        <div className="profile-list">{profiles.map((profile) => <div className={"profile-row " + (tofu.activeProfileId === profile.id ? "active" : "")} key={profile.id}><span><strong>{profile.name}</strong><small>{profile.files.length} mod{profile.files.length === 1 ? "" : "s"} enabled{tofu.activeProfileId === profile.id ? " · Active" : ""}</small></span><button type="button" className="secondary-button" disabled={busy} onClick={() => void applyProfile(profile)}>Apply</button><button type="button" className="secondary-button" onClick={() => updateProfile(profile)} title="Replace with the currently enabled mods">Update</button><button type="button" className="icon-button" aria-label={`Delete profile ${profile.name}`} onClick={() => void deleteProfile(profile)}><Trash2 size={14}/></button></div>)}{!profiles.length && <p className="muted">No profiles yet.</p>}</div>
      </>}
    </div> : <UpdatesPanel tofu={tofu} piko={piko} onRefresh={refreshInstalled} />}
    {folderOpen && <ModFolderModal piko={piko} tofu={tofu} onUpdate={onUpdate} onClose={() => setFolderOpen(false)} />}
  </section>;
}

/** Install button of a Modrinth search result, following the mod's state in the Tofu (downloading, downloaded). */
function ModrinthInstallButton({ project, state, busy, onInstall }: { project: ModrinthProject; state: InstallState; busy: boolean; onInstall: () => void }) {
  if (state.kind === "downloading") return <button type="button" className="secondary-button mod-action is-downloading" disabled aria-busy="true"><RefreshCw size={13} className="spin" /> Downloading{state.progress != null ? ` ${Math.round(state.progress * 100)}%` : "…"}</button>;
  if (state.kind === "installed" || state.kind === "update") return <button type="button" className="secondary-button mod-action is-installed" disabled aria-label={`${project.title} is downloaded`}><Check size={13} /> {state.kind === "update" ? "Update in Updates tab" : "Downloaded"}</button>;
  return <button type="button" className="secondary-button mod-action" onClick={onInstall} disabled={busy} aria-label={`Install ${project.title}`}><Download size={13} /> Install</button>;
}
