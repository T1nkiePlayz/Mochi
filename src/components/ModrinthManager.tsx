import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, RefreshCw, Search, Trash2, Power, PackageOpen } from "lucide-react";
import { deleteModFile, startModrinthDownload, getModrinthVersions, listInstalledMods, searchModrinth, setModFileEnabled, type ModrinthProject, type ModrinthProjectType, type InstalledModrinthFile } from "../lib/modrinth";
import type { Tofu } from "../models";

type Props = { tofu: Tofu; onPathChange: (path: string) => void };
const tabs: Array<{ id: ModrinthProjectType | "worlds" | "logs" | "settings"; label: string }> = [
  { id: "mod", label: "Mods" }, { id: "resourcepack", label: "Resource Packs" }, { id: "shader", label: "Shaders" },
  { id: "worlds", label: "Worlds" }, { id: "logs", label: "Logs" }, { id: "settings", label: "Settings" },
];

export function ModrinthManager({ tofu, onPathChange }: Props) {
  const [tab, setTab] = useState<ModrinthProjectType | "worlds" | "logs" | "settings">("mod");
  const [query, setQuery] = useState(""); const [results, setResults] = useState<ModrinthProject[]>([]);
  const [installed, setInstalled] = useState<InstalledModrinthFile[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version); const [loader, setLoader] = useState("");

  const refreshInstalled = async () => {
    if (!tofu.path) return setInstalled([]);
    try { setInstalled(await listInstalledMods(tofu.path)); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void refreshInstalled(); }, [tofu.path]);

  const search = async () => {
    if (!query.trim()) return; setBusy(true); setMessage("");
    try { setResults(await searchModrinth(query, tab === "mod" || tab === "resourcepack" || tab === "shader" ? tab : "mod")); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to search Modrinth."); } finally { setBusy(false); }
  };

  const install = async (project: ModrinthProject) => {
    if (!tofu.path) return setMessage("Choose a Tofu folder first.");
    setBusy(true); setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, gameVersion || undefined, loader || undefined);
      const version = versions.find(v => v.files.length > 0);
      const file = version?.files.find(f => f.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, tofu.path, tofu.id, tofu.name, project.title, file.filename);
      setMessage("Queued " + project.title + " " + version.version_number + " for download.");

    } catch (e) { setMessage(e instanceof Error ? e.message : "Installation failed."); } finally { setBusy(false); }
  };

  const chooseFolder = async () => { const selected = await open({ directory: true, multiple: false, title: "Choose Tofu folder" }); if (typeof selected === "string") onPathChange(selected); };

  return <section className="modrinth-manager">
    <div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace</p><h3>{tofu.name}</h3><p className="workspace-path">{tofu.path || "Choose a folder to enable content management."}</p></div><button className="secondary-button" onClick={chooseFolder}><FolderOpen size={14}/> {tofu.path ? "Change folder" : "Choose folder"}</button></div>
    <div className="workspace-tabs">{tabs.map(item => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "mod" || tab === "resourcepack" || tab === "shader" ? <>
      <div className="modrinth-controls"><label className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void search(); }} placeholder={"Search Modrinth " + (tab === "mod" ? "mods" : tab === "resourcepack" ? "resource packs" : "shaders") + "..."} /><kbd>Enter</kbd></label><input className="compact-input" value={gameVersion} onChange={e => setGameVersion(e.target.value)} placeholder="Game version" />{tab === "mod" && <select className="compact-input" value={loader} onChange={e => setLoader(e.target.value)}><option value="">Any loader</option><option>fabric</option><option>forge</option><option>neoforge</option><option>quilt</option></select>}<button className="secondary-button" onClick={() => void search()} disabled={busy}>{busy ? <RefreshCw size={14} className="spin"/> : <Search size={14}/>} Search</button></div>
      {message && <p className="metadata-note">{message}</p>}
      <div className="content-split"><div><div className="workspace-section-title"><strong>Installed</strong><span>{installed.length}</span></div><div className="installed-content-list">{installed.map(file => <div className="installed-content-row" key={file.path}><span><strong>{file.filename}</strong><small>{Math.round(file.size / 1024)} KB</small></span><button title={file.enabled ? "Disable" : "Enable"} onClick={() => void setModFileEnabled(file.path, !file.enabled).then(refreshInstalled).catch((e) => setMessage(e instanceof Error ? e.message : String(e)))}><Power size={14}/></button><button title="Delete" onClick={() => { if (window.confirm("Delete " + file.filename + "? This cannot be undone.")) void deleteModFile(file.path).then(refreshInstalled).catch((e) => setMessage(e instanceof Error ? e.message : String(e))); }}><Trash2 size={14}/></button></div>)}{!installed.length && <p className="muted">No content installed in this Tofu yet.</p>}</div></div>
      <div><div className="workspace-section-title"><strong>Discover on Modrinth</strong><span>{results.length} results</span></div><div className="modrinth-results">{results.map(project => <article className="modrinth-result" key={project.project_id}>{project.icon_url ? <img src={project.icon_url} alt="" /> : <div className="modrinth-result-icon"><PackageOpen size={17}/></div>}<div><strong>{project.title}</strong><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p></div><button className="secondary-button" onClick={() => void install(project)} disabled={busy || !tofu.path}><Download size={13}/> Install</button></article>)}</div></div></div>
    </> : <div className="workspace-placeholder"><PackageOpen size={24}/><strong>{tabs.find(x => x.id === tab)?.label}</strong><span>{tab === "settings" ? "Tofu-specific configuration will be connected to the Minecraft runtime." : "This tab is reserved for native Tofu content once the Minecraft runtime is connected."}</span></div>}
  </section>;
}
