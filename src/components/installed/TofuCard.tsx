import { ChevronDown, ChevronRight, Download, FolderOpen, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import { GameArtwork } from "../GameArtwork";
import { formatBytes, type Row } from "./data";
import { loaderLabels, tofuTarget } from "../../lib/mods/compat";
import { sourceLabels } from "../../lib/mods/types";
import { installableUpdates, type ModUpdateItem } from "../../lib/mods/updates";
import { getUpdateState } from "../../state/modUpdates";

/** Updates found for a row's Tofu (read from the shared update state; callers re-render through `useUpdateVersion`). */
export const updatesOf = (row: Row): ModUpdateItem[] => getUpdateState(row.tofu.id).check?.items ?? [];

export function TofuCard({ row, busy, onCheck, onUpdate, onUpdateAll, onOpen, onManage }: {
  row: Row; busy: boolean;
  onCheck: () => void; onUpdate: (mod: ModUpdateItem) => void; onUpdateAll: () => void; onOpen: () => void; onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const state = getUpdateState(row.tofu.id);
  const updates = updatesOf(row);
  const installable = installableUpdates(updates);
  const enabled = row.files.filter((file) => file.enabled).length;
  const disabled = row.files.length - enabled;
  const { loader, gameVersion } = tofuTarget(row.tofu);
  const detailId = `inst-${row.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <li className="inst-card">
      <div className="inst-main">
        <GameArtwork className="inst-thumb" cacheKey={row.piko.artworkCacheKey} fallback={row.piko.artwork} />
        <div className="inst-title">
          <h3>{row.piko.name}</h3>
          <p>{row.tofu.name}{gameVersion ? ` · ${gameVersion}` : row.tofu.version ? ` · ${row.tofu.version}` : ""}{loader ? ` · ${loaderLabels[loader]}` : ""}</p>
          <code title={row.path}>{row.path}</code>
        </div>
        <dl className="inst-stats">
          <div><dt>Mods</dt><dd>{row.state === "loading" ? <span className="inst-skel" /> : row.state === "error" ? "Unreadable" : row.files.length}</dd></div>
          <div><dt>Enabled</dt><dd>{row.state === "ready" ? `${enabled}${disabled ? ` / ${disabled} off` : ""}` : "None"}</dd></div>
          <div><dt>Disk</dt><dd>{row.state === "loading" ? <span className="inst-skel" /> : row.size ? `${row.size.truncated ? "at least " : ""}${formatBytes(row.size.bytes)}` : "Unknown"}</dd></div>
        </dl>
      </div>
      <div className="inst-actions">
        <span className={`inst-badge ${updates.length ? "has-updates" : ""}`} role="status">
          {state.status === "checking" ? "Checking" : state.status === "done" ? (updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"}` : state.check?.notes.length ? "Check incomplete" : "Up to date") : row.state === "error" ? "Folder missing" : "Not checked"}
        </span>
        <button type="button" className="secondary-button" onClick={onCheck} disabled={busy || state.status === "checking" || !row.files.length}><RefreshCw size={13} className={state.status === "checking" ? "spin" : ""} /> Check</button>
        {installable.length > 0 && <button type="button" className="secondary-button" onClick={onUpdateAll} disabled={busy}><Download size={13} /> Update {installable.length === 1 ? "mod" : `all ${installable.length}`}</button>}
        <button type="button" className="secondary-button" onClick={onOpen}><FolderOpen size={13} /> Open folder</button>
        <button type="button" className="secondary-button" onClick={onManage}><Settings2 size={13} /> Manage</button>
        {updates.length > 1 && <button type="button" className="inst-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details</button>}
      </div>
      {state.check?.notes.length && !updates.length ? <p className="inst-error" role="status">{state.check.notes[0]}</p> : null}
      {(open || updates.length === 1) && updates.length > 0 && (
        <ul className="inst-updates" id={detailId}>
          {updates.map((mod) => (
            <li key={mod.path}>
              <span><strong>{mod.title}</strong> {mod.currentVersion} to {mod.newVersion} · {sourceLabels[mod.source]}</span>
              {mod.apply.kind === "download"
                ? <button type="button" className="secondary-button" disabled={busy || state.updating.includes(mod.path)} onClick={() => onUpdate(mod)} aria-label={`Update ${mod.title}`}>
                  {state.updating.includes(mod.path) ? <RefreshCw size={12} className="spin" /> : <Download size={12} />} Update
                </button>
                : <button type="button" className="secondary-button" onClick={onManage} aria-label={`Open ${mod.title} to update by hand`} title={mod.apply.reason}>Open</button>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
