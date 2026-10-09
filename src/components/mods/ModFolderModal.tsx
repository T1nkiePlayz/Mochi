import { X } from "lucide-react";
import type { Piko, Tofu } from "../../models";
import { ModalShell } from "./ModalShell";
import { ModFolderEditor } from "./ModFolderEditor";

/** The folder settings of one Tofu in a dialog, opened from a game's mod area. */
export function ModFolderModal({ piko, tofu, onUpdate, onClose }: { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void; onClose: () => void }) {
  return <ModalShell label={`Mod folders for ${tofu.name}`} className="modal mod-folder-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{piko.name} · {tofu.name}</p><h2>Mod folders</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <div className="form-fields"><ModFolderEditor piko={piko} tofu={tofu} onUpdate={onUpdate} /></div>
    <div className="tofu-manager-actions"><button type="button" className="play-button" onClick={onClose}>Done</button></div>
  </ModalShell>;
}
