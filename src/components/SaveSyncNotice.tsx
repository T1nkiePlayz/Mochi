import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "../lib/useTranslation";
import { getTranslationLocale } from "../lib/translationLocale";
import { confirmAction } from "../lib/confirm";
import { listSaveLocations, restoreSaveBackup, saveHints, type SaveLocation } from "../lib/saveBackups";
import { getSaveSyncStatus } from "../lib/saveSync";
import type { Piko } from "../models";
import { useApp } from "../state/AppContext";

const when = (ms: number) => new Date(ms).toLocaleString(getTranslationLocale(), { dateStyle: "medium", timeStyle: "short" });

/** Game page notice: another device has newer saves than this one (via save sync). Offers the safe restore, never applies anything itself. */
export function SaveSyncNotice({ game }: { game: Piko }) {
  const t = useTranslation();
  const { sessions } = useApp();
  const [found, setFound] = useState<SaveLocation | null>(null);
  const [message, setMessage] = useState("");
  const hintsKey = JSON.stringify(saveHints(game));
  const load = useCallback(async () => {
    try {
      const status = await getSaveSyncStatus();
      if (!status.enabled) { setFound(null); return; }
      const locations = await listSaveLocations(game.id, JSON.parse(hintsKey));
      setFound(locations.find((location) => !location.problem && location.remoteNewer) ?? null);
    } catch { setFound(null); }
  }, [game.id, hintsKey]);
  useEffect(() => { void load(); }, [load]);

  const backup = found?.remoteNewer;
  if (!found || !backup) return message ? <p className="metadata-note" role="status">{message}</p> : null;
  const restore = async () => {
    const detail = { time: when(backup.createdAt), device: backup.device || t("another device") };
    if (!await confirmAction({ title: t("Restore newer saves?"), confirmLabel: t("Restore"), danger: true, items: [found.path],
      message: t("The saves in this folder are replaced by the backup from {time}, taken on {device}. Mochi first backs up the current saves (kept as “Before restore”), so you can undo this.").replace("{time}", detail.time).replace("{device}", detail.device) })) return;
    try {
      const result = await restoreSaveBackup(backup.id);
      setMessage(t("Restored {count} files.{safety}").replace("{count}", String(result.files)).replace("{safety}", result.safety ? ` ${t("Your previous saves were kept as a backup.")}` : ""));
      await load();
    } catch (error) { setMessage(t(error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.")); }
  };
  return <div className="metadata-note save-sync-notice" role="status">
    <span>{t("{device} has newer saves for {label} ({time}).").replace("{device}", backup.device || t("another device")).replace("{label}", found.label).replace("{time}", when(backup.createdAt))}</span>
    {" "}<button type="button" className="secondary-button" disabled={sessions.isRunning(game.id)} title={sessions.isRunning(game.id) ? t("Close the game before restoring") : undefined} onClick={() => void restore()}><RotateCcw size={13} /> {t("Restore them…")}</button>
    {message && <span> {message}</span>}
  </div>;
}
