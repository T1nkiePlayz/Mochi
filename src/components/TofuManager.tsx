import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { defaultLaunchConfig } from "../lib/launch";
import type { RuntimeInfo } from "../lib/platform";
import type { Piko, Tofu } from "../models";
import { Select } from "./ui/Select";

type Props = {
  piko: Piko;
  selectedTofuId: string;
  runtimes: RuntimeInfo[];
  onSelect: (tofuId: string) => void;
  onChange: (tofus: Tofu[]) => void;
  onClose: () => void;
};

const newId = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tofu"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function TofuManager({ piko, selectedTofuId, runtimes, onSelect, onChange, onClose }: Props) {
  const tofus = piko.tofus;
  const selected = tofus.find((tofu) => tofu.id === selectedTofuId) ?? tofus[0];
  const [draftName, setDraftName] = useState(selected?.name ?? "");
  useEffect(() => setDraftName(selected?.name ?? ""), [selected?.id, selected?.name]);
  if (!selected) return null;

  const launch = selected.launch ?? defaultLaunchConfig();
  const compat = runtimes.filter((runtime) => runtime.kind === "compat");
  const wrappers = runtimes.filter((runtime) => runtime.kind === "wrapper");
  const patch = (changes: Partial<Tofu>) => onChange(tofus.map((tofu) => tofu.id === selected.id ? { ...tofu, ...changes } : tofu));
  const patchLaunch = (changes: Partial<typeof launch>) => patch({ launch: { ...launch, ...changes } });

  const create = () => {
    const name = `Tofu ${tofus.length + 1}`;
    const tofu: Tofu = { id: newId(name), name, version: "Local", runtime: "Native", mods: 0, status: "Ready", launch: defaultLaunchConfig() };
    onChange([...tofus, tofu]);
    onSelect(tofu.id);
  };
  const duplicate = () => {
    const copy: Tofu = { ...selected, id: newId(selected.name), name: `${selected.name} copy`, activeProfileId: undefined, profiles: (selected.profiles ?? []).map((profile) => ({ ...profile })), launch: { ...launch, wrappers: [...launch.wrappers] } };
    onChange([...tofus, copy]);
    onSelect(copy.id);
  };
  const remove = () => {
    if (tofus.length < 2 || !window.confirm(`Delete the Tofu “${selected.name}”? Files in its folder are not touched.`)) return;
    const remaining = tofus.filter((tofu) => tofu.id !== selected.id);
    onChange(remaining);
    onSelect(remaining[0].id);
  };
  const chooseFolder = async (apply: (path: string) => void, title: string) => {
    const path = await open({ directory: true, multiple: false, title });
    if (typeof path === "string") apply(path);
  };
  const commitName = () => { const name = draftName.trim(); if (name && name !== selected.name) patch({ name }); else setDraftName(selected.name); };

  return <div className="modal-backdrop" onClick={onClose}><div className="modal tofu-manager-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">{piko.name}</p><h2>Manage Tofus</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
    <div className="tofu-manager-body">
      <div className="tofu-manager-list">
        {tofus.map((tofu) => <button key={tofu.id} className={"tofu-manager-item " + (tofu.id === selected.id ? "active" : "")} onClick={() => onSelect(tofu.id)}><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}</small></button>)}
        <button className="tofu-manager-item add" onClick={create}><Plus size={14}/> New Tofu</button>
      </div>
      <div className="tofu-manager-form form-fields">
        <label>Name<input value={draftName} maxLength={60} onChange={(e) => setDraftName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
        <div className="form-row"><label>Game version<input value={selected.version} maxLength={40} onChange={(e) => patch({ version: e.target.value })} /></label><label>Runtime label<input value={selected.runtime} maxLength={40} onChange={(e) => patch({ runtime: e.target.value })} /></label></div>
        <label>Content folder<div className="flatpak-input-row"><input readOnly value={selected.path ?? ""} placeholder="No folder chosen" /><button type="button" className="secondary-button" onClick={() => void chooseFolder((path) => patch({ path }), "Choose Tofu folder")}><FolderOpen size={14}/></button></div></label>

        <label className="check-row"><input type="checkbox" checked={selected.extractArchives === true} onChange={(e) => patch({ extractArchives: e.target.checked })} /> Extract .zip downloads into the folder</label>
        <small className="metadata-note">For games whose mods are archives. When on, a downloaded .zip is unpacked into the content folder and the archive is removed.</small>

        <p className="eyebrow">Launch settings</p>
        {compat.length > 0 && <label>Compatibility runtime<Select value={launch.runtime ?? ""} onChange={(value) => patchLaunch({ runtime: value || undefined })} label="Compatibility runtime" searchable={false} options={[{ value: "", label: "Automatic" }, ...compat.map((runtime) => ({ value: runtime.id, label: runtime.name }))]} /><small className="metadata-note">Used for Windows programs (.exe). Native games ignore it.</small></label>}
        {wrappers.length > 0 && <div className="wrapper-options"><span>Wrappers</span>{wrappers.map((wrapper) => <label key={wrapper.id} className="check-row"><input type="checkbox" checked={launch.wrappers.includes(wrapper.id)} onChange={(e) => patchLaunch({ wrappers: e.target.checked ? [...launch.wrappers, wrapper.id] : launch.wrappers.filter((id) => id !== wrapper.id) })} /> {wrapper.name}</label>)}</div>}
        <label>Launch arguments<input value={launch.args} placeholder="--fullscreen -windowed" onChange={(e) => patchLaunch({ args: e.target.value })} /></label>
        <label>Environment variables<textarea rows={3} value={launch.env} placeholder={"DXVK_HUD=fps\nMANGOHUD=1"} onChange={(e) => patchLaunch({ env: e.target.value })} spellCheck={false} /></label>
        <label>Working directory<div className="flatpak-input-row"><input value={launch.workingDir ?? ""} placeholder="Default" onChange={(e) => patchLaunch({ workingDir: e.target.value || undefined })} /><button type="button" className="secondary-button" onClick={() => void chooseFolder((path) => patchLaunch({ workingDir: path }), "Choose working directory")}><FolderOpen size={14}/></button></div></label>
      </div>
    </div>
    <div className="tofu-manager-actions"><button className="secondary-button" onClick={duplicate}><Copy size={14}/> Duplicate</button><button className="secondary-button danger-outline" onClick={remove} disabled={tofus.length < 2}><Trash2 size={14}/> Delete</button><button className="play-button" onClick={onClose}>Done</button></div>
  </div></div>;
}
