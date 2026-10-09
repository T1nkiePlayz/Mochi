import { useMemo, useState } from "react";
import { ArrowUpCircle, ExternalLink, Link2, Power, RotateCcw, ScanSearch, Search, Trash2 } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { deleteModFile } from "../../lib/modrinth";
import { rollbackModUpdate, setInstanceModsEnabled, type InstanceMod } from "../../lib/mods/instances";
import { openExternalUrl } from "../../lib/platform";
import { sourceLabels } from "../../lib/mods/types";
import type { ContentFolder } from "../../lib/mods/targets";
import { applyUpdates, useTofuUpdates } from "../../state/modUpdates";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { supabase } from "../../lib/supabase";
import { needsIdentification, scanTofuMods } from "../../lib/mods/scanService";
import { Checkbox } from "../ui/Checkbox";
import { confirmAction } from "../../lib/confirm";
import { LinkModModal } from "./LinkModModal";

type Props = {
  piko: Piko;
  tofu: Tofu;
  folder: ContentFolder;
  /** Updates are tracked for the main mod folder only. */
  withUpdates: boolean;
  files: InstanceMod[];
  loading: boolean;
  refresh: () => Promise<void>;
  onMessage: (message: string) => void;
};

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);

/** The files of one Tofu folder: enable/disable one, many or all, delete, update and roll back. */
export function InstalledModsPanel({ piko, tofu, folder, withUpdates, files: allFiles, loading, refresh, onMessage }: Props) {
  const { behavior, credentials } = useApp();
  const [showForeign, setShowForeign] = useState(false);
  const [linking, setLinking] = useState<InstanceMod | null>(null);
  const [scanning, setScanning] = useState(false);
  const foreignCount = allFiles.filter((file) => file.foreign).length;
  // Mods of the other Tofus on this folder are off while this Tofu is active; they are only listed on request.
  const files = useMemo(() => (showForeign ? allFiles : allFiles.filter((file) => !file.foreign)), [allFiles, showForeign]);
  const unknown = files.filter(needsIdentification).length;
  const identify = async () => {
    setScanning(true);
    try {
      const result = await scanTofuMods(piko, tofu, behavior.modSources, credentials.status.nexus && Boolean(supabase));
      onMessage(!result.online ? "You are offline. Mochi will identify these mods when you are back online."
        : `Identified ${result.identified} of ${result.identified + result.unidentified} mod${result.identified + result.unidentified === 1 ? "" : "s"}.${result.notes.length ? ` ${result.notes[0]}` : ""}`);
    } catch (error) { onMessage(errorText(error, "Could not identify the mods.")); }
    await refresh();
    setScanning(false);
  };
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const updates = useTofuUpdates(withUpdates ? tofu.id : undefined);
  const updateByPath = useMemo(() => new Map((updates.check?.items ?? []).map((item) => [item.path, item])), [updates.check]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((file) => `${file.filename} ${file.record?.title ?? ""}`.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const enabledCount = files.filter((file) => file.enabled).length;
  const chosen = files.filter((file) => selected.has(file.path));
  const own = files.filter((file) => !file.foreign);

  const run = async (job: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try { await job(); } catch (error) { onMessage(errorText(error, failure)); }
    await refresh();
    setBusy(false);
  };
  const setEnabled = (targets: InstanceMod[], enabled: boolean) => run(async () => {
    const todo = targets.filter((file) => file.enabled !== enabled);
    if (!todo.length) return;
    const result = await setInstanceModsEnabled(tofu.id, todo.map((file) => file.path), enabled);
    setSelected(new Set());
    if (result.failed.length) onMessage(`${result.failed.length} could not be changed: ${result.failed[0]}`);
    else onMessage(`${enabled ? "Enabled" : "Disabled"} ${result.changed} file${result.changed === 1 ? "" : "s"}.`);
  }, "Unable to change the files.");
  const toggleSelected = (path: string) => setSelected((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const allVisibleSelected = visible.length > 0 && visible.every((file) => selected.has(file.path));

  return <div className="imp">
    <div className="workspace-section-title"><strong>Installed</strong><span>{files.length} · {enabledCount} on{files.length - enabledCount ? ` · ${files.length - enabledCount} off` : ""}</span></div>
    {files.length > 0 && <div className="imp-toolbar">
      <label className="search-box"><Search size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter installed" aria-label="Filter installed files" /></label>
      <Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && visible.some((file) => selected.has(file.path))} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((file) => file.path)))} label="Select all" />
      {chosen.length > 0
        ? <><button type="button" className="secondary-button" disabled={busy} onClick={() => void setEnabled(chosen, true)}>Enable {chosen.length}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void setEnabled(chosen, false)}>Disable {chosen.length}</button></>
        : <><button type="button" className="secondary-button" disabled={busy || own.every((file) => file.enabled)} onClick={() => void setEnabled(own, true)}>Enable all</button><button type="button" className="secondary-button" disabled={busy || !own.some((file) => file.enabled)} onClick={() => void setEnabled(own, false)}>Disable all</button></>}
      {unknown > 0 && withUpdates && <button type="button" className="secondary-button" disabled={scanning} onClick={() => void identify()} title="Look the unknown files up on Modrinth, CurseForge and Nexus Mods"><ScanSearch size={13} className={scanning ? "spin" : ""} /> Identify {unknown}</button>}
    </div>}
    <ul className="imp-list">
      {visible.map((file) => {
        const update = updateByPath.get(file.path);
        const record = file.record;
        const title = record?.title || file.filename.replace(/\.disabled$/, "");
        return <li key={file.path} className={`imp-row ${file.enabled ? "" : "is-off"}`}>
          <Checkbox ariaLabel={`Select ${title}`} checked={selected.has(file.path)} onChange={() => toggleSelected(file.path)} />
          <span className="imp-name">
            <strong title={file.filename}>{title}</strong>
            <small>
              {record?.version ? `${record.version} · ` : ""}{file.filename.replace(/\.disabled$/, "")} · {formatBytes(file.size)}
              {record && record.source !== "manual" ? ` · ${sourceLabels[record.source]}` : ""}{file.enabled ? "" : " · disabled"}{file.foreign ? " · another Tofu's mod" : ""}
            </small>
          </span>
          {!file.foreign && needsIdentification(file) && <button type="button" className="secondary-button imp-link" aria-label={`Identify ${title}`} title="Not identified yet: pick the mod on CurseForge, Modrinth or Nexus Mods" onClick={() => setLinking(file)}><Link2 size={13} /> Identify</button>}
          {update && <span className="imp-badge" role="status">Update available: {update.newVersion}</span>}
          {update && update.apply.kind === "download" && <button type="button" className="secondary-button" disabled={busy || updates.updating.includes(file.path)} aria-label={`Update ${title}`} onClick={() => void run(() => applyUpdates(tofu, [update]), "Update failed.")}><ArrowUpCircle size={13} /> Update</button>}
          {update && update.apply.kind === "manual" && <button type="button" className="secondary-button" aria-label={`Open ${title} on its site`} title={update.apply.reason} onClick={() => void openExternalUrl((update.apply as { pageUrl: string }).pageUrl).catch(() => undefined)}><ExternalLink size={13} /> Get update</button>}
          {record?.rollback && <button type="button" className="icon-button" aria-label={`Roll ${title} back to ${record.rollback.version || "the previous version"}`} title={`Roll back to ${record.rollback.version || "the previous version"}`} disabled={busy} onClick={() => void run(async () => { await rollbackModUpdate(tofu.id, folder.path, record.file, folder.subdir); onMessage(`Restored the earlier version of ${title}.`); }, "Unable to roll back.")}><RotateCcw size={14} /></button>}
          <button type="button" role="switch" aria-checked={file.enabled} className={`imp-switch ${file.enabled ? "on" : ""}`} aria-label={`${file.enabled ? "Disable" : "Enable"} ${title}`} title={file.enabled ? "Disable (kept, just not loaded)" : "Enable"} disabled={busy} onClick={() => void setEnabled([file], !file.enabled)}><Power size={14} /></button>
          <button type="button" className="icon-button" aria-label={`Delete ${title}`} title="Delete" disabled={busy} onClick={() => void confirmAction({ title: "Delete mod?", message: `${file.filename.replace(/\.disabled$/, "")} will be removed from this game's mods folder.`, confirmLabel: "Delete", danger: true }).then((ok) => { if (ok) void run(() => deleteModFile(file.path), "Unable to delete the file."); })}><Trash2 size={14} /></button>
        </li>;
      })}
    </ul>
    {foreignCount > 0 && <Checkbox className="imp-foreign" checked={showForeign} onChange={setShowForeign} label={`Show ${foreignCount} mod${foreignCount === 1 ? "" : "s"} of other Tofus`} description="They stay off while this Tofu is active. Turning one on adds it to this Tofu." />}
    {linking && <LinkModModal piko={piko} tofu={tofu} file={linking} subdir={folder.subdir ?? ""} onLinked={(text) => { onMessage(text); void refresh(); }} onClose={() => setLinking(null)} />}
    {!files.length && <p className="muted">{loading ? "Reading the folder..." : "Nothing installed in this folder yet."}</p>}
    {files.length > 0 && !visible.length && <p className="muted">No installed file matches that filter.</p>}
  </div>;
}
