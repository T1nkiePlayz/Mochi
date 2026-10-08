import { useEffect, useState } from "react";
import { ExternalLink, Package } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchModrinth, type ModrinthProject } from "../lib/modrinth";
import { getNexusGames, getNexusMods, type NexusGame, type NexusMod } from "../lib/nexus";

export function LibraryModSearch({ query, nexusEnabled, supabase }: { query: string; nexusEnabled: boolean; supabase: SupabaseClient | null }) {
  const [modrinth, setModrinth] = useState<ModrinthProject[]>([]);
  const [nexus, setNexus] = useState<Array<{ game: NexusGame; mod: NexusMod }>>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const needle = query.trim();
    let cancelled = false;
    if (needle.length < 2) { setModrinth([]); setNexus([]); setMessage(""); return; }
    const timer = window.setTimeout(async () => {
      setLoading(true); setMessage("");
      const results = await Promise.allSettled([
        searchModrinth(needle, "mod"),
        nexusEnabled && supabase ? (async () => {
          const games = await getNexusGames(supabase, needle);
          const exactish = games.slice(0, 3);
          const mods = await Promise.all(exactish.map(async game => ({ game, mods: await getNexusMods(supabase, game.domainName) })));
          return mods.flatMap(({ game, mods }) => mods.slice(0, 5).map(mod => ({ game, mod })));
        })() : Promise.resolve([] as Array<{ game: NexusGame; mod: NexusMod }>),
      ]);
      if (!cancelled) {
        setModrinth(results[0].status === "fulfilled" ? results[0].value : []);
        setNexus(results[1].status === "fulfilled" ? results[1].value : []);
        if (results.every(result => result.status === "rejected")) setMessage("Mod search is temporarily unavailable.");
        else if (results.some(result => result.status === "rejected")) setMessage("Some provider results could not be loaded.");
        setLoading(false);
      }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, nexusEnabled, supabase]);
  if (query.trim().length < 2) return null;
  return <section className="library-mod-search">
    <div className="section-heading"><div><p className="eyebrow">Mods and community content</p><h3>Search results</h3></div>{loading && <span className="metadata-note">Searching…</span>}</div>
    {message && <p className="metadata-note">{message}</p>}
    {!loading && !modrinth.length && !nexus.length && !message && <p className="metadata-note">No matching mods found.</p>}
    <div className="library-mod-results">
      {modrinth.map(project => <article className="library-mod-result" key={`modrinth-${project.project_id}`}>
        {project.icon_url ? <img src={project.icon_url} alt="" loading="lazy"/> : <span className="library-mod-fallback"><Package size={17}/></span>}
        <span><strong>{project.title}</strong><small>Modrinth · {project.downloads.toLocaleString()} downloads</small><small>{project.description}</small></span>
        <button className="icon-button" aria-label={`Open ${project.title} on Modrinth`} onClick={() => void invoke("open_external_url", { url: `https://modrinth.com/mod/${encodeURIComponent(project.slug)}` })}><ExternalLink size={14}/></button>
      </article>)}
      {nexus.map(({ game, mod }) => <article className="library-mod-result" key={`nexus-${game.domainName}-${mod.id}`}>
        {mod.pictureUrl ? <img src={mod.pictureUrl} alt="" loading="lazy"/> : <span className="library-mod-fallback"><Package size={17}/></span>}
        <span><strong>{mod.name}</strong><small>Nexus Mods · {game.name}{mod.author ? ` · ${mod.author}` : ""}</small><small>{mod.summary || "Popular mod from the Nexus Mods feed."}</small></span>
        <button className="icon-button" aria-label={`Open ${mod.name} on Nexus Mods`} onClick={() => void invoke("open_external_url", { url: mod.modPageUrl })}><ExternalLink size={14}/></button>
      </article>)}
    </div>
    {nexusEnabled && nexus.length > 0 && <small className="metadata-note">Nexus displays up to five trending mods per matching game from its public feed.</small>}
  </section>;
}
