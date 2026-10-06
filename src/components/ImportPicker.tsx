import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, FolderOpen, Gamepad2, RefreshCw, X } from "lucide-react";
import { chooseGameLibraryPath } from "../lib/platform";
import { detectImportSources, type DetectedImportSource, type ImportSourceId } from "../lib/sources";

type ImportPickerProps = {
  onClose: () => void;
  onImport: (source: ImportSourceId, libraryPath?: string) => void;
};

const allSources: Array<{ id: ImportSourceId; name: string }> = [
  { id: "flatpak", name: "Flatpak" },
  { id: "heroic", name: "Heroic Games Launcher" },
  { id: "steam", name: "Steam" },
  { id: "lutris", name: "Lutris" },
  { id: "bottles", name: "Bottles" },
  { id: "itch", name: "itch.io" },
];

export function ImportPicker({ onClose, onImport }: ImportPickerProps) {
  const [sources, setSources] = useState<DetectedImportSource[]>([]);
  const [selected, setSelected] = useState<ImportSourceId | null>(null);
  const [manual, setManual] = useState(false);
  const [libraryPath, setLibraryPath] = useState("");
  const [busy, setBusy] = useState(true);

  const scan = () => {
    setBusy(true);
    void detectImportSources().then(setSources).catch(() => setSources([])).finally(() => setBusy(false));
  };

  useEffect(scan, []);

  const detected = sources.filter((source) => source.detected);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-picker-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">{manual ? "Manual source" : "Game sources"}</p><h2>{manual ? "Platform not showing up?" : "Import games"}</h2></div>
          <button className="icon-button" onClick={onClose}><X size={17} /></button>
        </div>

        {manual ? (
          <>
            <p className="modal-description">Choose the platform you are trying to import, then point Mochi at its game library. This is useful for custom installations or launchers Mochi has not detected automatically.</p>
            <div className="import-manual-platforms">
              {allSources.map((source) => <button type="button" key={source.id} className={`import-manual-platform ${selected === source.id ? "selected" : ""}`} onClick={() => setSelected(source.id)}><span className="import-source-icon"><Gamepad2 size={17} /></span><strong>{source.name}</strong>{selected === source.id && <Check size={15} />}</button>)}
            </div>
            <div className="form-fields">
              <label>Game library path<input value={libraryPath} onChange={(event) => setLibraryPath(event.target.value)} placeholder="/path/to/your/game/library" /></label>
            </div>
            <div className="import-manual-actions"><button type="button" className="secondary-button" onClick={() => { setManual(false); setSelected(null); }}><ArrowLeft size={15} /> Back</button><button type="button" className="play-button" disabled={!selected || !libraryPath.trim()} onClick={() => selected && onImport(selected, libraryPath.trim())}>Import from path <ChevronRight size={15} /></button></div>
          </>
        ) : (
          <>
            <p className="modal-description">Mochi only shows services detected on this computer. Existing launchers remain responsible for their installations, updates and runtimes.</p>
            {busy ? <div className="setup-scan-state"><RefreshCw size={19} className="spin" /><span>Scanning for game services...</span></div> : detected.length ? <div className="import-source-list">{detected.map((source) => <button type="button" className="import-source-row" key={source.id} onClick={() => onImport(source.id)}><span className="import-source-icon"><Gamepad2 size={17} /></span><span><strong>{source.name}</strong><small>{source.gameCount !== null ? `${source.gameCount} detected games` : "Detected on this device"}</small></span><ChevronRight size={15} /></button>)}</div> : <div className="setup-no-sources"><Gamepad2 size={19} /><strong>No supported services detected.</strong><span>You can still configure a source manually.</span></div>}
            <div className="import-picker-footer"><button type="button" className="text-button" onClick={scan}><RefreshCw size={14} /> Scan again</button><button type="button" className="import-source-missing" onClick={() => setManual(true)}><span><strong>Platform not showing up?</strong><small>Select a platform and specify its library path.</small></span><ChevronRight size={16} /></button></div>
          </>
        )}
      </div>
    </div>
  );
}
