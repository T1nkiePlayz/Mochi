import { useEffect, useState, type ReactNode } from "react";
import minecraftLogo from "../assets/minecraft-core-brand.svg";
import { Download, Eye, PackageOpen, Plus, RefreshCw, Search, X } from "lucide-react";
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

type Props = { tofu: Tofu; pikos: Piko[] };

const sections: Array<{ type: ModrinthProjectType; title: string; description: string }> = [
  { type: "mod", title: "Most Popular Mods", description: "The most downloaded mods on Modrinth right now." },
  { type: "modpack", title: "Most Popular Modpacks", description: "Popular curated packs ready to add to a Tofu." },
  { type: "resourcepack", title: "Most Popular Resource Packs", description: "Popular resource packs, sorted by Modrinth downloads." },
  { type: "shader", title: "Most Popular Shaders", description: "Popular shaders, sorted by Modrinth downloads." },
];

type DiscoveryTab = "instances" | ModrinthProjectType;

const discoveryTabs: Array<{ id: DiscoveryTab; label: string }> = [
  { id: "instances", label: "Instances" },
  { id: "mod", label: "Mods" },
  { id: "modpack", label: "Modpacks" },
  { id: "resourcepack", label: "Resource Packs" },
  { id: "shader", label: "Shaders" },
];

function MinecraftMark({ size = 20 }: { size?: number }) {
  return <svg className="minecraft-discovery-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path fill="currentColor" d="M2 4 6 2h8l4 2v12l-4 2H6l-4-2V4Z"/>
    <path fill="#5f8f35" d="M2 4 6 2h8l4 2-4 2H6L2 4Z"/>
    <path fill="#6b4f2a" d="M2 5.1 6 7h8l4-2v11l-4 2H6l-4-2V5.1Z"/>
    <path fill="#7aa34a" d="M6 7h8v4H6z"/>
    <path fill="#4e3a20" d="M4 9h2v2H4zm10 2h2v2h-2zM8 13h2v2H8z"/>
  </svg>;
}

function projectTypeLabel(type: ModrinthProjectType) {
  return type === "resourcepack" ? "Resource Pack" : type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MiB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GiB";
}


function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeMarkdown(source: string): string {
  return decodeHtmlEntities(
    source
      .replace(/\r/g, "")
      .replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (_match, before, src, after) => {
        const attributes = before + after;
        const alt = attributes.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
        return "\n![" + alt + "](" + src + ")\n";
      })
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => "\n" + "#".repeat(Number(level)) + " " + body + "\n")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1\n")
      .replace(/<\/?(?:ul|ol|p|div|section|article|center|figure|figcaption)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\!\[[^\]]*\]\([^\)]+\)|\[[^\]]+\]\([^\)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\x60[^\x60]+\x60|\*[^*]+\*|_[^_]+_)/g);
  return parts.filter(Boolean).map((part, index) => {
    const image = part.match(/^!\[([^\]]*)\]\(([^\)]+)\)$/);
    if (image) return <img key={index} className="project-markdown-image" src={image[2]} alt={image[1]} loading="lazy" />;
    const link = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith(String.fromCharCode(96)) && part.endsWith(String.fromCharCode(96))) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={index}>{part.slice(1, -1)}</em>;
    return <span key={index}>{part}</span>;
  });
}

