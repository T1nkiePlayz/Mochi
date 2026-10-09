import { useState, type FormEvent } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { lookupIgdbGames, type IgdbGame } from "../../../lib/igdb";
import { applyIgdbMetadata, resolveIgdbImage } from "../../../lib/metadata";
import { bestIgdbMatch } from "../../../lib/search";
import { TagEditor } from "../TagEditor";
import type { EditorContext } from "./types";
import { cssUrl } from "../../../lib/metadata/merge";

const providerOf = (ctx: EditorContext, field: "name" | "description" | "categories" | "artwork") => {
  const { draft } = ctx;
  if (draft.lockedFields?.includes(field) || (field === "artwork" && draft.artworkSource === "custom")) return "You (edited)";
  if (field === "artwork") return draft.artworkSource === "igdb" ? "IGDB" : draft.artworkSource === "steamgriddb" ? "SteamGridDB" : draft.artworkSource === "steam" ? "Steam" : draft.artworkSource === "icon" ? "App icon" : draft.artworkUrl || draft.artworkCacheKey ? "Imported" : "None";
  return draft.igdbId ? "IGDB" : "Local";
};
const year = (game: IgdbGame) => game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null;

export function MetadataTab({ ctx }: { ctx: EditorContext }) {
  const { draft, patch, unlock, hasIgdb } = ctx;
  const [query, setQuery] = useState(draft.name);
  const [candidates, setCandidates] = useState<IgdbGame[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!supabase || !hasIgdb || !query.trim()) return;
    setBusy(true); setMessage("");
    try { setCandidates(await lookupIgdbGames(supabase, query)); }
    catch { setCandidates([]); setMessage(offline ? "You are offline. Try again when you are connected." : "IGDB could not be reached right now."); }
    finally { setBusy(false); }
  };

  const apply = (match: IgdbGame) => {
    const next = applyIgdbMetadata(draft, match);
    patch({ name: next.name, categories: next.categories, description: next.description, artworkUrl: next.artworkUrl, artworkCacheKey: next.artworkCacheKey, artwork: next.artwork, artworkSource: next.artworkSource, igdbId: next.igdbId, screenshots: next.screenshots, trailerId: next.trailerId, firstReleaseDate: next.firstReleaseDate });
    setMessage(`Matched to ${match.name}. Save to keep it.`);
  };

  const remove = () => {
    patch({ igdbId: undefined, screenshots: undefined, trailerId: undefined, firstReleaseDate: undefined, categories: draft.lockedFields?.includes("categories") ? draft.categories : [],
      ...(draft.artworkSource === "igdb" ? { artworkUrl: undefined, artwork: "", artworkSource: undefined } : {}) });
    ctx.setArtworkReset(draft.artworkSource === "igdb");
    setMessage("Metadata removed. Save to keep this.");
  };

  const refresh = async () => {
    setBusy(true); setMessage("");
    try {
      if (ctx.refreshGame) { await ctx.refreshGame(draft); setMessage("Refreshed from the provider."); }
      else if (supabase && hasIgdb) {
        const found = await lookupIgdbGames(supabase, draft.name);
        const match = found.find((game) => game.id && game.id === draft.igdbId) ?? bestIgdbMatch(draft.name, found);
        if (match) apply(match); else setMessage("No confident match found. Search by hand below.");
      } else setMessage("Connect IGDB in Settings to refresh metadata.");
    } catch { setMessage(offline ? "You are offline." : "Refresh failed. Try again later."); }
    finally { setBusy(false); }
  };

  const rows: Array<{ label: string; value: string; field: "name" | "description" | "categories" | "artwork" }> = [
    { label: "Name", value: draft.name, field: "name" },
    { label: "Description", value: draft.description ? `${draft.description.slice(0, 90)}${draft.description.length > 90 ? "…" : ""}` : "None", field: "description" },
    { label: "Genres", value: draft.categories?.join(", ") || "None", field: "categories" },
    { label: "Artwork", value: draft.artworkCacheKey || draft.artworkUrl ? "Set" : "None", field: "artwork" },
  ];

  return <div className="editor-fields">
    <ul className="metadata-provider-list">
      {rows.map((row) => <li key={row.field}>
        <span className="editor-field-label">{row.label}</span><span className="metadata-value">{row.value}</span>
        <span className="metadata-source">{providerOf(ctx, row.field)}</span>
        {row.field !== "artwork" && draft.lockedFields?.includes(row.field) && <button type="button" className="text-button" onClick={() => unlock(row.field as "name")}>Reset to automatic</button>}
      </li>)}
    </ul>
    <div className="editor-field"><span className="editor-field-label">Genres</span>
      <TagEditor label="Genres" tags={draft.categories ?? []} suggestions={[]} onChange={(categories) => patch({ categories }, "categories")} /></div>

    <div className="editor-actions-row">
      <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy || (!hasIgdb && !ctx.refreshGame)}><RefreshCw size={14} className={busy ? "spin" : ""} /> Refresh this game</button>
      <button type="button" className="secondary-button danger-outline" onClick={remove} disabled={!draft.igdbId && !draft.screenshots?.length}><Trash2 size={14} /> Remove metadata</button>
    </div>

    <section className="metadata-match">
      <h3>Wrong match?</h3>
      {hasIgdb ? <>
        <form className="artwork-search-bar" onSubmit={(event) => void search(event)}>
          <label className="artwork-search-input"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search IGDB" placeholder="Search IGDB by name" /></label>
          <button type="submit" className="secondary-button" disabled={busy || !query.trim()}>Search</button>
        </form>
        {candidates && <div className="igdb-candidates">{candidates.map((game) => {
          const art = resolveIgdbImage(game.cover?.url, "t_cover_big");
          return <button type="button" key={game.id ?? game.name} className={`igdb-candidate ${game.id && game.id === draft.igdbId ? "selected" : ""}`} onClick={() => apply(game)}>
            <div className="igdb-candidate-art" style={{ backgroundImage: art ? cssUrl(art) : undefined }} />
            <div className="igdb-candidate-copy"><strong>{game.name}{year(game) ? ` (${year(game)})` : ""}</strong><small>{game.genres?.map((genre) => genre.name).join(" · ") || "Genre unknown"}</small>{game.summary && <p>{game.summary}</p>}</div>
          </button>;
        })}{!candidates.length && !busy && <p className="metadata-note">No games found for that search.</p>}</div>}
      </> : <p className="metadata-note">{offline ? "You are offline. " : ""}IGDB matching needs you to be signed in with an IGDB key saved in Settings. Everything here can still be edited by hand.</p>}
    </section>
    {message && <p className="metadata-note" role="status">{message}</p>}
  </div>;
}
