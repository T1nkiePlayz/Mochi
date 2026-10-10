import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

/** Screenshots and background library watching. */
export function LibraryToolsSection() {
  const { behavior, setBehavior } = useApp();
  const addFolder = async () => {
    const chosen = await openDialog({ title: "Choose a screenshot folder", directory: true, multiple: false }).catch(() => null);
    if (typeof chosen === "string" && chosen) setBehavior({ ...behavior, screenshotFolders: [...new Set([...behavior.screenshotFolders, chosen])].slice(0, 20) });
  };
  return <SettingsGroup title="Screenshots & library" subtitle="Where Mochi looks for screenshots, and whether it watches for new games" id="settings-librarytools">
    <ToggleRow title="Watch for new and removed games" description="Re-checks your import sources in the background while Mochi is open and tells you about new installs and games whose files are gone. Turn it off to scan only when you ask." checked={behavior.watchFolders} onChange={(watchFolders) => setBehavior({ ...behavior, watchFolders })} />
    <ToggleRow title="Tell me about new screenshots" description="After you close a game, a notice says when it left new screenshots. Steam's screenshot folders are always checked." checked={behavior.screenshotNotices} onChange={(screenshotNotices) => setBehavior({ ...behavior, screenshotNotices })} />
    <div className="setting-row"><span><strong>Shared screenshot folders</strong><small>Folders with one sub-folder per game, named like the game (Heroic, Lutris, Bottles, your own captures). You can also add a folder to a single game on its page.</small></span>
      <button type="button" className="secondary-button" onClick={() => void addFolder()}>Add folder</button></div>
    {behavior.screenshotFolders.length > 0 && <ul className="screenshot-folders" aria-label="Shared screenshot folders">{behavior.screenshotFolders.map((folder) => <li key={folder}><span title={folder}>{folder}</span><button type="button" className="icon-button" aria-label={`Remove ${folder}`} onClick={() => setBehavior({ ...behavior, screenshotFolders: behavior.screenshotFolders.filter((item) => item !== folder) })}><X size={14} /></button></li>)}</ul>}
  </SettingsGroup>;
}
