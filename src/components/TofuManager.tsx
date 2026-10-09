import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { defaultLaunchConfig } from "../lib/launch";
import type { RuntimeInfo } from "../lib/platform";
import { copyInstanceRecords } from "../lib/mods/instances";
import type { Piko, Tofu } from "../models";
import { Select } from "./ui/Select";
import { Checkbox, Field, Switch } from "./ui/Checkbox";
import { ModFolderEditor } from "./mods/ModFolderEditor";

type Props = {
  piko: Piko;
  selectedTofuId: string;
  runtimes: RuntimeInfo[];
  onSelect: (tofuId: string) => void;
  onChange: (tofus: Tofu[]) => void;
  onClose: () => void;
};

const newId = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tofu"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="tofu-settings-section" aria-label={title}>
    <div className="tofu-settings-heading"><h3>{title}</h3>{description && <p>{description}</p>}</div>
    <div className="tofu-settings-body">{children}</div>
  </section>;
}

export function TofuManager({ piko, selectedTofuId, runtimes, onSelect, onChange, onClose }: Props) {
  const tofus = piko.tofus;
  const selected = tofus.find((tofu) => tofu.id === selectedTofuId) ?? tofus[0];
  const [draftName, setDraftName] = useState(selected?.name ?? "");
  useEffect(() => setDraftName(selected?.name ?? ""), [selected?.id, selected?.name]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!selected) return null;

  const launch = selected.launch ?? defaultLaunchConfig();
  const compat = runtimes.filter((runtime) => runtime.kind === "compat");
  const wrappers = runtimes.filter((runtime) => runtime.kind === "wrapper");
  const patch = (changes: Partial<Tofu>) => onChange(tofus.map((tofu) => tofu.id === selected.id ? { ...tofu, ...changes } : tofu));
  const patchLaunch = (changes: Partial<typeof launch>) => patch({ launch: { ...launch, ...changes } });

  const create = () => {
    const name = `Tofu ${tofus.length + 1}`;
    // A new Tofu starts on the same game folder with no mods of its own: switching to it disables the other Tofus' mods.
    const tofu: Tofu = { id: newId(name), name, version: selected.version, runtime: "Native", mods: 0, status: "Ready", launch: defaultLaunchConfig(),
      ...(selected.gameDir ? { path: selected.gameDir, gameDir: selected.gameDir, contentRoot: selected.contentRoot, loader: selected.loader } : {}) };
    onChange([...tofus, tofu]);
    onSelect(tofu.id);
  };
  const duplicate = () => {
    const copy: Tofu = { ...selected, id: newId(selected.name), name: `${selected.name} copy`, activeProfileId: undefined, profiles: (selected.profiles ?? []).map((profile) => ({ ...profile })), launch: { ...launch, wrappers: [...launch.wrappers] } };
    // Same mods as the original (its records), so the copy starts as an identical mod set.
    void copyInstanceRecords(selected.id, copy.id).catch(() => undefined);
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

  return <div className="modal-backdrop" onClick={onClose}><div className="modal tofu-manager-modal" role="dialog" aria-modal="true" aria-labelledby="tofu-manager-title" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">{piko.name}</p><h2 id="tofu-manager-title">Manage Tofus</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
    <div className="tofu-manager-body">
      <div className="tofu-manager-list" role="listbox" aria-label="Tofus">
        {tofus.map((tofu) => <button type="button" role="option" aria-selected={tofu.id === selected.id} key={tofu.id} className={"tofu-manager-item " + (tofu.id === selected.id ? "active" : "")} onClick={() => onSelect(tofu.id)}><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.mods ? ` · ${tofu.mods} mods` : ""}</small></button>)}
        <button type="button" className="tofu-manager-item add" onClick={create}><Plus size={14}/> New Tofu</button>
      </div>
      <div className="tofu-manager-form tofu-settings">
        <Section title="General">
          <Field label="Name"><input value={draftName} maxLength={60} onChange={(e) => setDraftName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></Field>
          <div className="tofu-settings-row">
            <Field label="Game version"><input value={selected.version} maxLength={40} onChange={(e) => patch({ version: e.target.value })} /></Field>
            <Field label="Runtime label"><input value={selected.runtime} maxLength={40} onChange={(e) => patch({ runtime: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="Mod folders" description="Where this Tofu's mods live and where the game loads them from.">
          <ModFolderEditor key={selected.id} piko={piko} tofu={selected} onUpdate={patch} showVersion={false} />
          <Checkbox checked={selected.extractArchives === true} onChange={(checked) => patch({ extractArchives: checked })} label="Extract .zip downloads into the folder"
            description="For games whose mods are archives. A downloaded .zip is unpacked into the content folder and the archive is removed." />
        </Section>

        <Section title="Launch settings">
          {compat.length > 0 && <Field label="Compatibility runtime" hint="Used for Windows programs (.exe). Native games ignore it."><Select value={launch.runtime ?? ""} onChange={(value) => patchLaunch({ runtime: value || undefined })} label="Compatibility runtime" searchable={false} options={[{ value: "", label: "Automatic" }, ...compat.map((runtime) => ({ value: runtime.id, label: runtime.name }))]} /></Field>}
          {wrappers.length > 0 && <div className="tofu-settings-wrappers" role="group" aria-label="Wrappers"><span className="mochi-field-label">Wrappers</span>
            {wrappers.map((wrapper) => <Switch key={wrapper.id} label={wrapper.name} checked={launch.wrappers.includes(wrapper.id)} onChange={(on) => patchLaunch({ wrappers: on ? [...launch.wrappers, wrapper.id] : launch.wrappers.filter((id) => id !== wrapper.id) })} />)}
          </div>}
          <Field label="Launch arguments"><input value={launch.args} placeholder="--fullscreen -windowed" onChange={(e) => patchLaunch({ args: e.target.value })} /></Field>
          <Field label="Environment variables" hint="One KEY=value per line."><textarea rows={3} value={launch.env} placeholder={"DXVK_HUD=fps\nMANGOHUD=1"} onChange={(e) => patchLaunch({ env: e.target.value })} spellCheck={false} /></Field>
          <div className="mochi-field"><span className="mochi-field-label" id="tofu-workdir-label">Working directory</span>
            <div className="tofu-settings-inline"><input aria-labelledby="tofu-workdir-label" value={launch.workingDir ?? ""} placeholder="Default" onChange={(e) => patchLaunch({ workingDir: e.target.value || undefined })} />
              <button type="button" className="secondary-button" aria-label="Choose working directory" onClick={() => void chooseFolder((path) => patchLaunch({ workingDir: path }), "Choose working directory")}><FolderOpen size={14}/></button></div>
          </div>
        </Section>
      </div>
    </div>
    <div className="tofu-manager-actions"><button type="button" className="secondary-button" onClick={duplicate}><Copy size={14}/> Duplicate</button><button type="button" className="secondary-button danger-outline" onClick={remove} disabled={tofus.length < 2}><Trash2 size={14}/> Delete</button><button type="button" className="play-button" onClick={onClose}>Done</button></div>
  </div></div>;
}
