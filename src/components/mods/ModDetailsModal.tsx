import { useEffect, useMemo, useState } from "react";
import { Download, PackageOpen, RefreshCw, X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { openExternalUrl } from "../../lib/platform";
import { compatibility, metaFromModFile, parseLoader } from "../../lib/mods/compat";
import { defaultFile } from "../../lib/mods/install";
import { RESTRICTED_MESSAGE } from "../../lib/mods/helpers";
import { sourceLabels, type ModDetails, type ModFile, type ModItem, type ModSource } from "../../lib/mods/types";
import { DiscoveryImage } from "../discover/DiscoveryImage";
import { Markdown } from "../discover/Markdown";
import { Select } from "../ui/Select";
import { CurseforgeCredit, ViewOnSite } from "./CurseforgeCredit";
import { InstallNoticeBar } from "./InstallNoticeBar";
import { ModalShell } from "./ModalShell";
import { SafeHtml } from "./SafeHtml";
import type { InstallNotice } from "./useModInstall";
import { Checkbox } from "../ui/Checkbox";

type Props = {
  source: ModSource;
  item: ModItem;
  filter?: { gameVersion?: string; loader?: string };
  /** "Download" for a chosen Tofu, "Choose Tofu instance" in Discover. */
  installLabel: string;
  busy?: boolean;
  notice: InstallNotice | null;
  onDismissNotice: () => void;
  onInstall: (file: ModFile) => void;
  onClose: () => void;
};

const fileLabel = (file: ModFile) => [file.name, file.channel && file.channel !== "release" ? file.channel : "", file.size ? formatBytes(file.size) : ""].filter(Boolean).join(" · ");

export function ModDetailsModal({ source, item, filter, installLabel, busy, notice, onDismissNotice, onInstall, onClose }: Props) {
  const [details, setDetails] = useState<ModDetails | null>(null);
  const [files, setFiles] = useState<ModFile[] | null>(null);
  const [error, setError] = useState("");
  const [fileId, setFileId] = useState("");
  // "Force install": the list is narrowed to the Tofu's game version and loader, but every file can be shown and installed.
  const [showAll, setShowAll] = useState(false);
  const narrowed = Boolean(filter?.gameVersion || filter?.loader);

  useEffect(() => {
    let cancelled = false;
    setDetails(null); setFiles(null); setError("");
    void source.details(item).then((value) => { if (!cancelled) setDetails(value); }).catch((reason) => { if (!cancelled) { setDetails({ body: null, facts: [] }); setError(reason instanceof Error ? reason.message : "Unable to load the description."); } });
    void source.files(item, showAll ? undefined : filter).then((value) => { if (cancelled) return; setFiles(value); setFileId(defaultFile(value)?.id ?? ""); })
      .catch((reason) => { if (!cancelled) { setFiles([]); setError((previous) => previous || (reason instanceof Error ? reason.message : "Unable to load the files.")); } });
    return () => { cancelled = true; };
  }, [source, item, filter?.gameVersion, filter?.loader, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const file = useMemo(() => files?.find((candidate) => candidate.id === fileId), [files, fileId]);
  const fit = useMemo(() => (file && narrowed ? compatibility(metaFromModFile(file), { loader: parseLoader(filter?.loader), gameVersion: filter?.gameVersion }) : null), [file, narrowed, filter?.loader, filter?.gameVersion]);
  const blocked = item.source === "curseforge" && (item.native as { allowModDistribution?: boolean | null }).allowModDistribution === false;
  const site = sourceLabels[item.source];

  return <ModalShell label={`${item.name} details`} className="project-details-window mod-details" onClose={onClose}>
    <div className="project-details-header"><div>
      {item.iconUrl ? <DiscoveryImage src={item.iconUrl} alt="" className="discover-card-icon" label={item.name} /> : <div className="discover-card-icon fallback"><PackageOpen size={26} /></div>}
      <div><p className="eyebrow">{item.kind ?? site} · {site}</p><h2>{item.name}</h2><p>{item.summary}</p><small>Created by <strong>{item.author || "Unknown creator"}</strong></small></div>
    </div><button type="button" className="icon-button" onClick={onClose} aria-label="Close mod details" data-autofocus><X size={17} /></button></div>
    <div className="project-overview">
      <InstallNoticeBar notice={notice} onDismiss={onDismissNotice} />
      <section className="mod-download-panel" aria-label="Download">
        {narrowed && <Checkbox checked={showAll} onChange={setShowAll} label="Show files for other game versions and loaders (install anyway)" />}
        {files === null ? <p className="muted"><RefreshCw size={13} className="spin" /> Loading files...</p> : files.length === 0 ? <p className="muted">No files are listed for this mod{filter?.gameVersion ? ` for ${filter.gameVersion}` : ""}.</p> : <>
          <label className="mod-file-picker"><span>File</span><Select value={fileId} onChange={setFileId} label="File to download" searchable={files.length > 12} options={files.map((candidate) => ({ value: candidate.id, label: fileLabel(candidate), description: candidate.gameVersions?.slice(0, 4).join(", ") }))} /></label>
          {file?.dependencies?.length ? <p className="mod-dependencies" role="note">Requires: {file.dependencies.map((dependency, index) => <span key={dependency.id}>{index ? ", " : ""}<a href={dependency.url} onClick={(event) => { event.preventDefault(); void openExternalUrl(dependency.url).catch(() => undefined); }}>{dependency.name ?? `mod ${dependency.id}`}</a></span>)}. Mochi offers to install them before the mod.</p> : null}
        </>}
        {fit && fit.status !== "compatible" && <p className="metadata-note" role="note">{fit.status === "incompatible" ? "May not work with this Tofu: " : "Check before installing: "}{fit.reasons.join(" ")}</p>}
        {blocked && <p className="metadata-note" role="note">{RESTRICTED_MESSAGE}</p>}
        <div className="mod-download-actions">
          {!blocked && <button type="button" className="play-button" disabled={!file || busy} onClick={() => file && onInstall(file)}>{busy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />} {installLabel}</button>}
          <ViewOnSite url={item.pageUrl} label={`View on ${site}`} />
          {item.source === "curseforge" && <CurseforgeCredit />}
        </div>
      </section>
      {details?.facts.length ? <div className="project-info-grid">{details.facts.map((fact) => <span key={fact.label}><strong>{fact.label}</strong>{fact.value}</span>)}</div> : null}
      {error && <p className="metadata-note" role="alert">{error}</p>}
      <h3 className="project-overview-heading">Description</h3>
      {details === null ? <p className="muted"><RefreshCw size={13} className="spin" /> Loading description...</p> : details.body ? (details.body.kind === "html" ? <SafeHtml html={details.body.text} /> : <Markdown source={details.body.text} />) : <p className="muted">No description was provided.</p>}
    </div>
  </ModalShell>;
}
