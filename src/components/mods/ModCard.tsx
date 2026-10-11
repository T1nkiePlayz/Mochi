import { memo } from "react";
import { ArrowUpCircle, Check, Download, Eye, ExternalLink, PackageOpen, RefreshCw } from "lucide-react";
import type { InstallState } from "../../lib/mods/installState";
import { openExternalUrl } from "../../lib/platform";
import { sourceLabels, type ModItem } from "../../lib/mods/types";
import { DiscoveryImage } from "../discover/DiscoveryImage";
import { useTranslation } from "../../lib/useTranslation";

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
  const t = useTranslation();
  if (state?.kind === "downloading") {
    const percent = state.progress != null ? Math.round(state.progress * 100) : null;
    return <button type="button" className="secondary-button mod-action is-downloading" disabled aria-busy="true" aria-label={percent != null ? t("Downloading {name}, {percent}%").replace("{name}", item.name).replace("{percent}", String(percent)) : t("Downloading {name}").replace("{name}", item.name)}
      style={percent != null ? { ["--mod-progress" as string]: `${percent}%` } : undefined}><RefreshCw size={13} className="spin" /> Downloading{percent != null ? ` ${percent}%` : "…"}</button>;
  }
  if (state?.kind === "installed") {
    return <button type="button" className="secondary-button mod-action is-installed" disabled aria-label={state.version ? t("{name} is downloaded, version {version}").replace("{name}", item.name).replace("{version}", state.version) : t("{name} is downloaded").replace("{name}", item.name)} title={state.enabled ? undefined : t("Downloaded, currently disabled")}><Check size={13} /> Downloaded</button>;
  }
  if (state?.kind === "update" && onUpdate) {
    return <button type="button" className="secondary-button mod-action is-update" onClick={() => onUpdate(item)} disabled={busy} aria-label={t("Update {name} to {version}").replace("{name}", item.name).replace("{version}", state.update.newVersion)} title={t("{current} to {version}").replace("{current}", state.version ?? state.update.currentVersion).replace("{version}", state.update.newVersion)}><ArrowUpCircle size={13} /> Update available</button>;
  }
  return <button type="button" className="secondary-button mod-action" onClick={() => onAction(item)} disabled={busy} aria-label={t("{action}: {name}").replace("{action}", actionLabel).replace("{name}", item.name)}><Download size={13} /> {actionLabel}</button>;
}

/** One mod from any source. Reuses the Discover card classes so every theme styles it the same way. */
export const ModCard = memo(function ModCard({ item, actionLabel, busy, showSource, onView, onAction, state, onUpdate }: Props) {
  const t = useTranslation();
  const site = sourceLabels[item.source];
  return <article className={`discover-card mod-card${state && state.kind !== "none" ? ` is-${state.kind}` : ""}`}>
    {item.iconUrl ? <DiscoveryImage src={item.iconUrl} className="discover-card-icon" alt="" label={item.name} /> : <div className="discover-card-icon fallback"><PackageOpen size={20} /></div>}
    <div className="discover-card-copy">
      <div className="discover-card-title"><strong title={item.name}>{item.name}</strong><span>{showSource ? site : item.kind ?? site}</span></div>
      {showSource && item.game && <small className="mod-game-label">{item.game}</small>}
      <small>{item.author || t("{site} creator").replace("{site}", site)}{item.downloads != null ? ` · ${t("{count} downloads").replace("{count}", item.downloads.toLocaleString())}` : ""}</small>
      <p>{item.summary || t("No summary was provided.")}</p>
      <div className="discover-card-actions">
        <button type="button" className="secondary-button" onClick={() => onView(item)} aria-label={t("View {name}").replace("{name}", item.name)}><Eye size={13} /> View</button>
        <ActionButton item={item} actionLabel={actionLabel} busy={busy} state={state} onAction={onAction} onUpdate={onUpdate} />
        <button type="button" className="icon-button" onClick={() => void openExternalUrl(item.pageUrl).catch(() => undefined)} aria-label={t("View {name} on {site}").replace("{name}", item.name).replace("{site}", site)} title={t("View on {site}").replace("{site}", site)}><ExternalLink size={13} /></button>
      </div>
    </div>
  </article>;
});
