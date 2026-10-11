import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { getTranslationLocale } from "../../lib/translationLocale";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Upload } from "lucide-react";
import { confirmAction } from "../../lib/confirm";
import { exportBackupToFile, pickBackupFile, readSchedule, writeBackupData, writeSchedule, type BackupSchedule } from "../../lib/libraryBackup";

const message = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.");

/** One-file backup and restore of the library (games, collections, wishlist, saved filters), plus an optional scheduled copy to a folder. */
export function LibraryBackup() {
  const t = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [schedule, setScheduleState] = useState<BackupSchedule>(readSchedule);
  const setSchedule = (change: Partial<BackupSchedule>) => setScheduleState((current) => { const next = { ...current, ...change }; writeSchedule(next); return next; });

  const runExport = async () => {
    setBusy(true); setNote("");
    try { const path = await exportBackupToFile(await getVersion().catch(() => "")); setNote(path ? t("Backup saved. It holds your library, collections, wishlist and saved filters, and no passwords, keys or sign-in data.") : ""); }
    catch (error) { setNote(t("Could not save the backup: {error}").replace("{error}", message(error))); }
    finally { setBusy(false); }
  };
  const runRestore = async () => {
    setBusy(true); setNote("");
    try {
      const picked = await pickBackupFile();
      if (!picked) return;
      const { file, summary } = picked;
      const made = summary.createdAt ? t(" made on {date}").replace("{date}", new Date(summary.createdAt).toLocaleDateString(getTranslationLocale())) : "";
      const ok = await confirmAction({ title: t("Restore this backup?"), message: `${t("The backup{made} has {games} games, {collections} collections, {wishlist} wishlist items and {savedFilters} saved filters.").replace("{made}", made).replace("{games}", String(summary.games)).replace("{collections}", String(summary.collections)).replace("{wishlist}", String(summary.wishlist)).replace("{savedFilters}", String(summary.savedFilters))} ${t("It replaces your current library, collections, wishlist and saved filters, and Mochi restarts its window.")} ${t("Playtime history and settings are not changed.")} ${t("Save a backup of the current library first if you may want it back.")}`, confirmLabel: t("Restore") });
      if (!ok) return;
      writeBackupData(file);
      window.location.reload();
    } catch (error) { setNote(t("Could not restore: {error}").replace("{error}", message(error))); }
    finally { setBusy(false); }
  };
  const chooseFolder = async () => {
    const picked = await open({ title: t("Choose backup folder"), directory: true, multiple: false });
    if (typeof picked === "string") setSchedule({ folder: picked, enabled: true, lastAt: 0 });
  };

  return <>
    <div className="setting-row"><span><strong>{t("Library backup")}</strong><small>{t("Save your whole library (games, collections, wishlist, saved filters) to one file, or restore it on this or another device. No passwords, keys or sign-in data. Playtime history is not included.")}</small></span>
      <span className="data-source-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runExport()}><Download size={14} aria-hidden="true" /> {t("Back up…")}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runRestore()}><Upload size={14} aria-hidden="true" /> {t("Restore…")}</button>
      </span></div>
    <div className="setting-row setting-location-row"><span><strong>{t("Automatic backup")}</strong><small>{t("While Mochi is open, saves a copy to a folder when one is due and keeps the newest few.")}</small></span>
      <span className="setting-location-value">
        <label><input type="checkbox" checked={schedule.enabled} disabled={!schedule.folder} onChange={(event) => setSchedule({ enabled: event.target.checked })} /> {t("On")}</label>
        <select aria-label={t("How often")} value={schedule.everyDays} onChange={(event) => setSchedule({ everyDays: Number(event.target.value) as BackupSchedule["everyDays"] })}><option value={1}>{t("Daily")}</option><option value={7}>{t("Weekly")}</option><option value={30}>{t("Monthly")}</option></select>
        <select aria-label={t("Copies to keep")} value={schedule.keep} onChange={(event) => setSchedule({ keep: Number(event.target.value) })}>{[3, 5, 10, 20].map((count) => <option key={count} value={count}>{t("Keep {count}").replace("{count}", String(count))}</option>)}</select>
        <code>{schedule.folder || "No folder chosen"}</code>
        <button type="button" className="secondary-button" onClick={() => void chooseFolder()}><FolderOpen size={14} aria-hidden="true" /> {t("Folder…")}</button>
      </span></div>
    {note && <p className="metadata-note settings-note" role="status">{t(note)}</p>}
  </>;
}
