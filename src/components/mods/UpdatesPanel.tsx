import { useState } from "react";
import { ArrowUpCircle, ExternalLink, PackageOpen, RefreshCw } from "lucide-react";
import { RemoteImage } from "../RemoteImage";
import { openExternalUrl } from "../../lib/platform";
import { installableUpdates } from "../../lib/mods/updates";
import { sourceLabels } from "../../lib/mods/types";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { applyUpdates, ensureChecked, useTofuUpdates } from "../../state/modUpdates";
import { Switch } from "../ui/Checkbox";
import { ChangelogToggle } from "./UpdateChangelog";
import { UpdateReviewSheet } from "./UpdateReviewSheet";

/** Update check results for one Tofu: per-mod Update buttons, "Update all", manual links, and the automatic-update switch. */
export function UpdatesPanel({ tofu, piko, onRefresh }: { tofu: Tofu; piko?: Piko; onRefresh: () => Promise<void> }) {
  const { behavior, setBehavior } = useApp();
  const state = useTofuUpdates(tofu.id);
  const items = state.check?.items ?? [];
  const installable = installableUpdates(items);
  const checking = state.status === "checking";
  const working = state.updating.length > 0;

  const [reviewing, setReviewing] = useState(false);
  const updateOne = async (index: number) => { await applyUpdates(tofu, [items[index]]); await onRefresh(); };

  if (!tofu.path) return <p className="muted">Choose a mod folder to check for updates.</p>;
  return <div className="updates-panel">
    <p className="muted">Mochi looks for newer versions of your mods on Modrinth (by file hash) and on CurseForge and Nexus Mods (for files it downloaded). Every update is checked against its SHA-1 and the old file is kept so you can roll back.</p>
    <div className="modrinth-controls">
      <button type="button" className="secondary-button" onClick={() => void ensureChecked(tofu, piko, behavior.modSources, true)} disabled={checking || working}><RefreshCw size={14} className={checking ? "spin" : ""} /> {checking ? "Checking..." : "Check now"}</button>
      {installable.length > 1 && <button type="button" className="secondary-button" onClick={() => setReviewing(true)} disabled={checking || working}><ArrowUpCircle size={13} /> Update all ({installable.length})</button>}
    </div>
    <Switch checked={behavior.autoUpdateMods} onChange={(on) => setBehavior((current) => ({ ...current, autoUpdateMods: on }))} label="Automatically update mods when I launch a game"
      description="Off by default. When on, Mochi checks for updates and installs them right before the game starts (never while it runs)." />
    {state.message && <p className="metadata-note" role="status">{state.message}</p>}
    {state.check && !checking && !items.length && <p className="metadata-note" role="status">{state.check.notes.length ? "Could not finish checking." : "Everything Mochi can identify is up to date."}</p>}
    <ul className="imp-list">
      {items.map((item, index) => <li key={item.path} className="imp-row">
        {item.iconUrl ? <RemoteImage className="update-icon" src={item.iconUrl} alt="" /> : <span className="update-icon fallback"><PackageOpen size={15} /></span>}
        <span className="imp-name"><strong>{item.title}</strong><small>{item.currentVersion} to {item.newVersion} · {sourceLabels[item.source]}{item.enabled ? "" : " · disabled"}</small><ChangelogToggle item={item} /></span>
        {item.apply.kind === "download"
          ? <button type="button" className="secondary-button" disabled={checking || state.updating.includes(item.path)} aria-label={`Update ${item.title}`} onClick={() => void updateOne(index)}>{state.updating.includes(item.path) ? <RefreshCw size={13} className="spin" /> : <ArrowUpCircle size={13} />} Update</button>
          : <button type="button" className="secondary-button" aria-label={`Open ${item.title} on ${sourceLabels[item.source]}`} title={item.apply.reason} onClick={() => void openExternalUrl((item.apply as { pageUrl: string }).pageUrl).catch(() => undefined)}><ExternalLink size={13} /> Open page</button>}
      </li>)}
    </ul>
    {reviewing && <UpdateReviewSheet tofu={tofu} piko={piko} items={items} onClose={() => setReviewing(false)} onDone={onRefresh} />}
    {state.check?.notes.length ? <ul className="updates-notes">{state.check.notes.slice(0, 6).map((note) => <li key={note}>{note}</li>)}</ul> : null}
  </div>;
}
