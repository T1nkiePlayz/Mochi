import { memo } from "react";
import { ArrowUpCircle, Check, Download, Eye, ExternalLink, PackageOpen, RefreshCw } from "lucide-react";
import type { InstallState } from "../../lib/mods/installState";
import { openExternalUrl } from "../../lib/platform";
import { sourceLabels, type ModItem } from "../../lib/mods/types";
import { DiscoveryImage } from "../discover/DiscoveryImage";

type Props = {
  item: ModItem;
  /** "Download" (into the selected Tofu) or "Choose Tofu instance" (Discover). */
  actionLabel: string;
  busy?: boolean;
  /** Show which site (and game) the mod comes from: lists that mix sites or games. */
  showSource?: boolean;
  onView: (item: ModItem) => void;
  onAction: (item: ModItem) => void;
  /** Whether the mod is already in the target Tofu (game pages); Discover leaves it out. */
  state?: InstallState;
  onUpdate?: (item: ModItem) => void;
};

/** The main button of a card: Download, Downloading (progress), Downloaded (disabled) or Update. */
function ActionButton({ item, actionLabel, busy, state, onAction, onUpdate }: Pick<Props, "item" | "actionLabel" | "busy" | "state" | "onAction" | "onUpdate">) {
  if (state?.kind === "downloading") {
    const percent = state.progress != null ? Math.round(state.progress * 100) : null;
    return <button type="button" className="secondary-button mod-action is-downloading" disabled aria-busy="true" aria-label={`Downloading ${item.name}${percent != null ? `, ${percent}%` : ""}`}
      style={percent != null ? { ["--mod-progress" as string]: `${percent}%` } : undefined}><RefreshCw size={13} className="spin" /> Downloading{percent != null ? ` ${percent}%` : "…"}</button>;
  }
  if (state?.kind === "installed") {
    return <button type="button" className="secondary-button mod-action is-installed" disabled aria-label={`${item.name} is downloaded${state.version ? `, version ${state.version}` : ""}`} title={state.enabled ? undefined : "Downloaded, currently disabled"}><Check size={13} /> Downloaded</button>;
  }
  if (state?.kind === "update" && onUpdate) {
    return <button type="button" className="secondary-button mod-action is-update" onClick={() => onUpdate(item)} disabled={busy} aria-label={`Update ${item.name} to ${state.update.newVersion}`} title={`${state.version ?? state.update.currentVersion} to ${state.update.newVersion}`}><ArrowUpCircle size={13} /> Update available</button>;
  }
  return <button type="button" className="secondary-button mod-action" onClick={() => onAction(item)} disabled={busy} aria-label={`${actionLabel}: ${item.name}`}><Download size={13} /> {actionLabel}</button>;
}

/** One mod from any source. Reuses the Discover card classes so every theme styles it the same way. */
export const ModCard = memo(function ModCard({ item, actionLabel, busy, showSource, onView, onAction, state, onUpdate }: Props) {
  const site = sourceLabels[item.source];
  return <article className={`discover-card mod-card${state && state.kind !== "none" ? ` is-${state.kind}` : ""}`}>
    {item.iconUrl ? <DiscoveryImage src={item.iconUrl} className="discover-card-icon" alt="" label={item.name} /> : <div className="discover-card-icon fallback"><PackageOpen size={20} /></div>}
    <div className="discover-card-copy">
      <div className="discover-card-title"><strong title={item.name}>{item.name}</strong><span>{showSource ? site : item.kind ?? site}</span></div>
      {showSource && item.game && <small className="mod-game-label">{item.game}</small>}
      <small>{item.author || `${site} creator`}{item.downloads != null ? ` · ${item.downloads.toLocaleString()} downloads` : ""}</small>
      <p>{item.summary || "No summary was provided."}</p>
      <div className="discover-card-actions">
        <button type="button" className="secondary-button" onClick={() => onView(item)} aria-label={`View ${item.name}`}><Eye size={13} /> View</button>
        <ActionButton item={item} actionLabel={actionLabel} busy={busy} state={state} onAction={onAction} onUpdate={onUpdate} />
        <button type="button" className="icon-button" onClick={() => void openExternalUrl(item.pageUrl).catch(() => undefined)} aria-label={`View ${item.name} on ${site}`} title={`View on ${site}`}><ExternalLink size={13} /></button>
      </div>
    </div>
  </article>;
});
