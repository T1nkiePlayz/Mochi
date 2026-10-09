import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw } from "lucide-react";
import { loaderLabels, ALL_LOADERS } from "../../lib/mods/compat";
import { applyLocation, applyManualFolder, describeFolders, setSeparateStore } from "../../lib/mods/folders";
import { detectModLocations, getInstanceStoreDir, importModsFromFolder, type ModLocation } from "../../lib/mods/instances";
import { isMinecraftJava } from "../../lib/mods/gameSupport";
import { hasSeparateStore } from "../../lib/mods/targets";
import type { ModLoader, Piko, Tofu } from "../../models";
import { Select } from "../ui/Select";

type Props = { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void; /** The Tofu settings form already has its own game version field. */ showVersion?: boolean };

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.");

/**
 * Where a Tofu's mods live and where the game loads them from: detected locations (Minecraft launchers, per-game table),
 * a folder picker for anything else, loader and game version for Minecraft, and the "keep this Tofu's mods apart" switch.
 */
export function ModFolderEditor({ piko, tofu, onUpdate, showVersion = true }: Props) {
  const minecraft = isMinecraftJava(piko);
  const [locations, setLocations] = useState<ModLocation[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const separate = hasSeparateStore(tofu);

  const detect = async () => {
    setLocations(null);
    try { setLocations(await detectModLocations({ name: piko.name, installPath: piko.installPath, executablePath: piko.executablePath, minecraft })); }
    catch { setLocations([]); }
  };
  useEffect(() => { void detect(); }, [piko.id, minecraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const storeFor = async () => (tofu.path && separate ? tofu.path : getInstanceStoreDir(tofu.id));
  const choose = async (location: ModLocation) => {
    setMessage("");
    try { onUpdate(applyLocation(tofu, location, separate ? { keepSeparate: true, storeDir: await storeFor() } : {})); }
    catch (error) { setMessage(errorText(error)); }
  };
  const pick = async () => {
    const dir = await open({ directory: true, multiple: false, title: minecraft ? "Choose the folder Minecraft loads mods from" : "Choose the folder the game loads mods from" });
    if (typeof dir === "string") onUpdate(applyManualFolder(tofu, dir));
  };
  const toggleSeparate = async (on: boolean) => {
    setMessage(""); setBusy(true);
    try {
      const patch = setSeparateStore(tofu, on, await getInstanceStoreDir(tofu.id));
      if (!patch) { setMessage("Choose the game's mods folder first."); return; }
      onUpdate(patch);
      if (on && tofu.gameDir) {
        const copied = await importModsFromFolder(tofu.gameDir, patch.path as string);
        setMessage(copied ? `Copied ${copied} mod${copied === 1 ? "" : "s"} from the game folder into this Tofu. The originals were left where they are.` : "This Tofu now keeps its own mods.");
      }
    } catch (error) { setMessage(errorText(error)); } finally { setBusy(false); }
  };

  return <div className="mod-folder-editor">
    <p className="metadata-note" role="status">{describeFolders(tofu)}</p>
    <div className="mod-folder-list" role="group" aria-label="Detected mod folders">
      {locations === null ? <p className="muted"><RefreshCw size={12} className="spin" /> Looking for mod folders...</p>
        : locations.length === 0 ? <p className="muted">No mod folders were found automatically. Choose the folder yourself below.</p>
        : locations.slice(0, 30).map((location) => <button key={location.id} type="button" className={`mod-folder-item ${tofu.gameDir === location.modsDir ? "active" : ""}`} aria-pressed={tofu.gameDir === location.modsDir} onClick={() => void choose(location)}>
          <strong>{location.label}</strong>
          <small>{location.modsDir}{location.exists ? "" : " (not created yet)"}</small>
          {(location.loader || location.gameVersion) && <span className="mod-folder-chips">{location.loader && <i>{loaderLabels[location.loader]}</i>}{location.gameVersion && <i>{location.gameVersion}</i>}</span>}
        </button>)}
    </div>
    <div className="mod-folder-actions">
      <button type="button" className="secondary-button" onClick={() => void pick()}><FolderOpen size={14} /> Choose folder...</button>
      <button type="button" className="secondary-button" onClick={() => void detect()} disabled={locations === null}><RefreshCw size={14} /> Detect again</button>
    </div>
    {minecraft && <div className="form-row">
      <label>Loader<Select value={tofu.loader ?? ""} onChange={(value) => onUpdate({ loader: (value || undefined) as ModLoader | undefined })} label="Mod loader" searchable={false}
        options={[{ value: "", label: "Not set" }, ...ALL_LOADERS.map((loader) => ({ value: loader, label: loaderLabels[loader] }))]} /></label>
      {showVersion && <label>Game version<input value={tofu.version === "Local" ? "" : tofu.version} placeholder="1.21.1" maxLength={40} onChange={(event) => onUpdate({ version: event.target.value.trim() || "Local" })} /></label>}
    </div>}
    <label className="check-row"><input type="checkbox" checked={separate} disabled={busy || !tofu.gameDir} onChange={(event) => void toggleSeparate(event.target.checked)} /> Keep this Tofu's mods separate</label>
    <small className="metadata-note">Recommended when you have several Tofus for one game. Each Tofu keeps its own mods and Mochi copies them into the game folder only when you launch, replacing only files it put there itself.</small>
    {separate && <label className="check-row"><input type="checkbox" checked={tofu.syncReplaceExisting === true} onChange={(event) => onUpdate({ syncReplaceExisting: event.target.checked })} /> Replace same-named files in the game folder that Mochi did not add</label>}
    {message && <p className="metadata-note" role="status">{message}</p>}
  </div>;
}
