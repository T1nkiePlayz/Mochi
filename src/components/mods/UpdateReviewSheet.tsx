import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, X } from "lucide-react";
import { openExternalUrl } from "../../lib/platform";
import type { DependencyPlan } from "../../lib/mods/dependencies";
import { assembleWarnings, defaultSelection, missingDependencies, selectedItems } from "../../lib/mods/updatePlan";
import type { ModUpdateItem } from "../../lib/mods/updates";
import { sourceLabels } from "../../lib/mods/types";
import type { Piko, Tofu } from "../../models";
import { applyUpdates, useTofuUpdates, type ApplyResult } from "../../state/modUpdates";
import { Checkbox } from "../ui/Checkbox";
import { ModalShell } from "./ModalShell";
import { ChangelogBody } from "./UpdateChangelog";
import { modSupportOf } from "../../lib/mods/gameSupport";

type Summary = ApplyResult & { dependencies: number; dependencyFailures: Array<{ name: string; error: string }> };

/** Review before "Update all": pick mods, see changelogs and warnings, then apply (one snapshot first). */
export function UpdateReviewSheet({ tofu, piko, items, onClose, onDone }: { tofu: Tofu; piko?: Piko; items: readonly ModUpdateItem[]; onClose: () => void; onDone: () => Promise<void> }) {
  const state = useTofuUpdates(tofu.id);
  const [rows] = useState(items);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => defaultSelection(items));
  const [plans, setPlans] = useState<ReadonlyMap<string, DependencyPlan>>(new Map());
  const [addDeps, setAddDeps] = useState(true);
  const [phase, setPhase] = useState<"review" | "applying" | "done">("review");
  const [summary, setSummary] = useState<Summary>();
  const [open, setOpen] = useState<string>();

  // Dependencies of the new versions: looked up once, in the background, bounded (3 at a time inside planUpdateDependencies).
  useEffect(() => {
    let live = true;
    void import("../../lib/mods/updateService").then((service) => service.planUpdateDependencies(tofu, rows, piko ? modSupportOf(piko) === "minecraft" : false)).then((found) => { if (live) setPlans(found); }).catch(() => undefined);
    return () => { live = false; };
  }, [tofu, piko, rows]);

  const chosen = useMemo(() => selectedItems(rows, selected), [rows, selected]);
  const warnings = useMemo(() => assembleWarnings(rows, selected, plans), [rows, selected, plans]);
  const missing = useMemo(() => missingDependencies(rows, selected, plans), [rows, selected, plans]);
  const installableRows = rows.filter((item) => item.apply.kind === "download");
  const toggle = (path: string, on: boolean) => setSelected((previous) => { const next = new Set(previous); if (on) next.add(path); else next.delete(path); return next; });
  const finished = chosen.filter((item) => !state.check?.items.some((entry) => entry.path === item.path)).length;

  const apply = async () => {
    setPhase("applying");
    const result = await applyUpdates(tofu, chosen);
    let dependencies = 0; let dependencyFailures: Summary["dependencyFailures"] = [];
    if (addDeps && missing.length && result.updated > 0) {
      const installed = await (await import("../../lib/mods/updateService")).installUpdateDependencies(tofu, missing);
      dependencies = installed.queued; dependencyFailures = installed.failed;
    }
    setSummary({ ...result, dependencies, dependencyFailures });
    setPhase("done");
    await onDone();
  };
  const busy = phase === "applying";
  const close = () => { if (!busy) onClose(); };

  return <ModalShell label="Review updates" className="tofu-picker-window dependency-sheet update-review" onClose={close}>
    <div className="modal-header"><div><p className="eyebrow">{tofu.name}</p><h2>Review updates</h2></div><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={close}><X size={17} /></button></div>
    <div className="dep-body">
      {phase === "done" && summary ? <div role="status">
        <p className="modal-description"><CheckCircle2 size={14} aria-hidden="true" /> Updated {summary.updated} mod{summary.updated === 1 ? "" : "s"}{summary.dependencies ? `; ${summary.dependencies} dependenc${summary.dependencies === 1 ? "y" : "ies"} queued for download` : ""}.</p>
        {[...summary.failed.map((entry) => ({ name: entry.title, error: entry.error })), ...summary.dependencyFailures].map((entry) => <p key={entry.name} className="metadata-note dep-warning" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {entry.name}: {entry.error}</p>)}
        <p className="metadata-note">A snapshot was taken first. Restore it from Tofu settings if something is wrong.</p>
      </div> : <>
        <p className="modal-description">A snapshot will be taken first; you can restore it from Tofu settings. Every file is checked before it replaces the old one.</p>
        {warnings.map((warning) => <p key={warning.id} className={`metadata-note dep-warning ${warning.tone === "info" ? "dep-note" : ""}`} role={warning.tone === "warning" ? "alert" : "note"}>{warning.tone === "warning" ? <AlertTriangle size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />} <span>{warning.message}</span>{warning.url && <button type="button" className="secondary-button dep-link" onClick={() => void openExternalUrl(warning.url!).catch(() => undefined)}>View</button>}</p>)}
        {missing.length > 0 && <div className="metadata-note"><Checkbox checked={addDeps} disabled={busy} onChange={setAddDeps} label={`Also install ${missing.length} missing dependenc${missing.length === 1 ? "y" : "ies"}`} description={missing.map((entry) => `${entry.name} (needed by ${entry.requiredBy})`).join(", ")} /></div>}
        <ul className="dep-list" aria-label="Updates">
          {rows.map((item) => <li key={item.path} className="dep-row update-review-row" data-status={item.apply.kind === "download" ? "install" : "unavailable"}>
            <Checkbox checked={selected.has(item.path)} disabled={busy || item.apply.kind !== "download"} onChange={(on) => toggle(item.path, on)} label={item.title} description={`${item.currentVersion} to ${item.newVersion} · ${sourceLabels[item.source]}${item.apply.kind === "download" ? "" : " · manual"}`} />
            <button type="button" className="update-changelog-toggle" aria-expanded={open === item.path} onClick={() => setOpen(open === item.path ? undefined : item.path)}>Changelog</button>
            {open === item.path && <div className="update-changelog-body update-review-log"><ChangelogBody item={item} active /></div>}
          </li>)}
        </ul>
      </>}
    </div>
    <div className="mod-download-actions dep-actions">
      {phase === "done"
        ? <button type="button" className="play-button" onClick={onClose} data-autofocus>Close</button>
        : <><button type="button" className="play-button" disabled={busy || !chosen.length} onClick={() => void apply()} data-autofocus>{busy ? <><RefreshCw size={13} className="spin" /> Updating {finished} of {chosen.length}</> : `Update ${chosen.length} mod${chosen.length === 1 ? "" : "s"}`}</button>
          <button type="button" className="secondary-button" disabled={busy || !installableRows.length} onClick={() => setSelected(selected.size === installableRows.length ? new Set() : defaultSelection(rows))}>{selected.size === installableRows.length ? "Select none" : "Select all"}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button></>}
    </div>
  </ModalShell>;
}
