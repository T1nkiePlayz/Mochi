import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { getTranslationLocale } from "../../lib/translationLocale";
import { confirmAction } from "../../lib/confirm";
import { getSaveSyncStatus, removeSaveSyncData, setSaveSyncFolder, syncGames, syncSavesNow, type SyncStatus } from "../../lib/saveSync";
import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.");

/** Settings > Save sync: pick the folder your own sync tool keeps in step between devices, turn it on, sync now, see what happened. */
export function SaveSyncSection() {
  const t = useTranslation();
  const { lib } = useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { void getSaveSyncStatus().then(setStatus).catch(() => {}); }, []);

  const run = async (work: () => Promise<SyncStatus | string | void>) => {
    setBusy(true); setNote("");
    try { const result = await work(); if (typeof result === "string") setNote(result); else if (result) setStatus(result); }
    catch (error) { setNote(t(errorText(error))); }
    finally { setBusy(false); }
  };
  const choose = () => run(async () => {
    const picked = await open({ title: t("Choose sync folder"), directory: true, multiple: false });
    return typeof picked === "string" ? setSaveSyncFolder(picked, status?.enabled ?? false) : undefined;
  });
  const toggle = (enabled: boolean) => run(async () => {
    const next = await setSaveSyncFolder(status?.folder ?? "", enabled);
    return enabled ? syncSavesNow(syncGames(lib.library), true) : next;
  });
  const syncNow = () => run(() => syncSavesNow(syncGames(lib.library), true));
  const remove = () => run(async () => {
    if (!await confirmAction({ title: t("Remove from the sync folder?"), danger: true, confirmLabel: t("Remove backups"), items: [status?.folder ?? ""],
      message: t("Deletes the save backups this device put in the sync folder and turns sync off. Backups from other devices, other files and the backups on this computer are not touched.") })) return;
    const count = await removeSaveSyncData();
    setStatus(await getSaveSyncStatus());
    return t("Removed {count} backup files from the sync folder.").replace("{count}", String(count));
  });

  const line = !status?.lastSyncAt ? t("Not synced yet.")
    : t("Last sync {time}: {imported} imported, {exported} exported.").replace("{time}", new Date(status.lastSyncAt).toLocaleString(getTranslationLocale(), { dateStyle: "medium", timeStyle: "short" })).replace("{imported}", String(status.imported)).replace("{exported}", String(status.exported));
  return <SettingsGroup title={t("Save sync")} subtitle={t("Share save backups through a folder you keep in sync yourself")} id="settings-savesync">
    <ToggleRow title={t("Sync save backups")} checked={status?.enabled ?? false} disabled={busy || !status?.folder} onChange={(checked) => void toggle(checked)}
      description={t("Copies every new save backup into the folder and adds backups other devices put there. Use a folder kept in sync by Syncthing, Nextcloud or a mounted WebDAV share. Mochi never uploads anything itself and never restores a synced backup without asking.")} />
    <div className="setting-row setting-location-row"><span><strong>{t("Sync folder")}</strong><small>{t("Backups go to a Mochi Saves folder inside it.")}</small></span>
      <span className="setting-location-value">
        <code>{status?.folder || t("No folder chosen")}</code>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void choose()}><FolderOpen size={14} aria-hidden="true" /> {t("Choose folder…")}</button>
      </span></div>
    <div className="setting-row"><span><strong>{t("Status")}</strong><small role="status">{line}</small>
      {status && status.pending > 0 && <small>{t("{count} still arriving, will retry.").replace("{count}", String(status.pending))}</small>}
      {status?.enabled && !status.available && <small>{t("The sync folder is not available right now.")}</small>}
      {status?.errors.map((error) => <small key={error} className="auth-error">{t(error)}</small>)}</span>
      <span className="data-source-actions">
        <button type="button" className="secondary-button" disabled={busy || !status?.enabled} onClick={() => void syncNow()}><RefreshCw size={14} aria-hidden="true" /> {busy ? t("Syncing…") : t("Sync now")}</button>
        <button type="button" className="secondary-button danger-outline" disabled={busy || !status?.folder} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" /> {t("Remove from sync folder")}</button>
      </span></div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </SettingsGroup>;
}