function Markdown({ source }: { source: string }) {
  const lines = normalizeMarkdown(source).split(/\n/);
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let paragraphLines: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    nodes.push(<p key={"paragraph-" + nodes.length}>{renderInline(paragraphLines.join(" "))}</p>);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length) {
      nodes.push(<ul key={"unordered-" + nodes.length}>{listItems.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>);
      listItems = [];
    }
    if (orderedItems.length) {
      nodes.push(<ol key={"ordered-" + nodes.length}>{orderedItems.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ol>);
      orderedItems = [];
    }
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    nodes.push(<pre key={"code-" + nodes.length}><code>{codeLines.join("\n")}</code></pre>);
    codeLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(String.fromCharCode(96).repeat(3))) {
      flushParagraph();
      flushList();
      if (inCodeBlock) flushCode();
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (unordered) {
      flushParagraph();
      orderedItems = [];
      listItems.push(unordered[1]);
      return;
    }
    if (ordered) {
      flushParagraph();
      listItems = [];
      orderedItems.push(ordered[1]);
      return;
    }

    flushList();
    const heading = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      const Heading = ("h" + Math.min(heading[1].length + 1, 6)) as keyof JSX.IntrinsicElements;
      nodes.push(<Heading key={"heading-" + index}>{renderInline(heading[2])}</Heading>);
      return;
    }
    if (/^>\s?/.test(trimmed)) {
      nodes.push(<blockquote key={"quote-" + index}>{renderInline(trimmed.replace(/^>\s?/, ""))}</blockquote>);
      return;
    }
    if (/^---+$/.test(trimmed)) {
      nodes.push(<hr key={"rule-" + index} />);
      return;
    }
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushList();
  if (inCodeBlock) flushCode();
  return <div className="project-markdown">{nodes}</div>;
}

function getPrimaryCreator(project: ModrinthProjectDetails) {
  const member = project.members?.find(item => item.accepted !== false) ?? project.members?.[0];
  return {
    name: project.author || member?.user.name || member?.user.username || "",
    avatar: member?.user.avatar_url || "",
  };
}

function MinecraftLogo() {
  return <img
    className="minecraft-discovery-logo"
    src={minecraftLogo}
    alt="Minecraft"
    draggable={false}
  />;
}

