import { useState } from "react";
import { Download, FolderOpen, Trash2, X } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";
import { describeDownload, groupDownloads, hasFinished, providerLabels } from "../lib/downloadView";
import { cancelModDownload, clearFinishedDownloads } from "../lib/downloads";
import { openPath } from "../lib/platform";
import { useApp } from "../state/AppContext";

export function DownloadsView() {
  const { downloads } = useApp();
  const [error, setError] = useState("");
  const groups = groupDownloads(downloads);
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "That did not work.");
  return <section className="downloads-page">
    <div className="downloads-intro">
      <p className="eyebrow">Activity</p><h2>Downloads</h2>
      <p>Mods, resource packs and shaders from Modrinth, CurseForge and Nexus Mods download here and keep going while Mochi is hidden in the tray. Finished downloads stay in this list for 10 minutes.</p>
    </div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {hasFinished(downloads) && <div className="download-toolbar"><button type="button" className="secondary-button" onClick={() => void clearFinishedDownloads().catch(report)}><Trash2 size={13} /> Clear finished</button></div>}
    {!downloads.length ? <div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>No active downloads</h3><p>Nothing is downloading right now.</p></div> : (
      <div className="download-groups">
        {groups.map((group) => (
          <section className="download-group" key={group.tofuId} aria-label={group.tofuName}>
            <div className="download-group-heading"><strong>{group.tofuName}</strong><span>{group.items.length} {group.items.length === 1 ? "download" : "downloads"}</span></div>
            <div className="download-list">{group.items.map((download) => {
              const row = describeDownload(download);
              return <article className={`download-row is-${row.state}`} key={download.id}>
                <div className="download-row-copy"><strong>{download.itemName}</strong><small>{download.filename} · {providerLabels[download.provider]}</small></div>
                <div className="download-progress-wrap">
                  <div className={"download-progress " + (row.state === "active" && row.percent === null ? "indeterminate" : row.state === "failed" || row.state === "cancelled" ? "failed" : "")} role="progressbar" aria-label={`${download.itemName} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.percent ?? undefined} aria-valuetext={row.detail}>
                    <span style={{ width: row.percent !== null && row.state !== "failed" && row.state !== "cancelled" ? `${row.percent}%` : undefined }} />
                  </div>
                  <small role={row.state === "failed" ? "alert" : undefined}>{row.detail}</small>
                </div>
                <div className="download-row-actions">
                  {row.canCancel && <button type="button" className="icon-button" aria-label={`Cancel ${download.itemName}`} title="Cancel" onClick={() => void cancelModDownload(download.id).catch(report)}><X size={15} /></button>}
                  {download.dir && <button type="button" className="icon-button" aria-label={`Open folder of ${download.itemName}`} title="Open folder" onClick={() => void openPath(download.dir).catch(report)}><FolderOpen size={15} /></button>}
                </div>
              </article>;
            })}</div>
          </section>
        ))}
      </div>
    )}
  </section>;
}
