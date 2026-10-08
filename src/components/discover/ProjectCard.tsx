import { memo } from "react";
import { Download, Eye, PackageOpen } from "lucide-react";
import type { ModrinthProject } from "../../lib/modrinth";
import { DiscoveryImage } from "./DiscoveryImage";
import { projectTypeLabel } from "./utils";

type Props = {
  project: ModrinthProject;
  index?: number;
  badge?: string;
  chooseLabel?: string;
  busy?: boolean;
  onView: (project: ModrinthProject) => void;
  onChoose: (project: ModrinthProject) => void;
};

/** One Modrinth result. `content-visibility` (see features/discover.css) keeps long lists cheap. */
export const ProjectCard = memo(function ProjectCard({ project, index, badge, chooseLabel = "Choose Tofu", busy, onView, onChoose }: Props) {
  return <article className="discover-card">
    {project.icon_url ? <DiscoveryImage src={project.icon_url} className="discover-card-icon" alt="" label={project.title} /> : <div className="discover-card-icon fallback"><PackageOpen size={20} /></div>}
    <div className="discover-card-copy">
      <div className="discover-card-title"><strong>{index === undefined ? "" : `${index + 1}. `}{project.title}</strong><span>{badge ?? projectTypeLabel(project.project_type)}</span></div>
      <small>{project.author || "Modrinth creator"} · {(project.downloads ?? 0).toLocaleString()} downloads</small>
      <p>{project.description}</p>
      <div className="discover-card-actions">
        <button type="button" className="secondary-button" onClick={() => onView(project)}><Eye size={13} /> View</button>
        <button type="button" className="secondary-button" onClick={() => onChoose(project)} disabled={busy}><Download size={13} /> {chooseLabel}</button>
      </div>
    </div>
  </article>;
});

export function ProjectSkeletons({ count = 6 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="discover-card discover-card-skeleton" key={index} aria-hidden="true">
    <div className="discover-card-icon" /><div className="discover-card-copy"><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>
  </div>)}</>;
}
