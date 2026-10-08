import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ExternalLink, PackageOpen, X } from "lucide-react";
import { getModrinthVersions, type ModrinthProjectDetails, type ModrinthVersion } from "../../lib/modrinth";
import { formatBytes } from "../../lib/format";
import { DiscoveryImage } from "./DiscoveryImage";
import { Markdown } from "./Markdown";
import { formatDate, getPrimaryCreator, projectTypeLabel } from "./utils";

export function ProjectDetails({ project, gameVersion, onClose }: { project: ModrinthProjectDetails; gameVersion: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  useEffect(() => { void getModrinthVersions(project.project_id, gameVersion || undefined).then(setVersions).catch(() => setVersions([])); }, [project.project_id, gameVersion]);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window" onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{project.icon_url ? <DiscoveryImage src={project.icon_url} alt="" className="discover-card-icon" label={project.title}/> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{projectTypeLabel(project.project_type)}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{getPrimaryCreator(project).name || "Unknown creator"}</strong> · {project.downloads.toLocaleString()} downloads</small></div></div><div className="project-details-header-actions"><button type="button" className="secondary-button" onClick={() => { const url = `https://modrinth.com/${project.project_type}/${project.slug}`; void invoke("open_external_url", { url }); }}><ExternalLink size={13}/> View on Modrinth</button><button className="icon-button" onClick={onClose} aria-label="Close project details"><X size={17}/></button></div></div>
    <div className="project-tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="versions"?"active":""} onClick={()=>setTab("versions")}>Versions</button></div>
    {tab==="overview" ? <div className="project-overview">
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

