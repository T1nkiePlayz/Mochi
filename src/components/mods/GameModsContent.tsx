import { useEffect, useState } from "react";
import { FolderOpen, Link2, RefreshCw, Settings2 } from "lucide-react";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { sourceLabels } from "../../lib/mods/types";
import { openPath } from "../../lib/platform";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { useGameMods } from "../../state/useGameMods";
import { ModrinthManager } from "../ModrinthManager";
import { describeFolders } from "../../lib/mods/folders";
import { contentFolder } from "../../lib/mods/targets";
import { ensureChecked, updateCount, useTofuUpdates } from "../../state/modUpdates";
import { InstalledModsPanel } from "./InstalledModsPanel";
import { LinkGameModal } from "./LinkGameModal";
import { ModFolderModal } from "./ModFolderModal";
import { UpdatesPanel } from "./UpdatesPanel";
import { useAutoModFolder } from "./useAutoModFolder";
import { useInstalledFiles } from "./useInstalledFiles";
import { ModsBrowser } from "./ModsBrowser";

type Props = { piko: Piko; tofu: Tofu; onUpdate: (patch: Partial<Tofu>) => void };

/** The mod area of a game page: the full Minecraft manager for Minecraft, a mod browser for other games, nothing for launchers. Loaded on demand by GameMods. */
export function GameModsContent({ piko, tofu, onUpdate }: Props) {
  const support = modSupportOf(piko);
  if (support === "minecraft") return <ModrinthManager piko={piko} tofu={tofu} onUpdate={onUpdate} />;
  if (support === "none") return null;
  return <GameModsPanel piko={piko} tofu={tofu} onUpdate={onUpdate} />;
}

type PanelTab = "browse" | "installed" | "updates";

function GameModsPanel({ piko, tofu, onUpdate }: Props) {
  const { behavior, setActiveNav } = useApp();
  const mods = useGameMods(piko);
  const [linking, setLinking] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("browse");
  const [message, setMessage] = useState("");
  const sources = behavior.modSources;
  const folder = contentFolder(tofu, "mod");
  const installedFiles = useInstalledFiles(tofu, folder);
  const auto = useAutoModFolder(piko, tofu, onUpdate);
  const updates = useTofuUpdates(tofu.id);
  const settingsLink = <button type="button" className="text-button" onClick={() => setActiveNav("Settings")}>Open Settings</button>;

  // The list's size is the Tofu's mod count; updates are looked for once when the Tofu is opened.
  useEffect(() => { if (folder && installedFiles.files.length !== tofu.mods) onUpdate({ mods: installedFiles.files.length }); }, [installedFiles.files.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tofu.path) void ensureChecked(tofu, piko, behavior.modSources); }, [tofu.id, tofu.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (installedFiles.error) setMessage(installedFiles.error); }, [installedFiles.error]);

  let browse;
  if (mods.source) browse = <ModsBrowser key={`${mods.sourceId}:${tofu.id}`} source={mods.source} target={{ kind: "tofu", tofu, onUpdateTofu: onUpdate }} noun="mods" />;
  else if (mods.resolving) browse = <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Looking for {piko.name} on mod sites...</span></div>;
  else if (mods.nexusBlocked === "key") browse = <p className="metadata-note" role="status">{piko.name} has mods on Nexus Mods. Add your Nexus API key in Settings to browse and download them. {settingsLink}</p>;
  else if (mods.nexusBlocked === "disabled" || (!sources.curseforge && !sources.nexus)) browse = <p className="metadata-note" role="status">The mod sources for {piko.name} are turned off. {settingsLink}</p>;
  else if (mods.offline) browse = <p className="metadata-note" role="status">Mochi could not reach the mod sites. Check your connection; this game will be matched when you are back online.</p>;
  else browse = <div className="discover-empty"><p>No mod site was found for {piko.name}.</p><button type="button" className="secondary-button" onClick={() => setLinking(true)}><Link2 size={14} /> Link this game to a mod site</button></div>;

  const count = updateCount(updates);
  const openTarget = tofu.path ?? tofu.gameDir;
  return <section className="modrinth-manager game-mods">
    <div className="tofu-workspace-header"><div><p className="eyebrow">Tofu workspace{mods.sourceId ? ` · ${sourceLabels[mods.sourceId]}` : ""}</p><h3>{tofu.name}</h3><p className="workspace-path">{tofu.path ? describeFolders(tofu) : "Choose a folder to download mods into."}</p></div>
      <div className="tofu-workspace-actions">
        {openTarget && <button type="button" className="secondary-button" onClick={() => void openPath(openTarget).catch(() => undefined)}><FolderOpen size={14} /> Open</button>}
        <button type="button" className="secondary-button" onClick={() => setFolderOpen(true)}><Settings2 size={14} /> Mod folders</button>
        {(sources.curseforge || sources.nexus) && <button type="button" className="secondary-button" onClick={() => setLinking(true)}><Link2 size={14} /> Link game</button>}
      </div></div>
    {auto.state === "applied" && auto.applied && <p className="metadata-note" role="status">Found {auto.applied.label}. Mochi will manage mods in {auto.applied.modsDir}.</p>}
    {auto.state === "choose" && <p className="metadata-note" role="status">Mochi found {auto.candidates.length} places mods can go. <button type="button" className="text-button" onClick={() => setFolderOpen(true)}>Choose one</button></p>}
    {auto.state === "missing" && <p className="metadata-note" role="status">Mochi could not tell where {piko.name} loads mods. <button type="button" className="text-button" onClick={() => setFolderOpen(true)}>Choose the folder</button></p>}
    <div className="workspace-tabs">
      <button type="button" className={tab === "browse" ? "active" : ""} aria-pressed={tab === "browse"} onClick={() => setTab("browse")}>Browse</button>
      <button type="button" className={tab === "installed" ? "active" : ""} aria-pressed={tab === "installed"} onClick={() => setTab("installed")}>Installed ({installedFiles.files.length})</button>
      <button type="button" className={tab === "updates" ? "active" : ""} aria-pressed={tab === "updates"} onClick={() => setTab("updates")}>{count ? `Updates (${count})` : "Updates"}</button>
    </div>
    {message && <p className="metadata-note" role="status">{message}</p>}
    {tab === "browse" ? browse : tab === "installed"
      ? (folder ? <InstalledModsPanel tofu={tofu} folder={folder} withUpdates files={installedFiles.files} loading={installedFiles.loading} refresh={installedFiles.refresh} onMessage={setMessage} /> : <p className="muted">Choose a mod folder first.</p>)
      : <UpdatesPanel tofu={tofu} piko={piko} onRefresh={installedFiles.refresh} />}
    {linking && <LinkGameModal piko={piko} curseforgeEnabled={sources.curseforge} nexusEnabled={sources.nexus} onSave={mods.setLinks} onClose={() => setLinking(false)} />}
    {folderOpen && <ModFolderModal piko={piko} tofu={tofu} onUpdate={onUpdate} onClose={() => setFolderOpen(false)} />}
  </section>;
}
