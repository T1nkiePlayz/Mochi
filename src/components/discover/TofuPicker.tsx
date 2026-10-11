import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Download, HelpCircle, X } from "lucide-react";
import { ModalShell } from "../mods/ModalShell";
import { tofuTarget, loaderLabels, type ModVersionMeta } from "../../lib/mods/compat";
import type { EcosystemRef } from "../../lib/mods/gameSupport";
import { buildTofuChoices, type TofuChoice } from "../../lib/mods/tofuChoices";
import type { Piko, Tofu } from "../../models";
import { useTranslation } from "../../lib/useTranslation";

type Props = {
  /** What is being downloaded, e.g. "Sodium". */
  title: string;
  description?: string;
  pikos: Piko[];
  /** Where the content belongs: Minecraft content lists only Minecraft instances, anything else only that game's Tofus. */
  ecosystem: EcosystemRef;
  gameName?: string;
  /** What the content supports (the chosen file, or the listing), used for the compatibility badge. */
  metas?: readonly ModVersionMeta[];
  onClose: () => void;
  /** `force` is true for "Install anyway": the file filter is skipped and the newest file is taken. */
  onInstall: (tofu: Tofu, piko: Piko, force: boolean) => void;
};

const badgeText = { compatible: "Compatible", maybe: "May work", incompatible: "Incompatible" } as const;
const BadgeIcon = { compatible: CheckCircle2, maybe: HelpCircle, incompatible: AlertTriangle } as const;

function Row({ choice, onInstall }: { choice: TofuChoice; onInstall: (tofu: Tofu, piko: Piko, force: boolean) => void }) {
  const { tofu, piko, compat } = choice;
  const target = tofuTarget(tofu);
  const incompatible = compat?.status === "incompatible";
  const Icon = compat ? BadgeIcon[compat.status] : null;
  return <div className="tofu-picker-row" data-compat={compat?.status}>
    <div>
      <strong>{tofu.name}</strong>
      <small>{piko.name} · {tofu.version}{target.loader ? ` · ${loaderLabels[target.loader]}` : ""}{tofu.path ? "" : " · No folder yet"}</small>
      {compat && <small className={`compat-note compat-${compat.status}`}><span className={`compat-badge compat-${compat.status}`}>{Icon && <Icon size={12} aria-hidden="true" />}{badgeText[compat.status]}</span>{compat.reasons[0] ? ` ${compat.reasons[0]}` : ""}</small>}
    </div>
    <button type="button" className="secondary-button" aria-label={`${incompatible ? "Install anyway to" : "Download to"} ${tofu.name} (${piko.name})`} onClick={() => onInstall(tofu, piko, incompatible)}>
      <Download size={14} /> {incompatible ? "Install anyway"  : t("Download")}
    </button>
  </div>;
}

/** Pick the Tofu that receives a download. Minecraft content shows only Minecraft instances; other games only their own. */
export function TofuPicker({ title, description, pikos, ecosystem, gameName, metas, onClose, onInstall }: Props) {
  const t = useTranslation();
  const choices = useMemo(() => buildTofuChoices({ pikos, ecosystem, gameName, metas }), [pikos, ecosystem, gameName, metas]);
  const text = description ?? (choices.kind === "minecraft" ? "Only Minecraft instances are listed, by loader and newest version. Incompatible ones can still be installed on purpose." : "Choose the Tofu instance that should receive this download.");
  return <ModalShell label={`Choose Tofu instance for ${title}`} className="tofu-picker-window" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Download {title}</p><h2>Choose Tofu instance</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <p className="modal-description">{text}</p>
    {choices.groups.length ? choices.groups.map((group) => <section className="tofu-picker-group" key={group.label}>
      <h3 className="tofu-picker-heading">{group.label === "No loader set" ? t("No loader set") : group.label}</h3>
      <div className="tofu-picker-list">{group.rows.map((choice) => <Row key={`${choice.piko.id}:${choice.tofu.id}`} choice={choice} onInstall={onInstall} />)}</div>
    </section>) : <div className="discover-empty">{choices.empty}</div>}
  </ModalShell>;
}
