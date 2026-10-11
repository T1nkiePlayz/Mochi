import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { downloadsHeld, speedLimits } from "../lib/downloadPacing";
import { Download, FolderOpen, Trash2, X } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";
import { describeDownload, downloadKind, groupDownloads, hasFinished, providerLabels } from "../lib/downloadView";
import { getUpdateState, updateCount, useUpdateVersion } from "../state/modUpdates";
import { cancelModDownload, clearFinishedDownloads } from "../lib/downloads";
import { openPath } from "../lib/platform";
import { useApp } from "../state/AppContext";
import { confirmAction } from "../lib/confirm";
import { useTranslation } from "../lib/useTranslation";

export function DownloadsView() {
  const t = useTranslation();
  const { downloads, lib, setActiveNav, downloadPacing } = useApp();
  const { prefs, setPrefs } = downloadPacing;
  const held = downloadsHeld(prefs, new Date());
  useUpdateVersion();
  // Mod updates install in place (not through this list); show where they wait or run.
  const updating = lib.library.flatMap((piko) => piko.tofus.map((tofu) => ({ piko, tofu, state: getUpdateState(tofu.id) })))
    .filter((entry) => entry.state.updating.length || updateCount(entry.state));
  const [error, setError] = useState("");
  const groups = groupDownloads(downloads);
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : t("That did not work."));
  const clearFinished = async () => {
    const count = downloads.filter((entry) => entry.status !== "downloading").length;
    if (!count || !await confirmAction({ title: t("Clear finished downloads?"), message: t(count === 1 ? "Removes {count} finished download from the list. Downloaded files stay on disk." : "Removes {count} finished downloads from the list. Downloaded files stay on disk.").replace("{count}", String(count)), confirmLabel: t("Clear") })) return;
    await clearFinishedDownloads().catch(report);
  };
  return <section className="downloads-page">
    <div className="downloads-intro">
      <p className="eyebrow">{t("Activity")}</p><h2>{t("Downloads")}</h2>
      <p>Mods, resource packs and shaders from Modrinth, CurseForge and Nexus Mods download here and keep going while Mochi is hidden in the tray. Finished downloads stay in this list for 10 minutes.</p>
    </div>
    <section className="download-group download-pacing" aria-label={t("Download controls")}>
      <div className="download-group-heading"><div className="download-control-heading-copy"><strong>{t("Download controls")}</strong><small>Manage bandwidth and when downloads are allowed to run.</small></div><span className={held ? "download-control-status held" : "download-control-status"}><i />{held ? (prefs.paused ? "Paused" : "Scheduled wait") : "Downloads enabled"}</span></div>
      <div className="download-control-body">
        <div className="download-control-primary">
          <div><strong>{prefs.paused ? "Downloads are paused" : held ? "Waiting for your schedule" : "Downloads can run"}</strong><small>{prefs.paused ? "Resume when you're ready to continue." : held ? "Downloads will resume automatically during your allowed hours." : "Your active downloads will continue in the background."}</small></div>
          <button type="button" className="secondary-button" aria-pressed={prefs.paused} onClick={() => setPrefs((current) => ({ ...current, paused: !current.paused }))}>{prefs.paused ? <><Play size={14} /> Resume all</> : <><Pause size={14} /> Pause all</>}</button>
        </div>
        <div className="download-control-grid">
          <label className="download-pacing-field download-speed-field"><span>{t("Bandwidth limit")}</span><select value={prefs.limitKiB} onChange={(event) => setPrefs((current) => ({ ...current, limitKiB: Number(event.target.value) }))}>{speedLimits.map((item) => <option key={item.kib} value={item.kib}>{item.label}</option>)}</select><small>Shared across active downloads</small></label>
          <div className="download-schedule-card">
            <label className="download-schedule-toggle"><span><strong>{t("Download schedule")}</strong><small>Only download during a time window</small></span><input type="checkbox" checked={prefs.window.enabled} onChange={(event) => setPrefs((current) => ({ ...current, window: { ...current.window, enabled: event.target.checked } }))} /></label>
            <div className="download-schedule-times">
              <label className="download-pacing-field"><span>{t("Start time")}</span><input type="time" aria-label={t("Allowed from")} value={prefs.window.start} disabled={!prefs.window.enabled} onChange={(event) => event.target.value && setPrefs((current) => ({ ...current, window: { ...current.window, start: event.target.value } }))} /></label>
              <label className="download-pacing-field"><span>{t("End time")}</span><input type="time" aria-label={t("Allowed until")} value={prefs.window.end} disabled={!prefs.window.enabled} onChange={(event) => event.target.value && setPrefs((current) => ({ ...current, window: { ...current.window, end: event.target.value } }))} /></label>
            </div>
          </div>
        </div>
      </div>
      <small className="metadata-note">Pausing holds running downloads in place, although a server may drop a connection that waits too long. Settings apply while Mochi is open.</small>
    </section>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {updating.length > 0 && <section className="download-group download-updates" aria-label={t("Mod updates")}>
      <div className="download-group-heading"><strong>Mod updates</strong><button type="button" className="text-button" onClick={() => setActiveNav("Installed")}>Open Mods &amp; Content</button></div>
      <ul className="download-update-list">{updating.map(({ piko, tofu, state }) => <li key={tofu.id}><span>{piko.name}: {tofu.name}</span><small>{state.updating.length ? t("Updating {count}…").replace("{count}", String(state.updating.length)) : t(updateCount(state) === 1 ? "{count} update available" : "{count} updates available").replace("{count}", String(updateCount(state)))}</small></li>)}</ul>
    </section>}
    {hasFinished(downloads) && <div className="download-toolbar"><button type="button" className="secondary-button" onClick={() => void clearFinished()}><Trash2 size={13} /> {t("Clear finished")}</button></div>}
    {!downloads.length ? <div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>{t("No active downloads")}</h3><p>{t("Nothing is downloading right now.")}</p></div> : (
      <div className="download-groups">
        {groups.map((group) => (
          <section className="download-group" key={group.tofuId} aria-label={group.tofuName}>
            <div className="download-group-heading"><strong>{group.tofuName}</strong><span>{group.items.length} {group.items.length === 1 ? "download" : "downloads"}</span></div>
            <div className="download-list">{group.items.map((download) => {
              const row = describeDownload(download, t);
              return <article className={`download-row is-${row.state}`} key={download.id}>
                <div className="download-row-copy"><strong>{download.itemName}</strong><small>{download.filename} · {t(downloadKind(download))} · {providerLabels[download.provider]}</small></div>
                <div className="download-progress-wrap">
                  <div className={"download-progress " + (row.state === "active" && row.percent === null ? "indeterminate" : row.state === "failed" || row.state === "cancelled" ? "failed" : "")} role="progressbar" aria-label={t("Download {name}").replace("{name}", download.itemName)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.percent ?? undefined} aria-valuetext={row.detail}>
                    <span style={{ width: row.percent !== null && row.state !== "failed" && row.state !== "cancelled" ? `${row.percent}%` : undefined }} />
                  </div>
                  <small role={row.state === "failed" ? "alert" : undefined}>{row.detail}</small>
                </div>
                <div className="download-row-actions">
                  {row.canCancel && <button type="button" className="icon-button" aria-label={t("Cancel {name}").replace("{name}", download.itemName)} title="Cancel" onClick={() => void cancelModDownload(download.id).catch(report)}><X size={15} /></button>}
                  {download.dir && <button type="button" className="icon-button" aria-label={t("Open folder of {name}").replace("{name}", download.itemName)} title={t("Open folder")} onClick={() => void openPath(download.dir).catch(report)}><FolderOpen size={15} /></button>}
                </div>
              </article>;
            })}</div>
          </section>
        ))}
      </div>
    )}
  </section>;
}
