import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, ExternalLink, PackageOpen, RefreshCw, X } from "lucide-react";
import { getModrinthVersions, type ModrinthProjectDetails, type ModrinthVersion } from "../../lib/modrinth";
import { formatBytes } from "../../lib/format";
import { openExternalUrl } from "../../lib/platform";
import { loaderLabels, parseLoader, tofuTarget, translateCompatibilityReason } from "../../lib/mods/compat";
import { modrinthFile } from "../../lib/mods/modrinthSource";
import { collapseList, filterVersions, listGameVersions, listLoaders, versionFit } from "../../lib/mods/versionList";
import type { ModFile } from "../../lib/mods/types";
import type { Tofu } from "../../models";
import { Select } from "../ui/Select";
import { Avatar } from "./Avatar";
import { DiscoveryImage } from "./DiscoveryImage";
import { Markdown } from "./Markdown";
import { formatDate, getPrimaryCreator, projectTypeLabel } from "./utils";
import { Checkbox } from "../ui/Checkbox";
import { useTranslation } from "../../lib/useTranslation";

type Props = {
  project: ModrinthProjectDetails;
  gameVersion: string;
  /** The Tofu selected in the library: versions that fit it are highlighted. */
  tofu?: Tofu;
  onClose: () => void;
  /** One primary action per version: choose a Tofu for that exact file. */
  onDownload: (project: ModrinthProjectDetails, file: ModFile) => void;
};

const PAGE = 25;
const channelLabel = { release: "Release", beta: "Beta", alpha: "Alpha" } as const;


