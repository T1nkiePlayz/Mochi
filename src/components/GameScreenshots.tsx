import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderPlus, X } from "lucide-react";
import type { Piko } from "../models";
import { useApp } from "../state/AppContext";
import { openPath } from "../lib/platform";
import { lastSeen, markSeen, newSince, scanRequestFor, scanScreenshots, thumbnailsFor, type ScreenshotFile } from "../lib/screenshots";

const SHOWN = 24;

/** Screenshots Steam and your own folders hold for this game. Hidden when there are none and no folder is set. */
export function GameScreenshots({ game }: { game: Piko }) {
  const { behavior, lib } = useApp();
  const [files, setFiles] = useState<ScreenshotFile[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [seenAtOpen, setSeenAtOpen] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const shared = behavior.screenshotFolders.join("\n");
  const gameFolders = (game.screenshotFolders ?? []).join("\n");

  useEffect(() => {
    let live = true;
    setSeenAtOpen(lastSeen(game.id));
    void scanScreenshots(scanRequestFor(game, shared ? shared.split("\n") : [])).then(async (found) => {
      if (!live) return;
      setFiles(found);
      const map = await thumbnailsFor(found.slice(0, more ? found.length : SHOWN));
      if (live) { setThumbs(map); markSeen(game.id, found); }
    }).catch(() => { /* browser/development mode */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescan when the game or its folders change, not on every game field edit
  }, [game.id, game.name, shared, gameFolders, more]);

  const addFolder = useCallback(async () => {
    const chosen = await openDialog({ title: "Choose a screenshot folder", directory: true, multiple: false }).catch(() => null);
    if (typeof chosen !== "string" || !chosen) return;
    lib.updateGame(game.id, { screenshotFolders: [...new Set([...(game.screenshotFolders ?? []), chosen])].slice(0, 10) });
  }, [game.id, game.screenshotFolders, lib]);
  const removeFolder = (folder: string) => lib.updateGame(game.id, { screenshotFolders: (game.screenshotFolders ?? []).filter((item) => item !== folder) });

  const fresh = new Set(newSince(files, seenAtOpen).map((file) => file.path));
  const visible = more ? files : files.slice(0, SHOWN);
  return <section className="game-details-section game-screenshots" aria-label={`Screenshots of ${game.name}`}>
    <div className="discover-section-heading"><div><h3>Your screenshots{fresh.size > 0 && <span className="backlog-badge">{fresh.size} new</span>}</h3><p>From Steam and your folders. Files are only read, never changed.</p></div>
      <button type="button" className="secondary-button" onClick={() => void addFolder()}><FolderPlus size={14} /> Add folder</button></div>
    {(game.screenshotFolders ?? []).length > 0 && <ul className="screenshot-folders">{(game.screenshotFolders ?? []).map((folder) => <li key={folder}><span title={folder}>{folder}</span><button type="button" className="icon-button" aria-label={`Stop using ${folder}`} onClick={() => removeFolder(folder)}><X size={14} /></button></li>)}</ul>}
    {files.length === 0 ? <p className="metadata-note">No screenshots found yet. Steam's are picked up automatically; add a folder for other launchers.</p>
      : <div className="screenshot-grid">{visible.map((file) => <button type="button" key={file.path} className="screenshot-item" title={new Date(file.modified * 1000).toLocaleString()} onClick={() => void openPath(file.path).catch(() => {})}>
        {thumbs.get(file.path) ? <img src={thumbs.get(file.path)} alt="" loading="lazy" decoding="async" /> : <span className="screenshot-pending" />}{fresh.has(file.path) && <span className="screenshot-new">New</span>}</button>)}</div>}
    {files.length > SHOWN && !more && <button type="button" className="secondary-button" onClick={() => setMore(true)}>Show all {files.length}</button>}
  </section>;
}
