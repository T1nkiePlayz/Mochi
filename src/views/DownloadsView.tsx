import { Download } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";
import { formatBytes } from "../lib/format";
import { useApp } from "../state/AppContext";

export function DownloadsView() {
  const { downloads } = useApp();
  const groups = [...new Map(downloads.map((download) => [download.tofuId, download.tofuName])).entries()];
  return <section className="downloads-page">
    <div className="downloads-intro"><p className="eyebrow">Activity</p><h2>Downloads</h2><p>Concurrent Modrinth downloads continue while Mochi is hidden in the tray. Completed downloads stay here for 10 minutes.</p></div>
    {!downloads.length ? <div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>No active downloads</h3><p>Nothing is downloading right now.</p></div> : (
      <div className="download-groups">
        {groups.map(([tofuId, tofuName]) => {
          const items = downloads.filter((download) => download.tofuId === tofuId);
          return <section className="download-group" key={tofuId}>
            <div className="download-group-heading"><strong>{tofuName}</strong><span>{items.length} {items.length === 1 ? "download" : "downloads"}</span></div>
            <div className="download-list">{items.map((download) => {
              const progress = download.total ? Math.min(100, (download.downloaded / download.total) * 100) : 0;
              const detail = download.status === "failed" ? download.error || "Failed"
                : download.total ? (download.status === "completed" ? "Completed · " : Math.round(progress) + "% · ") + formatBytes(download.total) + " total" + (download.status === "downloading" ? " · " + formatBytes(download.downloaded) + " downloaded" : "")
                : download.status === "completed" ? "Completed · size unavailable" : formatBytes(download.downloaded) + " downloaded · size unavailable";
              return <article className="download-row" key={download.id}>
                <div className="download-row-copy"><strong>{download.itemName}</strong><small>{download.filename}</small></div>
                <div className="download-progress-wrap">
                  <div className={"download-progress " + (download.status === "downloading" && !download.total ? "indeterminate" : download.status === "failed" ? "failed" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={download.status === "completed" ? 100 : Math.round(progress)}><span style={{ width: download.status === "downloading" && download.total ? progress + "%" : download.status === "completed" ? "100%" : undefined }} /></div>
                  <small>{detail}</small>
                </div>
              </article>;
            })}</div>
          </section>;
        })}
      </div>
    )}
  </section>;
}
