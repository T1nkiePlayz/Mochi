import { useEffect, useMemo, useState } from "react";
import { Link2, PackageOpen, RefreshCw, Search, X } from "lucide-react";
import { CF_MINECRAFT_ID } from "../../lib/curseforge";
import { createCurseforgeSource } from "../../lib/mods/curseforgeSource";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { titleFromFile } from "../../lib/mods/identify";
import { recordInstanceMods, type InstanceMod } from "../../lib/mods/instances";
import { createModrinthSource } from "../../lib/mods/modrinthSource";
import { createNexusSource } from "../../lib/mods/nexusSource";
import { sourceLabels, type ModFile, type ModItem, type ModSource, type ModSourceId } from "../../lib/mods/types";
import { supabase } from "../../lib/supabase";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";
import { DiscoveryImage } from "../discover/DiscoveryImage";
import { ModalShell } from "./ModalShell";

type Props = { piko: Piko; tofu: Tofu; file: InstanceMod; subdir?: string; onLinked: (message: string) => void; onClose: () => void };

const normalize = (name: string) => name.toLowerCase().replace(/\.disabled$/, "");

/** The file of `item` that is this installed file (same file name), if the site still lists it. */
export function sameFile(files: readonly ModFile[], installedName: string): ModFile | undefined {
  const wanted = normalize(installedName);
  return files.find((file) => normalize(file.fileName) === wanted);
}

/**
 * Links a mod Mochi could not identify to its page on CurseForge, Modrinth or Nexus Mods: search, pick, and the record gets
 * the project (and the exact file when the site still lists it), so updates and "Downloaded" states work from then on.
 */
export function LinkModModal({ piko, tofu, file, subdir = "", onLinked, onClose }: Props) {
  const { behavior, credentials } = useApp();
  const minecraft = modSupportOf(piko) === "minecraft";
  const sources = useMemo(() => {
    const list: ModSource[] = [];
    const settings = behavior.modSources;
    if (minecraft && settings.modrinth) list.push(createModrinthSource(subdir === "resourcepacks" ? "resourcepack" : subdir === "shaderpacks" ? "shader" : "mod"));
    const cfGame = minecraft ? CF_MINECRAFT_ID : piko.modLinks?.curseforge?.gameId;
    if (settings.curseforge && cfGame) list.push(createCurseforgeSource({ gameId: cfGame, gameSlug: minecraft ? "minecraft" : piko.modLinks?.curseforge?.slug }));
    if (settings.nexus && credentials.status.nexus && supabase && piko.modLinks?.nexus) list.push(createNexusSource(supabase, piko.modLinks.nexus));
    return list;
  }, [minecraft, piko.modLinks, behavior.modSources, credentials.status.nexus, subdir]);
  const [sourceId, setSourceId] = useState<ModSourceId | undefined>(sources[0]?.id);
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];
  const [query, setQuery] = useState(titleFromFile(file.filename));
  const [results, setResults] = useState<ModItem[]>([]);
  const [state, setState] = useState<"idle" | "searching" | "linking" | "error">("idle");
  const [error, setError] = useState("");

  const search = async () => {
    if (!source || !query.trim()) return;
    setState("searching"); setError("");
    try {
      const page = await source.search({ query: query.trim(), offset: 0, limit: 20, sort: source.searchesServerSide ? (source.sorts.find((sort) => /relev/i.test(sort.value))?.value ?? source.defaultSort) : source.defaultSort });
      setResults(page.items); setState("idle");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed."); setState("error"); }
  };
  useEffect(() => { void search(); }, [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (item: ModItem) => {
    if (!source) return;
    setState("linking"); setError("");
    try {
      const match = sameFile(await source.files(item).catch(() => []), file.filename);
      const fileDate = match?.date ?? (file.modifiedMs ? new Date(file.modifiedMs).toISOString() : undefined);
      await recordInstanceMods(tofu.id, [{
        file: file.filename.replace(/\.disabled$/, ""), subdir, enabled: file.enabled,
        record: { source: item.source, projectId: item.id, fileId: match?.id ?? "", version: match?.version ?? match?.name ?? file.record?.version, title: item.name, iconUrl: item.source === "curseforge" ? undefined : item.iconUrl, fileDate },
      }]);
      onLinked(match ? `Linked ${file.filename} to ${item.name} on ${sourceLabels[item.source]}.` : `Linked ${file.filename} to ${item.name}. Mochi could not find this exact file on ${sourceLabels[item.source]}, so the next newer release counts as an update.`);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not link the mod."); setState("error"); }
  };

  return <ModalShell label={`Link ${file.filename}`} className="modal link-mod-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">Identify a mod</p><h2>{file.filename.replace(/\.disabled$/, "")}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    {!sources.length ? <p className="metadata-note" role="status">No mod site is linked to {piko.name}. Link the game to a mod site first (Link game), or turn a site on in Settings.</p> : <>
      {sources.length > 1 && <div className="mod-source-switch" role="group" aria-label="Mod site">{sources.map((item) => <button key={item.id} type="button" className={item.id === source?.id ? "active" : ""} aria-pressed={item.id === source?.id} onClick={() => setSourceId(item.id)}>{item.label}</button>)}</div>}
      <form className="link-mod-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="search-box"><Search size={14} /><input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search ${source?.label ?? ""}`} placeholder="Mod name" /></label>
        <button type="submit" className="secondary-button" disabled={state === "searching"}>{state === "searching" ? <RefreshCw size={13} className="spin" /> : <Search size={13} />} Search</button>
      </form>
      {error && <p className="metadata-note" role="alert">{error}</p>}
      <ul className="link-mod-results" aria-busy={state === "searching"}>
        {results.map((item) => <li key={`${item.source}:${item.id}`} className="link-mod-row">
          {item.iconUrl ? <DiscoveryImage src={item.iconUrl} className="link-mod-icon" alt="" label={item.name} /> : <span className="link-mod-icon fallback"><PackageOpen size={15} /></span>}
          <span className="link-mod-copy"><strong>{item.name}</strong><small>{item.author ?? sourceLabels[item.source]}{item.summary ? ` · ${item.summary}` : ""}</small></span>
          <button type="button" className="secondary-button" disabled={state === "linking"} onClick={() => void link(item)} aria-label={`Link to ${item.name}`}><Link2 size={13} /> This one</button>
        </li>)}
      </ul>
      {state === "idle" && !results.length && <p className="muted">Nothing found. Try a shorter name.</p>}
    </>}
  </ModalShell>;
}
