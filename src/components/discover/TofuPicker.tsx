import { Plus, X } from "lucide-react";
import type { ModrinthProject } from "../../lib/modrinth";
import type { Piko, Tofu } from "../../models";

export function TofuPicker({ project, pikos, onClose, onInstall }: { project: ModrinthProject; pikos: Piko[]; onClose: () => void; onInstall: (tofu: Tofu) => void }) {
  const tofus = pikos.flatMap(piko => piko.tofus || []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Install {project.title}</p><h2>Choose Tofu instance</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p className="modal-description">Choose the Minecraft instance that should receive this download.</p>{tofus.length ? <div className="tofu-picker-list">{tofus.map(tofu=><div className="tofu-picker-row" key={tofu.id}><div><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No install location"}</small></div><button className="secondary-button" title={"Download to " + tofu.name} disabled={!tofu.path} onClick={()=>onInstall(tofu)}><Plus size={15}/></button></div>)}</div> : <div className="discover-empty">No Minecraft instances were found.</div>}</div></div>;
}

