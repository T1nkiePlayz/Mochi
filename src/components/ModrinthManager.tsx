import { RemoteImage } from "./RemoteImage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, PackageOpen, Power, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import {
  analyzeModFiles, applyModProfile, deleteModFile, getDownloads, getModrinthVersions, listInstalledMods, searchModrinth,
  setModFileEnabled, startModrinthDownload, updateModFile,
  type InstalledModrinthFile, type ModAnalysis, type ModrinthProject, type ModrinthProjectType,
} from "../lib/modrinth";
import { openPath } from "../lib/platform";
import { Select } from "./ui/Select";
import { ModsBrowser } from "./mods/ModsBrowser";
import { createCurseforgeSource } from "../lib/mods/curseforgeSource";
import { MINECRAFT_CLASS, minecraftSourceFor, resolveSources } from "../lib/mods/resolveSources";
import { CF_MINECRAFT_ID } from "../lib/curseforge";
import { useApp } from "../state/AppContext";

const loaderOptions = [{ value: "", label: "Any loader" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "neoforge", label: "NeoForge" }, { value: "quilt", label: "Quilt" }];
import type { ModProfile, Tofu } from "../models";

type Props = { tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void };
type Tab = ModrinthProjectType | "profiles" | "updates";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "mod", label: "Mods" }, { id: "resourcepack", label: "Resource Packs" }, { id: "shader", label: "Shaders" },
  { id: "profiles", label: "Profiles" }, { id: "updates", label: "Updates" },
];
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);
const baseName = (filename: string) => filename.replace(/\.disabled$/, "");

