import { useEffect, useState } from "react";
import { Download, PackageOpen, RefreshCw, Search } from "lucide-react";
import {
  getModrinthVersions,
  getPopularModrinth,
  startModrinthDownload,
  type ModrinthProject,
  type ModrinthProjectType,
} from "../lib/modrinth";
import type { Tofu } from "../models";

type Props = { tofu: Tofu };

const sections: Array<{ type: ModrinthProjectType; title: string; description: string }> = [
  { type: "mod", title: "Most Popular Mods", description: "The most downloaded mods on Modrinth right now." },
  { type: "modpack", title: "Most Popular Modpacks", description: "Popular curated packs ready to add to a Tofu." },
  { type: "resourcepack", title: "Most Popular Resource Packs", description: "Popular resource packs, sorted by Modrinth downloads." },
  { type: "shader", title: "Most Popular Shaders", description: "Popular shaders, sorted by Modrinth downloads." },
];

function projectTypeLabel(type: ModrinthProjectType) {
  return type === "resourcepack" ? "Resource Pack" : type.charAt(0).toUpperCase() + type.slice(1);
}

export function ModrinthDiscover({ tofu }: Props) {
  const [projects, setProjects] = useState<Record<ModrinthProjectType, ModrinthProject[]>>({
    mod: [], modpack: [], resourcepack: [], shader: [],
  });
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version);
  const [loader, setLoader] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      const values = await Promise.all(sections.map(async ({ type }) => [type, await getPopularModrinth(type, gameVersion)] as const));
      setProjects(Object.fromEntries(values) as Record<ModrinthProjectType, ModrinthProject[]>);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load popular Modrinth projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setGameVersion(tofu.version === "Local" ? "" : tofu.version);
  }, [tofu.version]);

  useEffect(() => { void refresh(); }, [gameVersion]);

  const install = async (project: ModrinthProject) => {
    if (!tofu.path) {
      setMessage("Choose a Tofu folder first from Installed.");
      return;
    }
    setBusyId(project.project_id);
    setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, gameVersion || undefined, project.project_type === "mod" ? loader || undefined : undefined);
      const version = versions.find(item => item.files.length > 0);
      const file = version?.files.find(item => item.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, tofu.path, tofu.id, tofu.name, project.title, file.filename);
      setMessage("Queued " + project.title + " for download.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue this download.");
    } finally {
      setBusyId("");
    }
  };

  const matches = (project: ModrinthProject) => {
    const value = query.trim().toLowerCase();
    return !value || project.title.toLowerCase().includes(value) || project.description.toLowerCase().includes(value);
  };

  return <section className="modrinth-discover">
    <div className="discover-header">
      <div>
        <p className="eyebrow">Modrinth</p>
        <h2>Discover</h2>
        <p>Browse the most popular mods, modpacks, resource packs, and shaders directly from Modrinth.</p>
      </div>
      <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
        {loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
      </button>
    </div>

    <div className="discover-controls">
      <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter popular content..." /></label>
      <input className="compact-input" value={gameVersion} onChange={event => setGameVersion(event.target.value)} placeholder="Minecraft version" />
      <select className="compact-input" value={loader} onChange={event => setLoader(event.target.value)}>
        <option value="">Any loader</option>
        <option value="fabric">Fabric</option>
        <option value="forge">Forge</option>
        <option value="neoforge">NeoForge</option>
        <option value="quilt">Quilt</option>
      </select>
    </div>

    {message && <p className="metadata-note">{message}</p>}

    {loading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading popular projects from Modrinth...</span></div> : (
      <div className="discover-sections">
        {sections.map(section => {
          const visible = projects[section.type].filter(matches);
          return <section className="discover-section" key={section.type}>
            <div className="discover-section-heading">
              <div><h3>{section.title}</h3><p>{section.description}</p></div>
              <span>{visible.length} projects</span>
            </div>
            <div className="discover-grid">
              {visible.map((project, index) => <article className="discover-card" key={project.project_id}>
                {project.icon_url ? <img src={project.icon_url} alt="" className="discover-card-icon" /> : <div className="discover-card-icon fallback"><PackageOpen size={20} /></div>}
                <div className="discover-card-copy">
                  <div className="discover-card-title"><strong>{index + 1}. {project.title}</strong><span>{projectTypeLabel(project.project_type)}</span></div>
                  <small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small>
                  <p>{project.description}</p>
                  <button className="secondary-button" onClick={() => void install(project)} disabled={busyId !== "" || !tofu.path}>
                    {busyId === project.project_id ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}
                    {tofu.path ? "Download" : "Choose Tofu first"}
                  </button>
                </div>
              </article>)}
            </div>
            {!visible.length && <div className="discover-empty">No popular {section.type} projects match this filter.</div>}
          </section>;
        })}
      </div>
    )}
  </section>;
}
