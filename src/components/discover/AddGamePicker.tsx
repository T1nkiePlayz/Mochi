import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { CfGame } from "../../lib/curseforge";
import { entryBadges, searchGameCatalog, type CatalogEntry } from "../../lib/mods/gameCatalog";
import type { NexusGame } from "../../lib/nexus";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupGameIcon } from "../../lib/gameIcons";
import { CurseforgeCredit } from "../mods/CurseforgeCredit";
import { ModalShell } from "../mods/ModalShell";
import { GameAvatar } from "./GameAvatar";
import type { StoredGame } from "./useDiscoverGames";

type Props = { cfGames: CfGame[] | null; nexusGames: NexusGame[]; cfEnabled: boolean; nexusEnabled: boolean; supabase: SupabaseClient | null; igdbConfigured: boolean; onChoose: (game: StoredGame) => void; onClose: () => void };

const toStored = (entry: CatalogEntry): StoredGame => entry.cf ? { k: "cf", id: entry.cf.id, slug: entry.cf.slug, nx: entry.nexus?.domain } : { k: "nx", domain: entry.nexus!.domain, name: entry.name };

/** Search the games CurseForge and Nexus Mods list (one row per game, with a badge per site) and add one as a Discover tab. */
export function AddGamePicker({ cfGames, nexusGames, cfEnabled, nexusEnabled, onChoose, onClose }: Props) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => searchGameCatalog(search,
    (cfGames ?? []).map((game) => ({ id: game.id, name: game.name, slug: game.slug, iconUrl: game.assets?.iconUrl })),
    nexusGames, { cfEnabled, nexusEnabled, limit: 60 }), [search, cfGames, nexusGames, cfEnabled, nexusEnabled]);

  useEffect(() => {
    if (!igdbConfigured || !supabase) return;
    let cancelled = false;
    // Resolve artwork for the visible search results first, not the entire Nexus catalogue.
    // Shared lookup caching means opening Discover tabs and this picker never duplicate requests.
    const candidates = rows.filter((entry) => entry.nexus && !entry.iconUrl && !resolvedIconsRef.current[entry.nexus.domain.toLocaleLowerCase()]).slice(0, 16);
    let nextIndex = 0;
    const worker = async () => {
      while (!cancelled) {
        const entry = candidates[nextIndex++];
        if (!entry?.nexus) return;
        try {
          const url = await lookupGameIcon(supabase, entry.nexus.domain, entry.name);
          if (url && !cancelled) setResolvedIcons((current) => current[entry.nexus!.domain.toLocaleLowerCase()] ? current : { ...current, [entry.nexus!.domain.toLocaleLowerCase()]: url });
        } catch { /* Initials remain as a graceful fallback when metadata is unavailable. */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, candidates.length) }, () => worker()));
    return () => { cancelled = true; };
  }, [rows, supabase, igdbConfigured]);

  return <ModalShell label="Add a game to Discover" className="tofu-picker-window nexus-game-picker-window" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Discover</p><h2>Add a game</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <p className="modal-description">Games on CurseForge need no account. Games on Nexus Mods list their mods without an account too (downloads need your Nexus key). A game on both is one entry.</p>
    <label className="search-box nexus-game-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search games, e.g. Dragonwilds..." aria-label="Search games" data-autofocus /></label>
    {!cfEnabled && !nexusEnabled && <p className="metadata-note" role="status">CurseForge and Nexus Mods are turned off in Settings.</p>}
    <div className="nexus-game-picker-list">
      {rows.map((entry) => <button key={entry.key} type="button" className="nexus-game-picker-row" onClick={() => onChoose(toStored(entry))}>
        <GameAvatar src={entry.iconUrl} fallbackSrcs={entry.nexus ? [resolvedIcons[entry.nexus.domain.toLocaleLowerCase()]].filter((url): url is string => Boolean(url)) : []} name={entry.name} />
        <div><strong>{entry.name}</strong>
          <small className="source-badges">{entryBadges(entry).map((badge) => <span key={badge} className="source-badge">{badge}</span>)}{entry.nexus?.modCount ? <span>{entry.nexus.modCount.toLocaleString()} mods on Nexus</span> : null}</small></div>
        <Plus size={15} /></button>)}
      {!rows.length && <div className="discover-empty">{cfGames === null && cfEnabled ? "Loading games..." : "No games match your search."}</div>}
    </div>
    {cfEnabled && <CurseforgeCredit />}
  </ModalShell>;
}
