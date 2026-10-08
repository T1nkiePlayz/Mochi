import { useEffect, useRef, useState } from "react";
import { Search, WifiOff } from "lucide-react";
import { Select } from "../ui/Select";
import { searchArtwork, type ArtworkCandidate } from "../../lib/artworkSearch";

type Provider = "all" | "steamgriddb" | "igdb";

type Props = { initialQuery: string; onPick: (candidate: ArtworkCandidate) => void; onCancel: () => void };

/** Searches the artwork providers; never needs an API key on this device (keys live server-side). */
export function ArtworkSearchPicker({ initialQuery, onPick, onCancel }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [provider, setProvider] = useState<Provider>("all");
  const [results, setResults] = useState<ArtworkCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useRef(0);

  const search = async () => {
    const id = ++run.current;
    setBusy(true); setFailed(false);
    try {
      const found = await searchArtwork(query.trim(), { provider });
      if (id === run.current) setResults(found);
    } catch { if (id === run.current) { setResults([]); setFailed(true); } }
    finally { if (id === run.current) setBusy(false); }
  };
  useEffect(() => { if (initialQuery.trim()) void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return <div className="artwork-search">
    <form className="artwork-search-bar" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <label className="artwork-search-input"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a game" aria-label="Artwork search" autoFocus /></label>
      <Select<Provider> label="Provider" value={provider} onChange={setProvider} align="end" options={[{ value: "all", label: "All providers" }, { value: "steamgriddb", label: "SteamGridDB" }, { value: "igdb", label: "IGDB" }]} />
      <button type="submit" className="secondary-button" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</button>
      <button type="button" className="text-button" onClick={onCancel}>Back</button>
    </form>
    {results?.length ? <div className="artwork-search-grid" role="list">{results.map((item) => <button type="button" role="listitem" className="artwork-search-item" key={`${item.provider}-${item.id}`} onClick={() => onPick(item)} aria-label={`Use ${item.style ?? "artwork"} from ${item.provider}, ${item.width} by ${item.height}`}>
      <img src={item.thumbUrl} alt="" loading="lazy" />
      <small>{item.provider} · {item.width}×{item.height}{item.style ? ` · ${item.style}` : ""}</small>
    </button>)}</div> : null}
    {results && !results.length && !busy && <p className="metadata-note artwork-search-empty">
      {offline ? <><WifiOff size={13} /> You are offline. Use a file, URL or paste instead.</>
        : failed ? "Artwork search is unavailable right now. Use a file, URL or paste instead."
        : "No artwork found. Provider keys are added in Settings (account required); you can always use a file, URL or paste."}
    </p>}
  </div>;
}
