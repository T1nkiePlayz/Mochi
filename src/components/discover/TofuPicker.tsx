import { Download, X } from "lucide-react";
import { ModalShell } from "../mods/ModalShell";
import type { Piko, Tofu } from "../../models";

type Props = {
  /** What is being downloaded, e.g. "Sodium". */
  title: string;
  description?: string;
  pikos: Piko[];
  /** Games whose Tofus are listed first (the ones linked to the mod's own site or game). */
  prefer?: (piko: Piko) => boolean;
  onClose: () => void;
  onInstall: (tofu: Tofu, piko: Piko) => void;
};

/** Pick the Tofu that receives a download. Used for Modrinth, CurseForge and Nexus mods alike. */
export function TofuPicker({ title, description = "Choose the Tofu instance that should receive this download.", pikos, prefer, onClose, onInstall }: Props) {
  const withTofus = pikos.filter((piko) => piko.tofus?.length);
  const first = prefer ? withTofus.filter(prefer) : [];
  const rest = withTofus.filter((piko) => !first.includes(piko));
  const group = (list: Piko[], heading?: string) => list.length > 0 && <section className="tofu-picker-group" key={heading ?? "all"}>
    {heading && <h3 className="tofu-picker-heading">{heading}</h3>}
    <div className="tofu-picker-list">{list.flatMap((piko) => piko.tofus.map((tofu) => <div className="tofu-picker-row" key={`${piko.id}:${tofu.id}`}>
      <div><strong>{tofu.name}</strong><small>{piko.name} · {tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No folder yet"}</small></div>
      <button type="button" className="secondary-button" aria-label={`Download to ${tofu.name} (${piko.name})`} onClick={() => onInstall(tofu, piko)}><Download size={14} /> Download</button>
    </div>))}</div>
  </section>;
  return <ModalShell label={`Choose Tofu instance for ${title}`} className="tofu-picker-window" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Download {title}</p><h2>Choose Tofu instance</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <p className="modal-description">{description}</p>
    {withTofus.length ? <>{group(first, first.length && rest.length ? "Matching games" : undefined)}{group(rest, first.length ? "Other Tofus" : undefined)}</> : <div className="discover-empty">No Tofu instances were found. Add a game to your library first.</div>}
  </ModalShell>;
}
