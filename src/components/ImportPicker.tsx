import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, FolderOpen, Gamepad2, RefreshCw, X } from "lucide-react";
import { chooseGameLibraryPath } from "../lib/platform";
import { detectImportSources, scanImportGames, type DetectedImportSource, type ImportSourceId, type ImportedGame } from "../lib/sources";

type ImportPickerProps = {
  onClose: () => void;
  onImport: (games: ImportedGame[]) => void;
};

const allSources: Array<{ id: ImportSourceId; name: string }> = [
  { id: "flatpak", name: "Flatpak" }, { id: "heroic", name: "Heroic Games Launcher" },
  { id: "steam", name: "Steam" }, { id: "lutris", name: "Lutris" },
  { id: "bottles", name: "Bottles" }, { id: "itch", name: "itch.io" },
];

export function ImportPicker({ onClose, onImport }: ImportPickerProps) {
  const [sources,setSources]=useState<DetectedImportSource[]>([]);
  const [selectedSource,setSelectedSource]=useState<ImportSourceId|null>(null);
  const [games,setGames]=useState<ImportedGame[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [manual,setManual]=useState(false);
  const [libraryPath,setLibraryPath]=useState("");
  const [busy,setBusy]=useState(true);

  const scan=()=>{setBusy(true);void detectImportSources().then(setSources).catch(()=>setSources([])).finally(()=>setBusy(false));};
  useEffect(scan,[]);

  const openSource=async(source:ImportSourceId,path?:string)=>{
    setSelectedSource(source);setBusy(true);
    try{const found=await scanImportGames(source,path);setGames(found);setSelected(new Set(found.map(g=>g.id)));setManual(false)}
    catch{setGames([])}
    finally{setBusy(false)}
  };

  if(selectedSource){
    return <div className="modal-backdrop" onClick={onClose}><div className="modal import-picker-modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">Import from {allSources.find(s=>s.id===selectedSource)?.name}</p><h2>Choose your games</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
      {busy?<div className="setup-scan-state"><RefreshCw size={19} className="spin"/><span>Reading the installed library…</span></div>:
      <>{games.length?<><p className="modal-description">Mochi found {games.length} installed game{games.length===1?"":"s"}. Nothing is moved or modified; Mochi stores a launch target that hands control back to the original platform.</p>
      <div className="import-game-list">{games.map(g=><button type="button" className={"import-game-row "+(selected.has(g.id)?"selected":"")} key={g.id} onClick={()=>setSelected(current=>{const next=new Set(current);next.has(g.id)?next.delete(g.id):next.add(g.id);return next})}><span className="import-source-icon">{selected.has(g.id)?<Check size={17}/>:<Gamepad2 size={17}/>}</span><span><strong>{g.name}</strong><small>{g.installPath||"Installed game"}</small></span></button>)}</div>
      <div className="import-manual-actions"><button className="secondary-button" onClick={()=>{setSelectedSource(null);setGames([])}}><ArrowLeft size={15}/> Back</button><button className="play-button" disabled={!selected.size} onClick={()=>onImport(games.filter(g=>selected.has(g.id)))}>Import {selected.size} game{selected.size===1?"":"s"} <ChevronRight size={15}/></button></div>
      </>:<div className="setup-no-sources"><Gamepad2 size={19}/><strong>No installed games found.</strong><span>The platform was detected, but its local library did not contain importable games.</span><button className="text-button" onClick={()=>setSelectedSource(null)}><ArrowLeft size={14}/> Choose another source</button></div>}</>}
    </div></div>;
  }

  const detected=sources.filter(s=>s.detected);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal import-picker-modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Game sources</p><h2>Import games</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    {manual?<><p className="modal-description">Choose the source and point Mochi at its library directory. Steam paths can be the Steam library itself or its steamapps directory.</p><div className="import-manual-platforms">{allSources.map(s=><button type="button" key={s.id} className={"import-manual-platform "+(selectedSource===s.id?"selected":"")} onClick={()=>setSelectedSource(s.id)}><span className="import-source-icon"><Gamepad2 size={17}/></span><strong>{s.name}</strong>{selectedSource===s.id&&<Check size={15}/>}</button>)}</div><div className="form-fields"><label>Game library path<div className="flatpak-input-row"><input value={libraryPath} onChange={e=>setLibraryPath(e.target.value)} placeholder="/home/you/Games"/><button type="button" className="secondary-button" onClick={async()=>{const p=await chooseGameLibraryPath();if(p)setLibraryPath(p)}}><FolderOpen size={15}/></button></div></label></div><div className="import-manual-actions"><button className="secondary-button" onClick={()=>{setManual(false);setSelectedSource(null)}}><ArrowLeft size={15}/> Back</button><button className="play-button" disabled={!selectedSource||!libraryPath.trim()} onClick={()=>selectedSource&&openSource(selectedSource,libraryPath.trim())}>Scan library <ChevronRight size={15}/></button></div></>:
    <>{busy?<div className="setup-scan-state"><RefreshCw size={19} className="spin"/><span>Scanning for game services…</span></div>:detected.length?<div className="import-source-list">{detected.map(s=><button type="button" className="import-source-row" key={s.id} onClick={()=>openSource(s.id)}><span className="import-source-icon"><Gamepad2 size={17}/></span><span><strong>{s.name}</strong><small>{s.gameCount??0} detected games</small></span><ChevronRight size={15}/></button>)}</div>:<div className="setup-no-sources"><Gamepad2 size={19}/><strong>No supported services detected.</strong><span>You can still configure a source manually.</span></div>}<div className="import-picker-footer"><button className="text-button" onClick={scan}><RefreshCw size={14}/> Scan again</button><button className="import-source-missing" onClick={()=>setManual(true)}><span><strong>Platform not showing up?</strong><small>Select a platform and specify its library path.</small></span><ChevronRight size={16}/></button></div></>}
  </div></div>;
}