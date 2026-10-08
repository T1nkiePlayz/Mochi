import { useApp } from "../../state/AppContext";
import { useUpdater } from "../../state/useUpdater";
import { formatBytes } from "../../lib/updater";
import { SettingsGroup, ToggleRow } from "./Section";

const formatWhen = (time?: number) => (time ? new Date(time).toLocaleString() : "Never");

export function UpdateSection() {
  const { behavior, setBehavior } = useApp();
  const updater = useUpdater();
  const { info, progress } = updater;
  const busy = updater.status === "checking" || updater.status === "downloading" || updater.status === "restarting";
  const percent = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : undefined;
  const status =
    updater.status === "checking" ? "Checking for updates…" :
    updater.status === "current" ? "Mochi is up to date." :
    updater.status === "offline" ? "You appear to be offline. Mochi will check again when you are back online." :
    updater.status === "error" ? `Could not check for updates: ${updater.error ?? "unknown error"}` :
    updater.status === "restarting" ? "Update installed. Restarting…" :
    info ? `Mochi ${info.version} is available.` : "";
  return <SettingsGroup title="Updates" subtitle="Keep Mochi current" id="settings-updates" className="update-section">
    <div className="setting-row"><span><strong>Version</strong><small>Mochi v{__APP_VERSION__} · last checked {formatWhen(updater.lastChecked)}</small></span></div>
    <ToggleRow title="Auto-update" description="Check GitHub for new releases in the background (about every 6 hours). Turn off to only check manually." checked={behavior.autoUpdate} onChange={(autoUpdate) => setBehavior({ ...behavior, autoUpdate })} />
    <div className="setting-row"><span><strong>Check for updates</strong><small role="status" aria-live="polite">{status || "Look for a newer release now."}</small></span>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void updater.checkNow()}>{updater.status === "checking" ? "Checking…" : "Check now"}</button>
    </div>
    {info && updater.status !== "current" && <div className="update-details">
      {info.notes && <pre className="update-notes" tabIndex={0} aria-label={`Release notes for ${info.version}`}>{info.notes}</pre>}
      {updater.status === "downloading" && <div className="update-progress">
        <progress max={100} value={percent} aria-label="Update download progress" />
        <small>{percent !== undefined ? `${percent}%` : "Downloading…"}{progress ? ` · ${formatBytes(progress.downloaded)}${progress.total ? ` of ${formatBytes(progress.total)}` : ""}` : ""}</small>
      </div>}
      <button type="button" className="play-button" disabled={busy} onClick={() => void updater.installNow()}>{info.installable ? "Install & restart" : "Open release page"}</button>
      {!info.installable && <small>This install type updates through its package manager or the release page.</small>}
    </div>}
  </SettingsGroup>;
}
