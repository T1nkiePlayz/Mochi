import { memo } from "react";
import { Download, Eye, ExternalLink, PackageOpen } from "lucide-react";
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
};

/** One mod from any source. Reuses the Discover card classes so every theme styles it the same way. */
export const ModCard = memo(function ModCard({ item, actionLabel, busy, showSource, onView, onAction }: Props) {
  const site = sourceLabels[item.source];
  return <article className="discover-card mod-card">
    {item.iconUrl ? <DiscoveryImage src={item.iconUrl} className="discover-card-icon" alt="" label={item.name} /> : <div className="discover-card-icon fallback"><PackageOpen size={20} /></div>}
    <div className="discover-card-copy">
      <div className="discover-card-title"><strong title={item.name}>{item.name}</strong><span>{showSource ? site : item.kind ?? site}</span></div>
      {showSource && item.game && <small className="mod-game-label">{item.game}</small>}
      <small>{item.author || `${site} creator`}{item.downloads != null ? ` · ${item.downloads.toLocaleString()} downloads` : ""}</small>
      <p>{item.summary || "No summary was provided."}</p>
      <div className="discover-card-actions">
        <button type="button" className="secondary-button" onClick={() => onView(item)} aria-label={`View ${item.name}`}><Eye size={13} /> View</button>
        <button type="button" className="secondary-button" onClick={() => onAction(item)} disabled={busy} aria-label={`${actionLabel}: ${item.name}`}><Download size={13} /> {actionLabel}</button>
        <button type="button" className="icon-button" onClick={() => void openExternalUrl(item.pageUrl).catch(() => undefined)} aria-label={`View ${item.name} on ${site}`} title={`View on ${site}`}><ExternalLink size={13} /></button>
      </div>
    </div>
  </article>;
});
