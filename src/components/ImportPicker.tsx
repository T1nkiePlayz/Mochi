import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FolderOpen, X } from "lucide-react";
import { chooseGameLibraryPath } from "../lib/platform";
import { launcherIcon } from "../lib/launcherArt";
import type { DetectedImportSource, ImportSourceId, ImportedGame } from "../lib/sources";
import { scanImportGames } from "../lib/sources";
import { SourceGamePicker } from "./import/SourceGamePicker";

type ImportPickerProps = {
  onClose: () => void;
  onImport: (games: ImportedGame[]) => void;
};

const manualSources: Array<{ id: ImportSourceId; name: string }> = [
  { id: "steam", name: "Steam" }, { id: "heroic", name: "Heroic Games Launcher" }, { id: "itch", name: "itch.io" },
];

export function ImportPicker({ onClose, onImport }: ImportPickerProps) {
  const [manual, setManual] = useState<"closed" | "form" | "results">("closed");
  const [platform, setPlatform] = useState<ImportSourceId | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const manualSource = useMemo<DetectedImportSource[] | undefined>(() => {
    const entry = manualSources.find((source) => source.id === platform);
    return manual === "results" && entry ? [{ id: entry.id, name: entry.name, description: "", detected: true, gameCount: null }] : undefined;
  }, [manual, platform]);

  const sidebarExtra = (
    <button type="button" className="import-source-missing" onClick={() => setManual("form")}>
      <span><strong>Platform not showing up?</strong><small>Pick a platform and point Mochi at its library folder.</small></span>
      <ChevronRight size={16} />
    </button>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-title" className="modal import-picker-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Game sources</p><h2 id="import-title">Import games</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button>
        </div>

        {manual === "form" ? (
          <div className="import-manual">
            <p className="modal-description">Choose the platform and point Mochi at its library folder. A Steam path can be the Steam folder, a library, or its steamapps folder.</p>
            <div className="import-manual-platforms" role="radiogroup" aria-label="Platform">
              {manualSources.map((source) => (
                <button type="button" role="radio" aria-checked={platform === source.id} key={source.id} className={"import-manual-platform" + (platform === source.id ? " selected" : "")} onClick={() => setPlatform(source.id)}>
                  <img src={launcherIcon(source.id)} alt="" width={28} height={28} /><strong>{source.name}</strong>
                </button>
              ))}
            </div>
            <div className="form-fields">
              <label>Game library path
                <div className="flatpak-input-row">
                  <input value={libraryPath} onChange={(event) => setLibraryPath(event.target.value)} placeholder="/home/you/Games" />
                  <button type="button" className="secondary-button" aria-label="Browse for folder" onClick={async () => { const chosen = await chooseGameLibraryPath(); if (chosen) setLibraryPath(chosen); }}><FolderOpen size={15} /></button>
                </div>
              </label>
            </div>
            <div className="import-manual-actions">
              <button type="button" className="secondary-button" onClick={() => setManual("closed")}><ArrowLeft size={15} /> Back</button>
              <button type="button" className="play-button" disabled={!platform || !libraryPath.trim()} onClick={() => setManual("results")}>Scan library <ChevronRight size={15} /></button>
            </div>
          </div>
        ) : manual === "results" && manualSource ? (
          <>
            <button type="button" className="text-button import-back" onClick={() => setManual("form")}><ArrowLeft size={14} /> Change platform or folder</button>
            <SourceGamePicker
              key={`${platform}:${libraryPath}`}
              sources={manualSource}
              scan={(id) => scanImportGames(id, libraryPath.trim())}
              renderAction={({ games }) => <button type="button" className="play-button" disabled={!games.length} onClick={() => onImport(games)}>Import {games.length} {games.length === 1 ? "game" : "games"}</button>}
            />
          </>
        ) : (
          <SourceGamePicker
            sidebarExtra={sidebarExtra}
            renderAction={({ games, sources }) => (
              <button type="button" className="play-button" disabled={!games.length} onClick={() => onImport(games)}>
                Import {games.length} {games.length === 1 ? "game" : "games"} from {sources.length} {sources.length === 1 ? "source" : "sources"}
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
}
