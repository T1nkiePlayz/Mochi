import { useEffect, useState } from "react";
import { Download, Eye, PackageOpen, Plus, RefreshCw, Search, X } from "lucide-react";
import {
  getModrinthProject,
  getModrinthVersions,
  getPopularModrinth,
  startModrinthDownload,
  type ModrinthProject,
  type ModrinthProjectDetails,
  type ModrinthProjectType,
} from "../lib/modrinth";
import type { Piko, Tofu } from "../models";

type Props = { tofu: Tofu; pikos: Piko[] };

const sections: Array<{ type: ModrinthProjectType; title: string; description: string }> = [
  { type: "mod", title: "Most Popular Mods", description: "The most downloaded mods on Modrinth right now." },
  { type: "modpack", title: "Most Popular Modpacks", description: "Popular curated packs ready to add to a Tofu." },
  { type: "resourcepack", title: "Most Popular Resource Packs", description: "Popular resource packs, sorted by Modrinth downloads." },
  { type: "shader", title: "Most Popular Shaders", description: "Popular shaders, sorted by Modrinth downloads." },
];

function projectTypeLabel(type: ModrinthProjectType) {
  return type === "resourcepack" ? "Resource Pack" : type.charAt(0).toUpperCase() + type.slice(1);
}

export function ModrinthDiscover({ tofu, pikos }: Props) {
  const [projects, setProjects] = useState<Record<ModrinthProjectType, ModrinthProject[]>>({ mod: [], modpack: [], resourcepack: [], shader: [] });
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version);
  const [loader, setLoader] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [tofuPicker, setTofuPicker] = useState<ModrinthProject | null>(null);

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      const values = await Promise.all(sections.map(async ({ type }) => [type, await getPopularModrinth(type, gameVersion)] as const));
      setProjects(Object.fromEntries(values) as Record<ModrinthProjectType, ModrinthProject[]>);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load popular Modrinth projects.");
    } finally { setLoading(false); }
  };

  useEffect(() => { setGameVersion(tofu.version === "Local" ? "" : tofu.version); }, [tofu.version]);
  useEffect(() => { void refresh(); }, [gameVersion]);

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

  return <>
    <section className="modrinth-discover">
      <div className="discover-header"><div><p className="eyebrow">Modrinth</p><h2>Discover</h2><p>Browse the most popular mods, modpacks, resource packs, and shaders directly from Modrinth.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}>{loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button></div>
      <div className="discover-controls"><label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter popular content..." /></label><input className="compact-input" value={gameVersion} onChange={event => setGameVersion(event.target.value)} placeholder="Minecraft version" /><select className="compact-input" value={loader} onChange={event => setLoader(event.target.value)}><option value="">Any loader</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></div>
      {message && <p className="metadata-note">{message}</p>}
      {loading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading popular projects from Modrinth...</span></div> : <div className="discover-sections">{sections.map(section => {
        const visible = projects[section.type].filter(matches);
        return <section className="discover-section" key={section.type}><div className="discover-section-heading"><div><h3>{section.title}</h3><p>{section.description}</p></div><span>{visible.length} projects</span></div><div className="discover-grid">{visible.map((project,index) => <article className="discover-card" key={project.project_id}>{project.icon_url ? <img src={project.icon_url} alt="" className="discover-card-icon" /> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}<div className="discover-card-copy"><div className="discover-card-title"><strong>{index+1}. {project.title}</strong><span>{projectTypeLabel(project.project_type)}</span></div><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p><div className="discover-card-actions"><button className="secondary-button" onClick={() => void openDetails(project)}><Eye size={13}/> View</button><button className="secondary-button" onClick={() => setTofuPicker(project)} disabled={busyId !== ""}><Download size={13}/> Choose Tofu instance</button></div></div></article>)}</div>{!visible.length&&<div className="discover-empty">No popular {section.type} projects match this filter.</div>}</section>;
      })}</div>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={gameVersion} onClose={() => setDetails(null)} />}
    {tofuPicker && <TofuPicker project={tofuPicker} pikos={pikos} onClose={() => setTofuPicker(null)} onInstall={(target) => { setTofuPicker(null); void install(tofuPicker, target); }} />}
  </>;

  async function openDetails(project: ModrinthProject) {
    setMessage("");
    try { setDetails(await getModrinthProject(project.project_id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  }
}

function ProjectDetails({ project, gameVersion, onClose }: { project: ModrinthProjectDetails; gameVersion: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<import("../lib/modrinth").ModrinthVersion[]>([]);
  useEffect(() => { void getModrinthVersions(project.project_id, gameVersion || undefined).then(setVersions).catch(() => setVersions([])); }, [project.project_id, gameVersion]);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window" onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{project.icon_url ? <img src={project.icon_url} alt="" /> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{projectTypeLabel(project.project_type)}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{project.author || "Unknown creator"}</strong> · {project.downloads.toLocaleString()} downloads</small></div></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <div className="project-tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="versions"?"active":""} onClick={()=>setTab("versions")}>Versions</button></div>
    {tab==="overview" ? <div className="project-overview"><h3>Overview</h3>{project.body ? <div className="project-markdown">{project.body}</div> : <p>{project.description}</p>}<div className="project-info-grid"><span><strong>Creator</strong>{project.author||"Unknown"}</span><span><strong>Project type</strong>{projectTypeLabel(project.project_type)}</span><span><strong>Downloads</strong>{project.downloads.toLocaleString()}</span><span><strong>Followers</strong>{(project.followers||0).toLocaleString()}</span><span><strong>Categories</strong>{project.categories?.join(", ")||"Not provided"}</span><span><strong>License</strong>{project.license?.name||"Not provided"}</span></div></div> : <div className="project-version-list">{versions.length ? versions.map(version=><div className="project-version" key={version.id}><div><strong>{version.name || version.version_number}</strong><small>{version.version_number} · {version.game_versions.join(", ")} · {version.loaders.join(", ")}</small></div><span>{version.files.length} file{version.files.length===1?"":"s"}</span></div>) : <div className="discover-empty">No versions found for this Minecraft version.</div>}</div>}
  </div></div>;
}

function TofuPicker({ project, pikos, onClose, onInstall }: { project: ModrinthProject; pikos: Piko[]; onClose: () => void; onInstall: (tofu: Tofu) => void }) {
  const tofus = pikos.flatMap(piko => piko.tofus || []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Install {project.title}</p><h2>Choose Tofu instance</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p className="modal-description">Choose the Minecraft instance that should receive this download.</p>{tofus.length ? <div className="tofu-picker-list">{tofus.map(tofu=><div className="tofu-picker-row" key={tofu.id}><div><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No install location"}</small></div><button className="secondary-button" title={"Download to " + tofu.name} disabled={!tofu.path} onClick={()=>onInstall(tofu)}><Plus size={15}/></button></div>)}</div> : <div className="discover-empty">No Minecraft instances were found.</div>}</div></div>;
}
