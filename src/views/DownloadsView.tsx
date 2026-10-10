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

export function DownloadsView() {
  const { downloads, lib, setActiveNav, downloadPacing } = useApp();
  const { prefs, setPrefs } = downloadPacing;
  const held = downloadsHeld(prefs, new Date());
  useUpdateVersion();
  // Mod updates install in place (not through this list); show where they wait or run.
  const updating = lib.library.flatMap((piko) => piko.tofus.map((tofu) => ({ piko, tofu, state: getUpdateState(tofu.id) })))
    .filter((entry) => entry.state.updating.length || updateCount(entry.state));
  const [error, setError] = useState("");
  const groups = groupDownloads(downloads);
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "That did not work.");
  const clearFinished = async () => {
    const count = downloads.filter((entry) => entry.status !== "downloading").length;
    if (!count || !await confirmAction({ title: "Clear finished downloads?", message: `Removes ${count} finished download${count === 1 ? "" : "s"} from the list. Downloaded files stay on disk.`, confirmLabel: "Clear" })) return;
    await clearFinishedDownloads().catch(report);
  };
  return <section className="downloads-page">
    <div className="downloads-intro">
      <p className="eyebrow">Activity</p><h2>Downloads</h2>
      <p>Mods, resource packs and shaders from Modrinth, CurseForge and Nexus Mods download here and keep going while Mochi is hidden in the tray. Finished downloads stay in this list for 10 minutes.</p>
    </div>
    <section className="download-group download-pacing" aria-label="Download controls">
      <div className="download-group-heading"><strong>Download controls</strong><span>{held ? (prefs.paused ? "Paused" : "Waiting for your allowed hours") : "Running"}</span></div>
      <div className="download-toolbar">
        <button type="button" className="secondary-button" aria-pressed={prefs.paused} onClick={() => setPrefs((current) => ({ ...current, paused: !current.paused }))}>{prefs.paused ? <><Play size={14} /> Resume all downloads</> : <><Pause size={14} /> Pause all downloads</>}</button>
        <label className="download-pacing-field"><span>Speed limit</span><select value={prefs.limitKiB} onChange={(event) => setPrefs((current) => ({ ...current, limitKiB: Number(event.target.value) }))}>{speedLimits.map((item) => <option key={item.kib} value={item.kib}>{item.label}</option>)}</select></label>
        <label className="download-pacing-field download-pacing-window"><input type="checkbox" checked={prefs.window.enabled} onChange={(event) => setPrefs((current) => ({ ...current, window: { ...current.window, enabled: event.target.checked } }))} /><span>Schedule downloads</span></label>
        <label className="download-pacing-field"><span>From</span><input type="time" aria-label="Allowed from" value={prefs.window.start} disabled={!prefs.window.enabled} onChange={(event) => event.target.value && setPrefs((current) => ({ ...current, window: { ...current.window, start: event.target.value } }))} /></label>
        <label className="download-pacing-field"><span>Until</span><input type="time" aria-label="Allowed until" value={prefs.window.end} disabled={!prefs.window.enabled} onChange={(event) => event.target.value && setPrefs((current) => ({ ...current, window: { ...current.window, end: event.target.value } }))} /></label>
      </div>
      <small className="metadata-note">Pausing holds running downloads where they are (a server may drop one that waits too long, and it can be started again). The speed limit is shared between running downloads. Settings apply while Mochi is open.</small>
    </section>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {updating.length > 0 && <section className="download-group download-updates" aria-label="Mod updates">
      <div className="download-group-heading"><strong>Mod updates</strong><button type="button" className="text-button" onClick={() => setActiveNav("Installed")}>Open Mods &amp; Content</button></div>
      <ul className="download-update-list">{updating.map(({ piko, tofu, state }) => <li key={tofu.id}><span>{piko.name}: {tofu.name}</span><small>{state.updating.length ? `Updating ${state.updating.length}…` : `${updateCount(state)} update${updateCount(state) === 1 ? "" : "s"} available`}</small></li>)}</ul>
    </section>}
    {hasFinished(downloads) && <div className="download-toolbar"><button type="button" className="secondary-button" onClick={() => void clearFinished()}><Trash2 size={13} /> Clear finished</button></div>}
    {!downloads.length ? <div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>No active downloads</h3><p>Nothing is downloading right now.</p></div> : (
      <div className="download-groups">
        {groups.map((group) => (
          <section className="download-group" key={group.tofuId} aria-label={group.tofuName}>
            <div className="download-group-heading"><strong>{group.tofuName}</strong><span>{group.items.length} {group.items.length === 1 ? "download" : "downloads"}</span></div>
            <div className="download-list">{group.items.map((download) => {
              const row = describeDownload(download);
              return <article className={`download-row is-${row.state}`} key={download.id}>
                <div className="download-row-copy"><strong>{download.itemName}</strong><small>{download.filename} · {downloadKind(download)} · {providerLabels[download.provider]}</small></div>
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
