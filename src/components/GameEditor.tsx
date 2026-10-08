import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { chooseGameAppBundle, chooseGameTarget, type PlatformCapabilities } from "../lib/platform";
import type { Piko } from "../models";

type Props = {
  game: Piko;
  capabilities: PlatformCapabilities | null;
  onSave: (changes: Pick<Piko, "name" | "executablePath" | "platformCategory" | "installPath">) => void;
  onClose: () => void;
};

export function GameEditor({ game, capabilities, onSave, onClose }: Props) {
  const [name, setName] = useState(game.name);
  const [target, setTarget] = useState(game.executablePath ?? "");
  const [category, setCategory] = useState(game.platformCategory ?? "");
  const [installPath, setInstallPath] = useState(game.installPath ?? "");
  const [error, setError] = useState("");

  const pick = async (bundle: boolean) => {
    try { const selected = bundle ? await chooseGameAppBundle() : await chooseGameTarget(); if (selected) setTarget(selected); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !target.trim()) { setError("A name and launch target are required."); return; }
    onSave({ name: name.trim(), executablePath: target.trim(), platformCategory: category.trim() || undefined, installPath: installPath.trim() || undefined });
  };

  return <div className="modal-backdrop" onClick={onClose}><form className="modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Library</p><h2>Edit game</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
    <div className="form-fields">
      <label>Game name<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
      <label>Platform category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Steam, Heroic, Custom" /></label>
      <label>Launch target<div className="flatpak-input-row"><input value={target} onChange={(e) => setTarget(e.target.value)} required /><button type="button" className="secondary-button" onClick={() => void pick(false)}>File…</button>{capabilities?.supportsAppBundles && <button type="button" className="secondary-button" onClick={() => void pick(true)}>App…</button>}</div></label>
      <label>Install folder <small className="metadata-note">Optional. Lets Mochi follow the game's process to track playtime.</small><input value={installPath} onChange={(e) => setInstallPath(e.target.value)} placeholder="/path/to/game" /></label>
    </div>
    {error && <p className="auth-error">{error}</p>}
    <button className="play-button form-submit" type="submit">Save changes</button>
  </form></div>;
}
