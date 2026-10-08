import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, PackageOpen, Plus, RefreshCw, Search, X } from "lucide-react";
import type { NexusGame, NexusMod } from "../../lib/nexus";
import { DiscoveryImage } from "./DiscoveryImage";

export function NexusGamePicker({ games, search, setSearch, onClose, onChoose, loading, error }: { games: NexusGame[]; search: string; setSearch: (value: string) => void; onClose: () => void; onChoose: (game: NexusGame) => void; loading: boolean; error: string }) {
  const value = search.trim().toLowerCase();
  const visible = games.filter(game => !value || game.name.toLowerCase().includes(value) || game.domainName.toLowerCase().includes(value));
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window nexus-game-picker-window" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Nexus Mods</p><h2>Add a game</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <p className="modal-description">Search the Nexus Mods game catalog and add a game as a permanent Discovery tab.</p>
    <label className="search-box nexus-game-search"><Search size={15}/><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Nexus games..." /></label>
    {error && <p className="metadata-note" role="alert">{error}</p>}
    {loading ? <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Loading games...</span></div> : <div className="nexus-game-picker-list">{visible.slice(0, 30).map(game => <button key={game.domainName} className="nexus-game-picker-row" type="button" onClick={() => onChoose(game)}>
      {game.iconUrl ? <img src={game.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>{game.domainName}{game.modCount ? " · " + game.modCount.toLocaleString() + " mods" : ""}</small></div><Plus size={15}/>
    </button>)}{!visible.length && <div className="discover-empty">No Nexus Mods games match your search.</div>}</div>}
  </div></div>;
}

export function NexusModDetails({ game, mod, onClose }: { game: NexusGame; mod: NexusMod; onClose: () => void }) {
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window nexus-mod-details" role="dialog" aria-modal="true" aria-label={`${mod.name} details`} onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{mod.pictureUrl ? <DiscoveryImage src={mod.pictureUrl} alt="" className="discover-card-icon" label={mod.name}/> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{game.name} · Nexus Mods</p><h2>{mod.name}</h2><p>{mod.summary || "No summary was provided by Nexus Mods."}</p><small>Created by <strong>{mod.author || "Unknown creator"}</strong></small></div></div><button className="icon-button" onClick={onClose} aria-label="Close mod details"><X size={17}/></button></div>
    <div className="project-overview"><h3>About this mod</h3><p className="nexus-mod-summary">{mod.summary || "Nexus Mods does not provide a description in its public trending feed."}</p><p className="metadata-note">Open the Nexus page for full description, files, requirements, and installation instructions.</p><button type="button" className="secondary-button" onClick={() => void invoke("open_external_url", { url: mod.modPageUrl })}><ExternalLink size={14}/> Open on Nexus</button></div>
  </div></div>;
}

