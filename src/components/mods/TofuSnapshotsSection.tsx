import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, History, RotateCcw, Trash2 } from "lucide-react";
import { confirmAction } from "../../lib/confirm";
import { formatBytes } from "../../lib/format";
import { cleanSnapshotError, createTofuSnapshot, deleteTofuSnapshot, lastWorkingSnapshot, listTofuSnapshots, restoreTofuSnapshot, snapshotFolders, type SnapshotInfo } from "../../lib/mods/snapshots";
import { useApp } from "../../state/AppContext";
import { useTranslation } from "../../lib/useTranslation";
import { getTranslationLocale } from "../../lib/translationLocale";
import type { Tofu } from "../../models";

const errorText = (error: unknown, fallback: string) => cleanSnapshotError(error instanceof Error ? error.message : typeof error === "string" ? error : fallback);
const when = (ms: number) => new Date(ms).toLocaleString(getTranslationLocale(), { dateStyle: "medium", timeStyle: "short" });

/** Saved states of one Tofu's mods (taken before updates and installs) with one-click restore. */
export function TofuSnapshotsSection({ tofu }: { tofu: Tofu }) {
  const { notifications: { notify } } = useApp();
  const t = useTranslation();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(tofu.id);
  current.current = tofu.id;

  const load = useCallback(async (id: string) => {
    try { const list = await listTofuSnapshots(id); if (current.current === id) { setSnapshots(list); setError(""); } }
    catch (reason) { if (current.current === id) { setSnapshots([]); setError(errorText(reason, t("Could not read the snapshots."))); } }
  }, []);
  useEffect(() => { setSnapshots(null); setError(""); void load(tofu.id); }, [tofu.id, load]);

  const run = async (work: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (reason) { const message = errorText(reason, failure); setError(message); notify(failure, message); }
    finally { setBusy(false); await load(tofu.id); }
  };
  const restore = async (snapshot: SnapshotInfo) => {
    const ok = await confirmAction({ title: `Restore the Tofu “${tofu.name}”?`, confirmLabel: "Restore", message: "Mod files and records in its content folders are put back as they were then. Anything added since is removed, but the current state is saved first so you can undo this.", items: [`${when(snapshot.createdAt)} · ${snapshot.reason}`, `${snapshot.files} files · ${formatBytes(snapshot.size)}`] });
    if (!ok) return;
    await run(async () => {
      const report = await restoreTofuSnapshot(tofu.id, snapshot.id);
      notify("Tofu restored", `${tofu.name}: ${report.restored} restored, ${report.removed} removed, ${report.unchanged} already matched.`);
    }, "Restore failed");
  };
  const remove = async (snapshot: SnapshotInfo) => {
    if (!await confirmAction({ title: t("Delete this snapshot?"), danger: true, confirmLabel: "Delete snapshot", message: "Only the saved copy is removed. The Tofu's current files are not touched.", items: [`${when(snapshot.createdAt)} · ${snapshot.reason}`] })) return;
    await run(() => deleteTofuSnapshot(tofu.id, snapshot.id), t("Could not delete the snapshot"));
  };
  const take = () => run(async () => {
    const made = await createTofuSnapshot(tofu.id, snapshotFolders(tofu), "Manual snapshot");
    notify(made.reused ? "Nothing changed" : "Snapshot saved", made.reused ? "The latest snapshot already matches the current mods." : `${made.files} files · ${formatBytes(made.size)}.`);
  }, "Could not save a snapshot");

  const last = snapshots ? lastWorkingSnapshot(snapshots) : undefined;
  return <div className="tofu-snapshots">
    <div className="tofu-snapshots-actions">
      <button type="button" className="play-button" disabled={busy || !last} onClick={() => last && void restore(last)} title={last ? `Back to ${when(last.createdAt)}` : t("No snapshot yet")}><History size={14}/> {t("Restore last working state")}</button>
      <button type="button" className="secondary-button" disabled={busy || !tofu.path} onClick={() => void take()}><Camera size={14}/> {t("Take snapshot now")}</button>
    </div>
    {error && <p className="metadata-note" role="alert">{error}</p>}
    {snapshots === null ? <p className="muted" role="status">{t("Loading snapshots…")}</p>
      : !snapshots.length ? <p className="muted">{t("No snapshots yet. One is saved automatically before mods are updated.")}</p>
      : <ul className="tofu-snapshot-list" aria-label={t("Snapshots")}>{snapshots.map((snapshot) => <li key={snapshot.id} className="tofu-snapshot">
        <div className="tofu-snapshot-text"><strong>{snapshot.reason || t("Snapshot")}</strong><small>{when(snapshot.createdAt)} · {snapshot.files} mod{snapshot.files === 1 ? "" : "s"} · {formatBytes(snapshot.size)}{snapshot.isRestore ? " · safety copy" : ""}</small></div>
        <div className="tofu-snapshot-buttons">
          <button type="button" className="secondary-button" disabled={busy} aria-label={`Restore the snapshot from ${when(snapshot.createdAt)}`} onClick={() => void restore(snapshot)}><RotateCcw size={14}/> Restore</button>
          <button type="button" className="icon-button" disabled={busy} aria-label={`Delete the snapshot from ${when(snapshot.createdAt)}`} title={t("Delete")} onClick={() => void remove(snapshot)}><Trash2 size={14}/></button>
        </div>
      </li>)}</ul>}
  </div>;
}
