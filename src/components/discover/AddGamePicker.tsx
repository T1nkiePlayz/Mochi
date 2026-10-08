import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import type { CfGame } from "../../lib/curseforge";
import { bestNameMatch } from "../../lib/mods/gameMatch";
import { normalizeGameName } from "../../lib/mods/gameSupport";
import { getNexusGames, type NexusGame } from "../../lib/nexus";
import { supabase } from "../../lib/supabase";
import { CurseforgeCredit } from "../mods/CurseforgeCredit";
import { ModalShell } from "../mods/ModalShell";
import type { StoredGame } from "./useDiscoverGames";

type Props = { cfGames: CfGame[] | null; cfEnabled: boolean; nexusEnabled: boolean; onChoose: (game: StoredGame) => void; onClose: () => void };

/** Search CurseForge's games (and Nexus Mods' games that CurseForge lacks) and add one as a Discover tab. */
export function AddGamePicker({ cfGames, cfEnabled, nexusEnabled, onChoose, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [nexus, setNexus] = useState<NexusGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!nexusEnabled || !supabase) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void getNexusGames(supabase!, search).then((games) => { if (!cancelled) setNexus(games); })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to search Nexus Mods games."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, search ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [nexusEnabled, search]);

  const wanted = normalizeGameName(search);
  const cfVisible = useMemo(() => cfEnabled ? (cfGames ?? []).filter((game) => !wanted || normalizeGameName(game.name).includes(wanted)).slice(0, 30) : [], [cfGames, cfEnabled, wanted]);
  const nexusVisible = useMemo(() => nexus.filter((game) => !(cfEnabled && cfGames && bestNameMatch(game.name, cfGames))).slice(0, 20), [nexus, cfGames, cfEnabled]);

  return <ModalShell label="Add a game to Discover" className="tofu-picker-window nexus-game-picker-window" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Discover</p><h2>Add a game</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <p className="modal-description">Add a game as a Discover tab. Games on CurseForge need no account. Nexus Mods is listed only for games CurseForge does not have.</p>
    <label className="search-box nexus-game-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search games..." aria-label="Search games" data-autofocus /></label>
    {error && <p className="metadata-note" role="alert">{error}</p>}
    <div className="nexus-game-picker-list">
      {cfVisible.map((game) => <button key={`cf${game.id}`} type="button" className="nexus-game-picker-row" onClick={() => onChoose({ k: "cf", id: game.id, slug: game.slug })}>
        {game.assets?.iconUrl ? <img src={game.assets.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>CurseForge</small></div><Plus size={15} /></button>)}
      {nexusVisible.map((game) => <button key={`nx${game.domainName}`} type="button" className="nexus-game-picker-row" onClick={() => onChoose({ k: "nx", domain: game.domainName })}>
        {game.iconUrl ? <img src={game.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>Nexus Mods{game.modCount ? ` · ${game.modCount.toLocaleString()} mods` : ""}</small></div><Plus size={15} /></button>)}
      {loading && <div className="discover-loading"><RefreshCw size={16} className="spin" /><span>Searching...</span></div>}
      {!loading && !cfVisible.length && !nexusVisible.length && <div className="discover-empty">No games match your search.</div>}
    </div>
    {cfEnabled && <CurseforgeCredit />}
  </ModalShell>;
}
