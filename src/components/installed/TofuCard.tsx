import { ChevronDown, ChevronRight, Download, FolderOpen, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import { GameArtwork } from "../GameArtwork";
import { formatBytes, tofuTarget, type Row } from "./data";
import type { ModAnalysis } from "../../lib/modrinth";

export const updatesOf = (row: Row) => (row.analysis ?? []).filter((item) => item.update);

export function TofuCard({ row, busy, onCheck, onUpdate, onUpdateAll, onOpen, onManage }: {
  row: Row; busy: boolean;
  onCheck: () => void; onUpdate: (mod: ModAnalysis) => void; onUpdateAll: () => void; onOpen: () => void; onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const updates = updatesOf(row);
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
          <p>{row.tofu.name}{gameVersion ? ` · ${gameVersion}` : row.tofu.version ? ` · ${row.tofu.version}` : ""}{loader ? ` · ${loader}` : ""}</p>
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
          {row.check === "checking" ? "Checking" : row.check === "error" ? "Check failed" : row.check === "done" ? (updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"}` : "Up to date") : row.state === "error" ? "Folder missing" : "Not checked"}
        </span>
        <button type="button" className="secondary-button" onClick={onCheck} disabled={busy || row.check === "checking" || !row.files.length}><RefreshCw size={13} className={row.check === "checking" ? "spin" : ""} /> Check</button>
        {updates.length > 0 && <button type="button" className="secondary-button" onClick={onUpdateAll} disabled={busy}><Download size={13} /> Update {updates.length === 1 ? "mod" : `all ${updates.length}`}</button>}
        <button type="button" className="secondary-button" onClick={onOpen}><FolderOpen size={13} /> Open folder</button>
        <button type="button" className="secondary-button" onClick={onManage}><Settings2 size={13} /> Manage</button>
        {updates.length > 1 && <button type="button" className="inst-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details</button>}
      </div>
      {row.checkError && <p className="inst-error" role="alert">{row.checkError}</p>}
      {(open || updates.length === 1) && updates.length > 0 && (
        <ul className="inst-updates" id={detailId}>
          {updates.map((mod) => (
            <li key={mod.path}>
              <span><strong>{mod.title}</strong> {mod.currentVersion} to {mod.update?.versionNumber}</span>
              <button type="button" className="secondary-button" disabled={busy || row.updating.has(mod.path)} onClick={() => onUpdate(mod)} aria-label={`Update ${mod.title}`}>
                {row.updating.has(mod.path) ? <RefreshCw size={12} className="spin" /> : <Download size={12} />} Update
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
