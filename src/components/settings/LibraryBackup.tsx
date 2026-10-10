import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Upload } from "lucide-react";
import { confirmAction } from "../../lib/confirm";
import { exportBackupToFile, pickBackupFile, readSchedule, writeBackupData, writeSchedule, type BackupSchedule } from "../../lib/libraryBackup";

const message = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.");

/** One-file backup and restore of the library (games, collections, wishlist, saved filters), plus an optional scheduled copy to a folder. */
export function LibraryBackup() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [schedule, setScheduleState] = useState<BackupSchedule>(readSchedule);
  const setSchedule = (change: Partial<BackupSchedule>) => setScheduleState((current) => { const next = { ...current, ...change }; writeSchedule(next); return next; });

  const runExport = async () => {
    setBusy(true); setNote("");
    try { const path = await exportBackupToFile(await getVersion().catch(() => "")); setNote(path ? "Backup saved. It holds your library, collections, wishlist and saved filters, and no passwords, keys or sign-in data." : ""); }
    catch (error) { setNote(`Could not save the backup: ${message(error)}`); }
    finally { setBusy(false); }
  };
  const runRestore = async () => {
    setBusy(true); setNote("");
    try {
      const picked = await pickBackupFile();
      if (!picked) return;
      const { file, summary } = picked;
      const made = summary.createdAt ? ` made on ${new Date(summary.createdAt).toLocaleDateString()}` : "";
      const ok = await confirmAction({ title: "Restore this backup?", message: `The backup${made} has ${summary.games} game${summary.games === 1 ? "" : "s"}, ${summary.collections} collection${summary.collections === 1 ? "" : "s"}, ${summary.wishlist} wishlist item${summary.wishlist === 1 ? "" : "s"} and ${summary.savedFilters} saved filter${summary.savedFilters === 1 ? "" : "s"}. It replaces your current library, collections, wishlist and saved filters, and Mochi restarts its window. Playtime history and settings are not changed. Save a backup of the current library first if you may want it back.`, confirmLabel: "Restore" });
      if (!ok) return;
      writeBackupData(file);
      window.location.reload();
    } catch (error) { setNote(`Could not restore: ${message(error)}`); }
    finally { setBusy(false); }
  };
  const chooseFolder = async () => {
    const picked = await open({ title: "Choose backup folder", directory: true, multiple: false });
    if (typeof picked === "string") setSchedule({ folder: picked, enabled: true, lastAt: 0 });
  };

  return <>
    <div className="setting-row"><span><strong>Library backup</strong><small>Save your whole library (games, collections, wishlist, saved filters) to one file, or restore it on this or another device. No passwords, keys or sign-in data. Playtime history is not included.</small></span>
      <span className="data-source-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runExport()}><Download size={14} aria-hidden="true" /> Back up…</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runRestore()}><Upload size={14} aria-hidden="true" /> Restore…</button>
      </span></div>
    <div className="setting-row setting-location-row"><span><strong>Automatic backup</strong><small>While Mochi is open, saves a copy to a folder when one is due and keeps the newest few.</small></span>
      <span className="setting-location-value">
        <label><input type="checkbox" checked={schedule.enabled} disabled={!schedule.folder} onChange={(event) => setSchedule({ enabled: event.target.checked })} /> On</label>
        <select aria-label="How often" value={schedule.everyDays} onChange={(event) => setSchedule({ everyDays: Number(event.target.value) as BackupSchedule["everyDays"] })}><option value={1}>Daily</option><option value={7}>Weekly</option><option value={30}>Monthly</option></select>
        <select aria-label="Copies to keep" value={schedule.keep} onChange={(event) => setSchedule({ keep: Number(event.target.value) })}>{[3, 5, 10, 20].map((count) => <option key={count} value={count}>Keep {count}</option>)}</select>
        <code>{schedule.folder || "No folder chosen"}</code>
        <button type="button" className="secondary-button" onClick={() => void chooseFolder()}><FolderOpen size={14} aria-hidden="true" /> Folder…</button>
      </span></div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </>;
}