function VersionRow({ version, fit, onDownload }: { version: ModrinthVersion; fit?: { status: "compatible" | "maybe" | "incompatible"; reason?: string }; onDownload: () => void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const channel = version.version_type ?? "release";
  const games = collapseList(version.game_versions, 3);
  const primary = version.files.find((file) => file.primary) ?? version.files[0];
  const loaders = version.loaders.filter((loader) => parseLoader(loader) !== undefined);
  return <div className={`version-row${open ? " open" : ""}`} data-fit={fit?.status}>
    <div className="version-row-main">
      <button type="button" className="version-expand" aria-expanded={open} aria-label={`${open ? t("Hide changelog and files for") : t("Show changelog and files for")} ${version.name || version.version_number}`} onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
      <div className="version-name"><strong title={version.name}>{version.name || version.version_number}</strong><small>{version.version_number}</small></div>
      <span className={`release-badge release-${channel}`}>{t(channelLabel[channel])}</span>
      <div className="version-chips" aria-label="Loaders">{loaders.map((loader) => <span key={loader} className="chip chip-loader">{loaderLabels[parseLoader(loader)!]}</span>)}</div>
      <div className="version-chips" aria-label="Game versions">{games.shown.map((game) => <span key={game} className="chip">{game}</span>)}{games.more > 0 && <span className="chip chip-more" title={version.game_versions.slice(3).join(", ")}>+{games.more}</span>}</div>
      <span className="version-date">{formatDate(version.date_published) === "Unknown date" ? t("Unknown date") : formatDate(version.date_published)}</span>
      <span className="version-size">{primary ? formatBytes(primary.size) : ""}</span>
      <div className="version-action">
        {fit && fit.status !== "compatible" && <span className={`compat-badge compat-${fit.status}`} title={fit.reason ? translateCompatibilityReason(fit.reason, t) : undefined}>{fit.status === "maybe" ? t("May work") : t("Not for your Tofu")}</span>}
        {fit?.status === "compatible" && <span className="compat-badge compat-compatible">{t("Fits your Tofu")}</span>}
        <button type="button" className="secondary-button" onClick={onDownload} disabled={!primary} aria-label={`${t("Download")} ${version.name || version.version_number}`}><Download size={13} /> Download</button>
      </div>
    </div>
    {open && <div className="version-row-detail">
      {version.game_versions.length > 3 && <p><strong>Game versions</strong> {version.game_versions.join(", ")}</p>}
      {version.changelog ? <div className="version-changelog"><Markdown source={version.changelog} /></div> : <p className="muted">No changelog was provided.</p>}
      <div className="project-file-list">{version.files.map((file) => <div key={file.filename}><span>{file.filename}</span><small>{formatBytes(file.size)}{file.primary ? ` · ${t("Primary")}` : ""}</small></div>)}</div>
      {version.dependencies.length > 0 && <p className="muted">{t(version.dependencies.length === 1 ? "1 dependency listed on Modrinth. Mochi offers to install the required ones before the mod." : "{count} dependencies listed on Modrinth. Mochi offers to install the required ones before the mod.").replace("{count}", String(version.dependencies.length))}</p>}
    </div>}
  </div>;
}

export function ProjectDetails({ project, gameVersion, tofu, onClose, onDownload }: Props) {
  const t = useTranslation();
  const channelOptions = [{ value: "", label: t("Any release type") }, { value: "release", label: t("Release") }, { value: "beta", label: t("Beta") }, { value: "alpha", label: t("Alpha") }];
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<ModrinthVersion[] | null>(null);
  const [error, setError] = useState("");
  const [loader, setLoader] = useState("");
  const [game, setGame] = useState(gameVersion);
  const [channel, setChannel] = useState("");
  const [fitOnly, setFitOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const mod = project.project_type === "mod";

  useEffect(() => {
    let live = true;
    setVersions(null); setError("");
    // Everything is fetched once; the filters below narrow it without more requests.
    void getModrinthVersions(project.project_id).then((next) => { if (live) setVersions(next); }).catch(() => { if (live) { setVersions([]); setError(t("Unable to load versions.")); } });
    return () => { live = false; };
  }, [project.project_id, t]);
  useEffect(() => setShown(PAGE), [loader, game, channel, fitOnly]);

  const target = tofu ? tofuTarget(tofu) : null;
  const rows = useMemo(() => filterVersions(versions ?? [], { loader: mod ? loader : "", gameVersion: game, channel, fit: fitOnly && target ? target : null }, mod), [versions, loader, game, channel, fitOnly, target?.loader, target?.gameVersion, mod]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaderChoices = useMemo(() => listLoaders(versions ?? []), [versions]);
  const gameChoices = useMemo(() => listGameVersions(versions ?? []), [versions]);
  const creator = getPrimaryCreator(project);

  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window" role="dialog" aria-modal="true" aria-label={t("{name} details").replace("{name}", project.title)} onMouseDown={(event) => event.stopPropagation()}>
    <div className="project-details-header"><div>{project.icon_url ? <DiscoveryImage src={project.icon_url} alt="" className="discover-card-icon" label={project.title} /> : <div className="discover-card-icon fallback"><PackageOpen size={26} /></div>}<div><p className="eyebrow">{t(projectTypeLabel(project.project_type))}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{creator.name || t("Unknown creator")}</strong> · {(project.downloads ?? 0).toLocaleString()} downloads</small></div></div><div className="project-details-header-actions"><button type="button" className="secondary-button" onClick={() => { void openExternalUrl(`https://modrinth.com/${encodeURIComponent(project.project_type)}/${encodeURIComponent(project.slug || project.project_id)}`).catch(() => undefined); }}><ExternalLink size={13} /> View on Modrinth</button><button type="button" className="icon-button" onClick={onClose} aria-label="Close project details"><X size={17} /></button></div></div>
    <div className="project-tabs" role="tablist" aria-label="Project sections"><button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button type="button" role="tab" aria-selected={tab === "versions"} className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>Versions{versions ? ` (${versions.length})` : ""}</button></div>
    {tab === "overview" ? <div className="project-overview">
      <section className="project-creator-primary">
        <Avatar src={creator.avatar} name={creator.name} className="project-creator-primary-avatar" />
        <div><span>Created by</span><strong>{creator.name || "Unknown creator"}</strong></div>
      </section>
      <div className="project-info-grid">
        <span><strong>Downloads</strong>{(project.downloads ?? 0).toLocaleString()}</span>
        <span><strong>Followers</strong>{(project.followers || 0).toLocaleString()}</span>
        <span><strong>Project type</strong>{projectTypeLabel(project.project_type)}</span>
        <span><strong>Categories</strong>{project.categories?.join(", ") || t("Not provided")}</span>
        <span><strong>License</strong>{project.license?.name || t("Not provided")}</span>
        <span><strong>Members</strong>{project.members?.length ?? 0}</span>
      </div>
      <h3 className="project-overview-heading">Overview</h3>
      <Markdown source={project.body || project.description} />
      {project.members?.length ? <section className="project-creators">
        <div className="project-creators-heading"><div><h3>Creators & contributors</h3><p>{t(project.members.length === 1 ? "1 team member credited on Modrinth." : "{count} team members credited on Modrinth.").replace("{count}", String(project.members.length))}</p></div></div>
        <div className="project-creator-grid">{project.members.map((member) => <div className="project-creator" key={member.user.id}>
          <Avatar src={member.user.avatar_url} name={member.user.name || member.user.username} />
          <div><strong>{member.user.name || member.user.username}</strong><small>@{member.user.username} · {member.role}</small></div>
        </div>)}</div>
      </section> : null}
    </div> : <div className="project-versions">
      <div className="version-filters">
        {mod && loaderChoices.length > 0 && <Select value={loader} onChange={setLoader} label={t("Loader")} searchable={false} options={[{ value: "", label: t("Any loader") }, ...loaderChoices.map((value) => ({ value, label: loaderLabels[parseLoader(value)!] ?? value }))]} />}
        <Select value={game} onChange={setGame} label={t("Game version")} searchable={gameChoices.length > 10} options={[{ value: "", label: t("Any game version") }, ...gameChoices.map((value) => ({ value, label: value }))]} />
        <Select value={channel} onChange={setChannel} label={t("Release type")} searchable={false} options={channelOptions} />
        {tofu && <Checkbox className="version-fit-toggle" checked={fitOnly} onChange={setFitOnly} label={t("Only what fits {name}").replace("{name}", tofu.name)} />}
        {(loader || game || channel || fitOnly) && <button type="button" className="text-button" onClick={() => { setLoader(""); setGame(""); setChannel(""); setFitOnly(false); }}>{t("Clear filters")}</button>}
      </div>
      {versions === null ? <p className="muted"><RefreshCw size={13} className="spin" /> Loading versions...</p> : <>
        {error && <p className="metadata-note" role="alert">{error}</p>}
        <p className="version-count" aria-live="polite">{t(rows.length === 1 && versions.length === 1 ? "1 of 1 version" : "{shown} of {total} versions").replace("{shown}", String(rows.length)).replace("{total}", String(versions.length))}</p>
        {rows.length ? <div className="version-table" role="list">
          <div className="version-row version-head" aria-hidden="true"><div className="version-row-main"><span /><span>Version</span><span>Type</span><span>Loaders</span><span>Game versions</span><span>Published</span><span>Size</span><span /></div></div>
          {rows.slice(0, shown).map((version) => { const fit = target ? versionFit(version, target, mod) : undefined; return <div role="listitem" key={version.id}>
            <VersionRow version={version} fit={fit ? { status: fit.status, reason: fit.reasons[0] } : undefined} onDownload={() => { const file = modrinthFile(version); if (file) onDownload(project, file); }} />
          </div>; })}
          {rows.length > shown && <button type="button" className="secondary-button version-more" onClick={() => setShown((value) => value + PAGE)}>{t("Show {count} more").replace("{count}", String(Math.min(PAGE, rows.length - shown)))}</button>}
        </div> : <div className="discover-empty">{t("No versions match these filters.")}</div>}
      </>}
    </div>}
  </div></div>;
}