export function ModrinthDiscover({ tofu, pikos }: Props) {
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
  const [tab, setTab] = useState<DiscoveryTab>("mod");
  const [activeTofuId, setActiveTofuId] = useState(tofu.id);

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

  useEffect(() => { void getModrinthGameVersions().then(versions => { setGameVersions(versions); if (tofu.version !== "Local" && versions.includes(tofu.version)) setGameVersion(tofu.version); }).catch(() => setGameVersions(tofu.version === "Local" ? [] : [tofu.version])); }, [tofu.version]);
  useEffect(() => { void refresh(); }, [gameVersion]);
  useEffect(() => { setActiveTofuId(tofu.id); }, [tofu.id]);

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
      <div className="discover-header"><div><p className="eyebrow">Discovery</p><h2>Discover Minecraft</h2><p>Browse Minecraft instances and popular community content in one place. More games can be added here later.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading || tab === "instances"}>{loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button></div>
      <div className="discover-platform-tabs" role="tablist" aria-label="Game discovery">
        <button className="discover-platform-tab active" type="button" role="tab" aria-selected="true"><MinecraftLogo /></button>
      </div>
      <div className="discover-tabs" role="tablist" aria-label="Minecraft discovery categories">
        {discoveryTabs.map(item => <button key={item.id} className={tab === item.id ? "active" : ""} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      <div className="discover-controls">{tab !== "instances" && <><label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + (sections.find(section => section.type === tab)?.title || "content").toLowerCase() + "..."} /></label><label className="discover-select-wrap"><span>Minecraft</span><select className="discover-select" value={gameVersion} onChange={event => setGameVersion(event.target.value)}><option value="">All versions</option>{gameVersions.map(version => <option key={version} value={version}>{version}</option>)}</select></label>{tab === "mod" && <label className="discover-select-wrap"><span>Loader</span><select className="discover-select" value={loader} onChange={event => setLoader(event.target.value)}><option value="">Any loader</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label>}</>}</div>
      {message && <p className="metadata-note">{message}</p>}
      {tab === "instances" ? (
        <section className="discover-instances">
          <div className="discover-section-heading"><div><h3>Minecraft Instances</h3><p>Your Tofu instances are available here as discovery targets.</p></div><span>{pikos.flatMap(piko => piko.tofus || []).length} instance{pikos.flatMap(piko => piko.tofus || []).length === 1 ? "" : "s"}</span></div>
          {(() => {
            const instances = pikos.flatMap(piko => (piko.tofus || []).map(instance => ({ ...instance, pikoName: piko.name })));
            const activeInstance = instances.find(instance => instance.id === activeTofuId) || instances.find(instance => instance.id === tofu.id) || instances[0] || null;
            return instances.length ? <div className="discover-instance-grid">{instances.map(instance => <article className={`discover-instance-card ${activeInstance?.id === instance.id ? "selected" : ""}`} key={instance.id}>
              <div className="discover-instance-card-top"><MinecraftMark size={26} /><div><strong>{instance.name}</strong><small>{instance.pikoName} · {instance.version} · {instance.runtime}</small></div>{activeInstance?.id === instance.id && <span>Selected</span>}</div>
              <div className="discover-instance-stats"><span><strong>Mods</strong>{instance.mods}</span><span><strong>Status</strong>{instance.status}</span><span><strong>Location</strong>{instance.path ? "Configured" : "Not configured"}</span></div>
              <button className="secondary-button" type="button" onClick={() => { setActiveTofuId(instance.id); setGameVersion(instance.version === "Local" ? "" : instance.version); setLoader(""); setTab("mod"); }}>{activeInstance?.id === instance.id ? "Browse content" : "Use instance"}</button>
            </article>)}</div> : <div className="discover-empty">No Minecraft instances are configured yet. Add a Tofu instance from your Library to start discovering content.</div>;
          })()}
        </section>
      ) : loading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading popular content from Modrinth...</span></div> : (() => {
        const contentType = tab;
        const section = sections.find(item => item.type === contentType)!;
        const visible = projects[contentType].filter(matches);
        return <div className="discover-sections"><section className="discover-section">
          <div className="discover-section-heading"><div><h3>{section.title}</h3><p>{section.description}</p></div><span>{visible.length} projects</span></div>
          <div className="discover-grid">{visible.map((project,index) => <article className="discover-card" key={project.project_id}>{project.icon_url ? <img src={project.icon_url} alt="" className="discover-card-icon" /> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}<div className="discover-card-copy"><div className="discover-card-title"><strong>{index+1}. {project.title}</strong><span>{projectTypeLabel(project.project_type)}</span></div><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p><div className="discover-card-actions"><button className="secondary-button" onClick={() => void openDetails(project)}><Eye size={13}/> View</button><button className="secondary-button" onClick={() => setTofuPicker(project)} disabled={busyId !== ""}><Download size={13}/> Choose Tofu instance</button></div></div></article>)}</div>
          {!visible.length && <div className="discover-empty">No popular {projectTypeLabel(contentType)} projects match this filter.</div>}
        </section></div>;
      })()}
    </section>
    {details && <ProjectDetails project={details} gameVersion={gameVersion} onClose={() => setDetails(null)} />}
    {tofuPicker && <TofuPicker project={tofuPicker} pikos={pikos} onClose={() => setTofuPicker(null)} onInstall={(target) => { setTofuPicker(null); void install(tofuPicker, target); }} />}
  </>;

  async function openDetails(project: ModrinthProject) {
    setMessage("");
    try {
      const detail = await getModrinthProject(project.project_id);
      setDetails({ ...project, ...detail, author: project.author || detail.author });
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  }
}

function ProjectDetails({ project, gameVersion, onClose }: { project: ModrinthProjectDetails; gameVersion: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<import("../lib/modrinth").ModrinthVersion[]>([]);
  useEffect(() => { void getModrinthVersions(project.project_id).then(setVersions).catch(() => setVersions([])); }, [project.project_id]);

  return (
    <div className="discover-modal-backdrop" onMouseDown={onClose}>
      <div className="project-details-window" onMouseDown={event => event.stopPropagation()}>
        <div className="project-details-header">
          <div>
            {project.icon_url ? <img src={project.icon_url} alt="" /> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}
            <div><p className="eyebrow">{projectTypeLabel(project.project_type)}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{getPrimaryCreator(project).name || "Unknown creator"}</strong> · {project.downloads.toLocaleString()} downloads</small></div>
          </div>
          <button className="icon-button" onClick={onClose}><X size={17}/></button>
        </div>
        <div className="project-tabs">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>Versions</button>
        </div>
        {tab === "overview" ? (
          <div className="project-overview">
            <section className="project-creator-primary">
              <div className="project-creator-primary-avatar">
                {getPrimaryCreator(project).avatar
                  ? <img src={getPrimaryCreator(project).avatar} alt="" />
                  : <div className="project-creator-primary-fallback">{(getPrimaryCreator(project).name || "?").slice(0, 1).toUpperCase()}</div>}
              </div>
              <div><span>Created by</span><strong>{getPrimaryCreator(project).name || "Unknown creator"}</strong></div>
            </section>
            <div className="project-info-grid">
              <span><strong>Downloads</strong>{project.downloads.toLocaleString()}</span>
              <span><strong>Followers</strong>{(project.followers || 0).toLocaleString()}</span>
              <span><strong>Project type</strong>{projectTypeLabel(project.project_type)}</span>
              <span><strong>Categories</strong>{project.categories?.join(", ") || "Not provided"}</span>
              <span><strong>License</strong>{project.license?.name || "Not provided"}</span>
              <span><strong>Members</strong>{project.members?.length ?? 0}</span>
            </div>
            <h3 className="project-overview-heading">Overview</h3>
            <Markdown source={project.body || project.description} />
            {project.members?.length ? (
              <section className="project-creators">
                <div className="project-creators-heading"><div><h3>Creators & contributors</h3><p>{project.members.length} team member{project.members.length === 1 ? "" : "s"} credited on Modrinth.</p></div></div>
                <div className="project-creator-grid">{project.members.map(member => <div className="project-creator" key={member.user.id}><img src={member.user.avatar_url} alt="" /><div><strong>{member.user.name || member.user.username}</strong><small>@{member.user.username} · {member.role}</small></div></div>)}</div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="project-version-list">
            {versions.length ? versions.map(version => (
              <article className="project-version" key={version.id}>
                <div className="project-version-main">
                  <div className="project-version-heading"><strong>{version.name || version.version_number}</strong><span>{version.version_number}</span></div>
                  <div className="project-version-meta"><span>{version.version_type || "release"}</span><span>Published {formatDate(version.date_published)}</span><span>{version.files.length} file{version.files.length === 1 ? "" : "s"}</span></div>
                  <div className="project-version-targets"><span>{version.game_versions.join(", ") || "Unknown Minecraft version"}</span><span>{version.loaders.join(", ") || "Any loader"}</span></div>
                  {version.changelog ? <details className="project-version-changelog"><summary>View changelog</summary><div className="project-version-changelog-body"><Markdown source={version.changelog} /></div></details> : null}
                </div>
                <details className="project-version-files"><summary>Files <span>{version.files.length}</span></summary><div className="project-file-list">{version.files.map(file => <div key={file.filename}><span>{file.filename}</span><small>{formatBytes(file.size)}{file.primary ? " · Primary" : ""}</small></div>)}</div></details>
              </article>
            )) : <div className="discover-empty">No versions found for this Minecraft version.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function TofuPicker({ project, pikos, onClose, onInstall }: { project: ModrinthProject; pikos: Piko[]; onClose: () => void; onInstall: (tofu: Tofu) => void }) {
  const tofus = pikos.flatMap(piko => piko.tofus || []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Install {project.title}</p><h2>Choose Tofu instance</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p className="modal-description">Choose the Minecraft instance that should receive this download.</p>{tofus.length ? <div className="tofu-picker-list">{tofus.map(tofu=><div className="tofu-picker-row" key={tofu.id}><div><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No install location"}</small></div><button className="secondary-button" title={"Download to " + tofu.name} disabled={!tofu.path} onClick={()=>onInstall(tofu)}><Plus size={15}/></button></div>)}</div> : <div className="discover-empty">No Minecraft instances were found.</div>}</div></div>;
}
