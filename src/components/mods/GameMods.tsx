import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Link2, RefreshCw } from "lucide-react";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { sourceLabels } from "../../lib/mods/types";
import { openPath } from "../../lib/platform";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { useGameMods } from "../../state/useGameMods";
import { ModrinthManager } from "../ModrinthManager";
import { LinkGameModal } from "./LinkGameModal";
import { ModsBrowser } from "./ModsBrowser";

type Props = { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void };

/** The mod area of a game page: the full Minecraft manager for Minecraft, a mod browser for other games, nothing for launchers. */
export function GameMods({ piko, tofu, onUpdate }: Props) {
  const support = modSupportOf(piko);
  if (support === "minecraft") return <ModrinthManager tofu={tofu} onUpdate={onUpdate} />;
  if (support === "none") return null;
  return <GameModsPanel piko={piko} tofu={tofu} onUpdate={onUpdate} />;
}

function GameModsPanel({ piko, tofu, onUpdate }: Props) {
  const { behavior, setActiveNav } = useApp();
  const mods = useGameMods(piko);
  const [linking, setLinking] = useState(false);
  const sources = behavior.modSources;
  const chooseFolder = async () => { const chosen = await open({ directory: true, multiple: false, title: "Choose Tofu folder" }); if (typeof chosen === "string") onUpdate({ path: chosen }); };
  const settingsLink = <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button>;

  let body;
  if (mods.source) body = <ModsBrowser key={`${mods.sourceId}:${tofu.id}`} source={mods.source} target={{ kind: "tofu", tofu, onUpdateTofu: onUpdate }} noun="mods" />;
  else if (mods.resolving) body = <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Looking for {piko.name} on mod sites...</span></div>;
  else if (mods.nexusBlocked === "key") body = <p className="metadata-note" role="status">{piko.name} has mods on Nexus Mods. Add your Nexus API key in Settings to browse and download them. {settingsLink}</p>;
  else if (mods.nexusBlocked === "disabled" || (!sources.curseforge && !sources.nexus)) body = <p className="metadata-note" role="status">The mod sources for {piko.name} are turned off. {settingsLink}</p>;
  else if (mods.offline) body = <p className="metadata-note" role="status">Mochi could not reach the mod sites. Check your connection; this game will be matched when you are back online.</p>;
  else body = <div className="discover-empty"><p>No mod site was found for {piko.name}.</p><button type="button" className="secondary-button" onClick={() => setLinking(true)}><Link2 size={14} /> Link this game to a mod site</button></div>;

  return <section className="modrinth-manager game-mods">
    <div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace{mods.sourceId ? ` · ${sourceLabels[mods.sourceId]}` : ""}</p><h3>{tofu.name}</h3><p className="workspace-path">{tofu.path || "Choose a folder to download mods into."}</p></div>
      <div className="tofu-workspace-actions">
        {tofu.path && <button type="button" className="secondary-button" onClick={() => void openPath(tofu.path!).catch(() => undefined)}><FolderOpen size={14} /> Open</button>}
        <button type="button" className="secondary-button" onClick={() => void chooseFolder()}><FolderOpen size={14} /> {tofu.path ? "Change folder" : "Choose folder"}</button>
        {(sources.curseforge || sources.nexus) && <button type="button" className="secondary-button" onClick={() => setLinking(true)}><Link2 size={14} /> Link game</button>}
      </div></div>
    {body}
    {linking && <LinkGameModal piko={piko} curseforgeEnabled={sources.curseforge} nexusEnabled={sources.nexus} onSave={mods.setLinks} onClose={() => setLinking(false)} />}
  </section>;
}