export function ModrinthManager({ tofu, onUpdate }: Props) {
  const { behavior, setActiveNav } = useApp();
  const enabledSources = resolveSources({ minecraft: true }, behavior.modSources);
  const modrinthOn = enabledSources.includes("modrinth");
  const [provider, setProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [tab, setTab] = useState<Tab>("mod");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [installed, setInstalled] = useState<InstalledModrinthFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version);
  const [loader, setLoader] = useState("");
  const [profileName, setProfileName] = useState("");
  const [analysis, setAnalysis] = useState<ModAnalysis[] | null>(null);
  const [pendingDownloads, setPendingDownloads] = useState(0);
  const latestPath = useRef(tofu.path);
  latestPath.current = tofu.path;

  const refreshInstalled = useCallback(async () => {
    const path = latestPath.current;
    if (!path) { setInstalled([]); return; }
    try {
      const files = await listInstalledMods(path);
      if (latestPath.current === path) setInstalled(files);
    } catch (error) { setMessage(errorText(error, "Unable to read the Tofu folder.")); }
  }, []);
  useEffect(() => { setAnalysis(null); void refreshInstalled(); }, [tofu.path, refreshInstalled]);

  // Keep the Tofu's mod count truthful.
  useEffect(() => {
    if (tofu.path && installed.length !== tofu.mods) onUpdate({ mods: installed.length });
  }, [installed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh the installed list when downloads for this Tofu finish.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const mine = (await getDownloads()).filter((download) => download.tofuId === tofu.id);
        const active = mine.filter((download) => download.status === "downloading").length;
        if (cancelled) return;
        setPendingDownloads((previous) => { if (previous > active) void refreshInstalled(); return active; });
      } catch { /* browser/development mode */ }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tofu.id, refreshInstalled]);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true); setMessage("");
    try { setResults(await searchModrinth(query, tab === "mod" || tab === "resourcepack" || tab === "shader" ? tab : "mod")); }
    catch (error) { setMessage(errorText(error, "Unable to search Modrinth.")); } finally { setBusy(false); }
  };

  const install = async (project: ModrinthProject) => {
    if (!tofu.path) { setMessage("Choose a Tofu folder first."); return; }
    setBusy(true); setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, gameVersion || undefined, loader || undefined);
      const version = versions.find((candidate) => candidate.files.length > 0);
      const file = version?.files.find((candidate) => candidate.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, tofu.path, tofu.id, tofu.name, project.title, file.filename);
      setMessage("Queued " + project.title + " " + version.version_number + " for download.");
    } catch (error) { setMessage(errorText(error, "Installation failed.")); } finally { setBusy(false); }
  };

  const run = async (action: () => Promise<unknown>, failure: string) => {
    try { await action(); } catch (error) { setMessage(errorText(error, failure)); }
    await refreshInstalled();
  };

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose Tofu folder" });
    if (typeof selected === "string") onUpdate({ path: selected });
  };

  // ----- Profiles -----
  const profiles = tofu.profiles ?? [];
  const saveProfile = () => {
    const name = profileName.trim();
    if (!name) return;
    const profile: ModProfile = { id: `profile-${Date.now()}`, name, files: installed.filter((file) => file.enabled).map((file) => baseName(file.filename)) };
    onUpdate({ profiles: [...profiles, profile], activeProfileId: profile.id });
    setProfileName("");
  };
  const applyProfile = async (profile: ModProfile) => {
    if (!tofu.path) return;
    setBusy(true);
    await run(() => applyModProfile(tofu.path!, profile.files), "Unable to apply the profile.");
    onUpdate({ activeProfileId: profile.id });
    setBusy(false);
  };
  const updateProfile = (profile: ModProfile) =>
    onUpdate({ profiles: profiles.map((item) => item.id === profile.id ? { ...item, files: installed.filter((file) => file.enabled).map((file) => baseName(file.filename)) } : item) });
  const deleteProfile = (profile: ModProfile) =>
    onUpdate({ profiles: profiles.filter((item) => item.id !== profile.id), activeProfileId: tofu.activeProfileId === profile.id ? undefined : tofu.activeProfileId });

  // ----- Updates -----
  const checkUpdates = async () => {
    if (!tofu.path) return;
    setBusy(true); setMessage("");
    try {
      const found = await analyzeModFiles(tofu.path, gameVersion || undefined, loader || undefined);
      setAnalysis(found);
      const count = found.filter((item) => item.update).length;
      setMessage(count ? `${count} update${count === 1 ? "" : "s"} available.` : "Everything Modrinth recognises is up to date.");
    } catch (error) { setMessage(errorText(error, "Unable to check for updates.")); } finally { setBusy(false); }
  };
  const applyUpdate = async (item: ModAnalysis) => {
    if (!item.update) return;
    setBusy(true); setMessage("");
    try {
      await updateModFile(item.path, item.update);
      setMessage(`Updated ${item.title} to ${item.update.versionNumber}.`);
      setAnalysis((current) => current && current.filter((entry) => entry.path !== item.path));
    } catch (error) { setMessage(errorText(error, "Update failed.")); }
    await refreshInstalled();
    setBusy(false);
  };
  const applyAllUpdates = async () => {
    for (const item of (analysis ?? []).filter((entry) => entry.update)) await applyUpdate(item);
  };

  const isSearchTab = tab === "mod" || tab === "resourcepack" || tab === "shader";
  const effective = isSearchTab ? minecraftSourceFor(tab, provider, behavior.modSources) : null;
  const curseforgeSource = useMemo(() => isSearchTab ? createCurseforgeSource({ gameId: CF_MINECRAFT_ID, gameSlug: "minecraft", classId: MINECRAFT_CLASS[tab] }) : null, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleTabs = tabs.filter((item) => modrinthOn || item.id !== "updates");
  useEffect(() => { if (!modrinthOn && tab === "updates") setTab("mod"); }, [modrinthOn, tab]);
  const updatable = (analysis ?? []).filter((item) => item.update);

  if (!enabledSources.length) return <section className="modrinth-manager"><div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace</p><h3>{tofu.name}</h3></div></div>
    <p className="metadata-note" role="status">All mod sources are turned off. <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button> and enable Modrinth or CurseForge under Mod sources.</p></section>;

  return <section className="modrinth-manager">
    <div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace</p><h3>{tofu.name}</h3><p className="workspace-path">{tofu.path || "Choose a folder to enable content management."}</p></div>
      <div className="tofu-workspace-actions">{tofu.path && <button className="secondary-button" onClick={() => void openPath(tofu.path!).catch((error) => setMessage(errorText(error, "Unable to open the folder.")))}><FolderOpen size={14}/> Open</button>}<button className="secondary-button" onClick={chooseFolder}><FolderOpen size={14}/> {tofu.path ? "Change folder" : "Choose folder"}</button></div></div>
    <div className="workspace-tabs">{visibleTabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {message && <p className="metadata-note">{message}</p>}
    {pendingDownloads > 0 && <p className="metadata-note">{pendingDownloads} download{pendingDownloads === 1 ? "" : "s"} in progress — see Downloads.</p>}
    {isSearchTab && enabledSources.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod source">
      <span>Source</span>{enabledSources.map((id) => <button key={id} type="button" className={effective === id ? "active" : ""} aria-pressed={effective === id} onClick={() => setProvider(id as "modrinth" | "curseforge")}>{id === "modrinth" ? "Modrinth" : "CurseForge"}</button>)}
    </div>}
    {isSearchTab && effective === "curseforge" && curseforgeSource ? <>
      <div className="modrinth-controls"><input className="compact-input" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} placeholder="Game version" aria-label="Game version" />{tab === "mod" && <Select className="compact-select" value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} />}</div>
      <div className="content-split"><div><div className="workspace-section-title"><strong>Installed</strong><span>{installed.length}</span></div><div className="installed-content-list">{installed.map((file) => <div className="installed-content-row" key={file.path}><span><strong>{file.filename}</strong><small>{Math.round(file.size / 1024)} KB</small></span><button title={file.enabled ? "Disable" : "Enable"} aria-label={file.enabled ? "Disable" : "Enable"} onClick={() => void run(() => setModFileEnabled(file.path, !file.enabled), "Unable to change the file.")}><Power size={14}/></button><button title="Delete" aria-label="Delete" onClick={() => { if (window.confirm("Delete " + file.filename + "? This cannot be undone.")) void run(() => deleteModFile(file.path), "Unable to delete the file."); }}><Trash2 size={14}/></button></div>)}{!installed.length && <p className="muted">No content installed in this Tofu yet.</p>}</div></div>
      <div><div className="workspace-section-title"><strong>Discover on CurseForge</strong></div><ModsBrowser key={tab} source={curseforgeSource} target={{ kind: "tofu", tofu, onUpdateTofu: onUpdate }} filter={{ gameVersion: gameVersion || undefined, loader: loader || undefined }} noun={tab === "mod" ? "mods" : tab === "resourcepack" ? "resource packs" : "shaders"} /></div></div>
    </> : isSearchTab ? <>
      <div className="modrinth-controls"><label className="search-box"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder={"Search Modrinth " + (tab === "mod" ? "mods" : tab === "resourcepack" ? "resource packs" : "shaders") + "..."} /><kbd>Enter</kbd></label><input className="compact-input" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} placeholder="Game version" />{tab === "mod" && <Select className="compact-select" value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} />}<button className="secondary-button" onClick={() => void search()} disabled={busy}>{busy ? <RefreshCw size={14} className="spin"/> : <Search size={14}/>} Search</button></div>
      <div className="content-split"><div><div className="workspace-section-title"><strong>Installed</strong><span>{installed.length}</span></div><div className="installed-content-list">{installed.map((file) => <div className="installed-content-row" key={file.path}><span><strong>{file.filename}</strong><small>{Math.round(file.size / 1024)} KB</small></span><button title={file.enabled ? "Disable" : "Enable"} aria-label={file.enabled ? "Disable" : "Enable"} onClick={() => void run(() => setModFileEnabled(file.path, !file.enabled), "Unable to change the file.")}><Power size={14}/></button><button title="Delete" aria-label="Delete" onClick={() => { if (window.confirm("Delete " + file.filename + "? This cannot be undone.")) void run(() => deleteModFile(file.path), "Unable to delete the file."); }}><Trash2 size={14}/></button></div>)}{!installed.length && <p className="muted">No content installed in this Tofu yet.</p>}</div></div>
      <div><div className="workspace-section-title"><strong>Discover on Modrinth</strong><span>{results.length} results</span></div><div className="modrinth-results">{results.map((project) => <article className="modrinth-result" key={project.project_id}>{project.icon_url ? <RemoteImage src={project.icon_url} alt="" /> : <div className="modrinth-result-icon"><PackageOpen size={17}/></div>}<div><strong>{project.title}</strong><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p></div><button className="secondary-button" onClick={() => void install(project)} disabled={busy || !tofu.path}><Download size={13}/> Install</button></article>)}</div></div></div>
    </> : tab === "profiles" ? <div className="profile-panel">
      {!tofu.path ? <p className="muted">Choose a Tofu folder to create mod profiles.</p> : <>
        <p className="muted">A profile remembers which mods are enabled. Switch profiles to enable exactly that set and disable the rest.</p>
        <div className="profile-create"><input className="compact-input" value={profileName} onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveProfile(); }} placeholder="Profile name" maxLength={60} /><button className="secondary-button" onClick={saveProfile} disabled={!profileName.trim()}><Save size={13}/> Save current mods</button></div>
        <div className="profile-list">{profiles.map((profile) => <div className={"profile-row " + (tofu.activeProfileId === profile.id ? "active" : "")} key={profile.id}><span><strong>{profile.name}</strong><small>{profile.files.length} mod{profile.files.length === 1 ? "" : "s"} enabled{tofu.activeProfileId === profile.id ? " · Active" : ""}</small></span><button className="secondary-button" disabled={busy} onClick={() => void applyProfile(profile)}>Apply</button><button className="secondary-button" onClick={() => updateProfile(profile)} title="Replace with the currently enabled mods">Update</button><button className="icon-button" aria-label="Delete profile" onClick={() => deleteProfile(profile)}><Trash2 size={14}/></button></div>)}{!profiles.length && <p className="muted">No profiles yet.</p>}</div>
      </>}
    </div> : <div className="profile-panel">
      {!tofu.path ? <p className="muted">Choose a Tofu folder to check for updates.</p> : <>
        <p className="muted">Mochi identifies installed files on Modrinth by their hash and looks for newer versions that match the game version and loader above.</p>
        <div className="modrinth-controls"><input className="compact-input" value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} placeholder="Game version" /><Select className="compact-select" value={loader} onChange={setLoader} options={loaderOptions} label="Loader" searchable={false} /><button className="secondary-button" onClick={() => void checkUpdates()} disabled={busy}>{busy ? <RefreshCw size={14} className="spin"/> : <RefreshCw size={14}/>} Check for updates</button>{updatable.length > 1 && <button className="secondary-button" onClick={() => void applyAllUpdates()} disabled={busy}><Download size={13}/> Update all</button>}</div>
        {analysis && <div className="profile-list">{analysis.map((item) => <div className="profile-row" key={item.path}>{item.iconUrl ? <RemoteImage className="update-icon" src={item.iconUrl} alt="" /> : <span className="update-icon fallback"><PackageOpen size={15}/></span>}<span><strong>{item.title}</strong><small>{item.currentVersion}{item.update ? ` → ${item.update.versionNumber}` : " · up to date"}{item.enabled ? "" : " · disabled"}</small></span>{item.update && <button className="secondary-button" disabled={busy} onClick={() => void applyUpdate(item)}><Download size={13}/> Update</button>}</div>)}{!analysis.length && <p className="muted">None of the installed files were recognised on Modrinth.</p>}</div>}
      </>}
    </div>}
  </section>;
}
