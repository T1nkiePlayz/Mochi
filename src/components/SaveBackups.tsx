import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, DatabaseBackup, FolderOpen, FolderPlus, History, RotateCcw, Trash2, X } from "lucide-react";
import {
  addFolder, autoBackupEnabled, BACKUP_KIND_LABEL, createSaveBackup, deleteSaveBackup, describeResult, getBackupSettings, groupLocations, listSaveBackups, listSaveLocations,
  removeFolder, restoreSaveBackup, saveHints, setBackupSettings, type BackupInfo, type BackupSettings, type SaveLocation,
} from "../lib/saveBackups";
import { formatBytes } from "../lib/format";
import { openPath } from "../lib/platform";
import { confirmAction } from "../lib/confirm";
import type { Piko } from "../models";
import { useApp } from "../state/AppContext";
import { ModalShell } from "./mods/ModalShell";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.");
const GB = 1 << 30;

/** "Saves" button for a game page and the dialog it opens: save folders, their backups, back up now / restore / delete. */
export function SaveBackupsButton({ game }: { game: Piko }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setOpen(true)}><DatabaseBackup size={14} /> Saves</button>
    {open && <SaveBackupsModal game={game} onClose={() => setOpen(false)} />}
  </>;
}

function SaveBackupsModal({ game, onClose }: { game: Piko; onClose: () => void }) {
  const { lib, sessions } = useApp();
  const running = sessions.isRunning(game.id);
  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [expanded, setExpanded] = useState("");
  const [backups, setBackups] = useState<Record<string, BackupInfo[]>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [keep, setKeep] = useState("10");
  const [cap, setCap] = useState("2");
  const seq = useRef(0);
  const hintsKey = JSON.stringify(saveHints(game));
  const auto = autoBackupEnabled(game);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try { const next = await listSaveLocations(game.id, JSON.parse(hintsKey)); if (mine === seq.current) setLocations(next); }
    catch (error) { if (mine === seq.current) { setLocations([]); setMessage(errorText(error)); } }
  }, [game.id, hintsKey]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void getBackupSettings().then((next) => { setSettings(next); setKeep(String(next.keep)); setCap(String(Math.round(next.maxTotalBytes / GB * 10) / 10)); }).catch(() => {}); }, []);

  const loadBackups = useCallback(async (key: string) => {
    try { const list = await listSaveBackups(key); setBackups((current) => ({ ...current, [key]: list })); }
    catch (error) { setMessage(errorText(error)); }
  }, []);
  const toggle = (key: string) => { const next = expanded === key ? "" : key; setExpanded(next); if (next) void loadBackups(next); };
  const refresh = async (key: string) => { await Promise.all([load(), loadBackups(key)]); };

  const patchGame = (change: (saveBackup: NonNullable<Piko["saveBackup"]>) => NonNullable<Piko["saveBackup"]>) =>
    lib.setLibrary((current) => current.map((piko) => (piko.id === game.id ? { ...piko, saveBackup: change(piko.saveBackup ?? {}) } : piko)));

  const add = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: `Choose a save folder for ${game.name}` });
      if (typeof picked === "string") patchGame((current) => ({ ...current, folders: addFolder(current.folders, picked) }));
    } catch (error) { setMessage(errorText(error)); }
  };

  const backUp = async (location: SaveLocation) => {
    setBusy(location.key); setMessage("");
    try { setMessage(describeResult(await createSaveBackup(game.id, location))); await refresh(location.key); }
    catch (error) { setMessage(errorText(error)); } finally { setBusy(""); }
  };
  const restore = async (location: SaveLocation, backup: BackupInfo) => {
    if (!await confirmAction({ title: `Restore "${location.label}"?`, confirmLabel: "Restore", danger: true,
      message: `The saves in this folder are replaced by the backup from ${when(backup.createdAt)}. Mochi first backs up the current saves (kept as "Before restore"), so you can undo this.`, items: [location.path] })) return;
    setBusy(location.key); setMessage("");
    try { const result = await restoreSaveBackup(backup.id); setMessage(`Restored ${result.files} file${result.files === 1 ? "" : "s"}.${result.safety ? " Your previous saves were kept as a backup." : ""}`); await refresh(location.key); }
    catch (error) { setMessage(errorText(error)); } finally { setBusy(""); }
  };
  const remove = async (location: SaveLocation, backup: BackupInfo) => {
    if (!await confirmAction({ title: "Delete this backup?", confirmLabel: "Delete backup", danger: true, message: "The backup file is deleted from this computer. The saves themselves are not touched.", items: [`${location.label}, ${when(backup.createdAt)} (${formatBytes(backup.size)})`] })) return;
    try { await deleteSaveBackup(backup.id); await refresh(location.key); } catch (error) { setMessage(errorText(error)); }
  };
  const applyLimits = async () => {
    const next = { keep: Math.round(Number(keep)), maxTotalBytes: Math.round(Number(cap) * GB) };
    if (!Number.isFinite(next.keep) || !Number.isFinite(next.maxTotalBytes) || next.keep < 1) { setMessage("Enter how many backups to keep (1 or more) and a size limit in GB."); return; }
    try { const saved = await setBackupSettings(next); setSettings(saved); setKeep(String(saved.keep)); setCap(String(Math.round(saved.maxTotalBytes / GB * 10) / 10)); setMessage("Limits saved. Older backups beyond them were removed."); void load(); }
    catch (error) { setMessage(errorText(error)); }
  };

  const groups = groupLocations(locations ?? []);
  return <ModalShell label={`${game.name} saves`} className="modal save-backups-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{game.name}</p><h2>Save backups</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <div className="save-backups-toolbar">
      <label className="check-row"><input type="checkbox" checked={auto} onChange={(event) => patchGame((current) => ({ ...current, auto: event.target.checked }))} /> Back up saves when the game closes</label>
      <button type="button" className="secondary-button" onClick={() => void add()}><FolderPlus size={13} /> Add folder</button>
    </div>
    {message && <p className="metadata-note" role="status">{message}</p>}
    <div className="save-backups-body">
      {locations === null ? <p className="muted save-backups-empty">Looking for saves...</p>
        : !groups.length ? <p className="muted save-backups-empty">No save folders found yet. Add the folder your game keeps its saves in{game.id === "minecraft" ? ", or import a Minecraft instance first" : ""}.</p>
        : groups.map(([heading, items]) => <section key={heading} className="save-backups-group" aria-label={heading}>
          <h3>{heading}</h3>
          <ul className="save-backups-list">
            {items.map((location) => <li key={location.key} className="save-backups-item">
              <div className="save-backups-row">
                <button type="button" className="icon-button" aria-expanded={expanded === location.key} aria-label={`${expanded === location.key ? "Hide" : "Show"} backups of ${location.label}`} onClick={() => toggle(location.key)} disabled={Boolean(location.problem)}>{expanded === location.key ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                <div className="save-backups-name"><strong>{location.label}</strong><small className="muted" title={location.path}>{location.problem ?? location.path}</small>
                  <small className="muted">{location.backups ? `${location.backups} backup${location.backups === 1 ? "" : "s"} · ${formatBytes(location.backupBytes)} · last ${when(location.lastBackup ?? 0)}` : "No backups yet"}</small></div>
                <div className="save-backups-actions">
                  <button type="button" className="secondary-button" onClick={() => void backUp(location)} disabled={Boolean(location.problem) || busy === location.key}><History size={13} /> Back up now</button>
                  <button type="button" className="icon-button" aria-label={`Open folder of ${location.label}`} title="Open folder" onClick={() => void openPath(location.path).catch((error) => setMessage(errorText(error)))} disabled={Boolean(location.problem)}><FolderOpen size={15} /></button>
                  {location.kind === "custom" && <button type="button" className="icon-button" aria-label={`Stop backing up ${location.label}`} title="Remove from this list (backups are kept)" onClick={() => patchGame((current) => ({ ...current, folders: removeFolder(current.folders, location.source ?? location.path) }))}><X size={15} /></button>}
                </div>
              </div>
              {expanded === location.key && <ul className="save-backups-versions" aria-label={`Backups of ${location.label}`}>
                {(backups[location.key] ?? []).length === 0 && <li className="muted">No backups yet.</li>}
                {(backups[location.key] ?? []).map((backup) => <li key={backup.id}>
                  <span>{when(backup.createdAt)}</span><span className="chip">{BACKUP_KIND_LABEL[backup.kind]}</span><small className="muted">{formatBytes(backup.size)} · {backup.files} file{backup.files === 1 ? "" : "s"}</small>
                  <span className="save-backups-actions">
                    <button type="button" className="secondary-button" onClick={() => void restore(location, backup)} disabled={running || busy === location.key} title={running ? "Close the game before restoring" : undefined}><RotateCcw size={13} /> Restore</button>
                    <button type="button" className="icon-button" aria-label={`Delete backup from ${when(backup.createdAt)}`} title="Delete backup" onClick={() => void remove(location, backup)}><Trash2 size={15} /></button>
                  </span>
                </li>)}
              </ul>}
            </li>)}
          </ul>
        </section>)}
    </div>
    <div className="save-backups-limits">
      <label>Keep <input className="compact-input" type="number" min={1} max={100} value={keep} onChange={(event) => setKeep(event.target.value)} aria-label="Backups to keep per folder" /> backups per folder</label>
      <label>Total limit <input className="compact-input" type="number" min={0.1} max={200} step={0.1} value={cap} onChange={(event) => setCap(event.target.value)} aria-label="Total size limit in GB" /> GB</label>
      <button type="button" className="secondary-button" onClick={() => void applyLimits()} disabled={!settings}>Apply</button>
    </div>
    <small className="metadata-note">Backups are zip files stored on this computer. Restoring always keeps your current saves as a backup first. Shortcuts and links inside save folders are skipped.</small>
  </ModalShell>;
}
