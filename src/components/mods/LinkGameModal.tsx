import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Unlink, X } from "lucide-react";
import { cfAllGames, type CfGame } from "../../lib/curseforge";
import { getNexusGames, type NexusGame } from "../../lib/nexus";
import { normalizeGameName } from "../../lib/mods/gameSupport";
import { supabase } from "../../lib/supabase";
import type { Piko } from "../../models";
import { CurseforgeCredit } from "./CurseforgeCredit";
import { ModalShell } from "./ModalShell";

type Props = {
  piko: Piko;
  curseforgeEnabled: boolean;
  nexusEnabled: boolean;
  onSave: (links: NonNullable<Piko["modLinks"]>) => void;
  onClose: () => void;
};

/** Manual override of the automatic match: pick the CurseForge or Nexus Mods game this game belongs to, or unlink. */
export function LinkGameModal({ piko, curseforgeEnabled, nexusEnabled, onSave, onClose }: Props) {
  const [site, setSite] = useState<"curseforge" | "nexus">(curseforgeEnabled ? "curseforge" : "nexus");
  const [search, setSearch] = useState(piko.name);
  const [cfGames, setCfGames] = useState<CfGame[] | null>(null);
  const [nexusGames, setNexusGames] = useState<NexusGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = piko.modLinks;

  useEffect(() => {
    if (site !== "curseforge" || cfGames) return;
    setLoading(true); setError("");
    void cfAllGames().then(setCfGames).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load CurseForge games.")).finally(() => setLoading(false));
  }, [site, cfGames]);

  useEffect(() => {
    if (site !== "nexus" || !supabase) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void getNexusGames(supabase!, search).then((games) => { if (!cancelled) setNexusGames(games); })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to search Nexus Mods games."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [site, search]);

  const cfVisible = useMemo(() => {
    const wanted = normalizeGameName(search);
    return (cfGames ?? []).filter((game) => !wanted || normalizeGameName(game.name).includes(wanted)).slice(0, 40);
  }, [cfGames, search]);

  const save = (patch: Partial<NonNullable<Piko["modLinks"]>>) => { onSave({ ...(current ?? {}), ...patch, source: "user" }); onClose(); };
  const unlink = () => {
    const next: NonNullable<Piko["modLinks"]> = { ...(current ?? {}), source: "user" };
    if (site === "curseforge") delete next.curseforge; else delete next.nexus;
    onSave(next); onClose();
  };
  const linked = site === "curseforge" ? current?.curseforge : current?.nexus;

  return <ModalShell label={`Link ${piko.name} to a mod site`} className="tofu-picker-window nexus-game-picker-window" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{piko.name}</p><h2>Link this game to a mod site</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <p className="modal-description">Mochi matches games by name. If it picked wrongly or found nothing, choose the right game here. Your choice is remembered.</p>
    <div className="discover-tabs" role="tablist" aria-label="Mod site">
      {curseforgeEnabled && <button type="button" role="tab" aria-selected={site === "curseforge"} className={site === "curseforge" ? "active" : ""} onClick={() => setSite("curseforge")}>CurseForge</button>}
      {nexusEnabled && supabase && <button type="button" role="tab" aria-selected={site === "nexus"} className={site === "nexus" ? "active" : ""} onClick={() => setSite("nexus")}>Nexus Mods</button>}
    </div>
    {linked && <p className="metadata-note" role="status">Linked to <strong>{linked.name}</strong>. <button type="button" className="text-button" onClick={unlink}><Unlink size={13} /> Unlink</button></p>}
    <label className="search-box nexus-game-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${site === "curseforge" ? "CurseForge" : "Nexus Mods"} games...`} aria-label="Search games" data-autofocus /></label>
    {error && <p className="metadata-note" role="alert">{error}</p>}
    {loading ? <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Loading games...</span></div> : <div className="nexus-game-picker-list">
      {site === "curseforge" ? cfVisible.map((game) => <button key={game.id} type="button" className="nexus-game-picker-row" onClick={() => save({ curseforge: { gameId: game.id, slug: game.slug, name: game.name } })}>
        {game.assets?.iconUrl ? <img src={game.assets.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>{game.slug}</small></div><Plus size={15} /></button>)
        : nexusGames.slice(0, 40).map((game) => <button key={game.domainName} type="button" className="nexus-game-picker-row" onClick={() => save({ nexus: { domain: game.domainName, name: game.name } })}>
          {game.iconUrl ? <img src={game.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>{game.domainName}</small></div><Plus size={15} /></button>)}
      {!error && ((site === "curseforge" ? cfVisible.length : nexusGames.length) === 0) && <div className="discover-empty">No games match your search.</div>}
    </div>}
    {site === "curseforge" && <CurseforgeCredit />}
  </ModalShell>;
}
