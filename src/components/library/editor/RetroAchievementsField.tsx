import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "../../../lib/useTranslation";
import { Select } from "../../ui/Select";
import { RA_CHANGED, RA_CONSOLES, autoSuggest, consoleIdForPlatform, hasRaCredentials, parseGameId, readRaConfig, readRaMatch, searchRaGames, writeRaMatch, type RaGame, type RaMatch } from "../../../lib/retroAchievements";
import type { EditorContext } from "./types";

/** Links a game to its RetroAchievements game. Changes apply at once and stay on this device (see `writeRaMatch`). */
export function RetroAchievementsField({ ctx }: { ctx: EditorContext }) {
  const t = useTranslation();
  const gameId = ctx.game.id;
  const [match, setMatch] = useState<RaMatch | null>(() => readRaMatch(gameId));
  const known = consoleIdForPlatform(ctx.draft.platformCategory);
  const [consoleId, setConsoleId] = useState<string>(String(match?.consoleId ?? known ?? ""));
  const [query, setQuery] = useState(ctx.draft.name);
  const [manual, setManual] = useState("");
  const [results, setResults] = useState<RaGame[] | null>(null);
  const [suggestion, setSuggestion] = useState<RaGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const credentials = hasRaCredentials(readRaConfig());

  useEffect(() => {
    const sync = () => setMatch(readRaMatch(gameId));
    window.addEventListener(RA_CHANGED, sync);
    return () => window.removeEventListener(RA_CHANGED, sync);
  }, [gameId]);

  const run = async (text: string, auto: boolean) => {
    const id = Number(consoleId);
    if (!id) { setMessage(t("Choose a console first.")); return; }
    setBusy(true); setMessage("");
    const found = await searchRaGames(id, text);
    setBusy(false);
    if (found.status !== "ok") { setResults(null); setMessage(t(found.message || "The search failed.")); return; }
    if (auto) setSuggestion(autoSuggest(text, found.games)); else setResults(found.games);
    if (!found.games.length) setMessage(t("No games found for that search."));
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (query.trim()) void run(query, false); };
  // With a known console the best obvious match is offered once, without the user typing anything.
  useEffect(() => {
    if (!credentials || match || !known || suggestion) return;
    void run(ctx.draft.name, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = (raGameId: number, title?: string) => {
    const next: RaMatch = { raGameId, ...(Number(consoleId) ? { consoleId: Number(consoleId) } : {}), ...(title ? { title } : {}) };
    writeRaMatch(gameId, next); setMatch(next); setResults(null); setSuggestion(null); setManual(""); setMessage("");
  };
  const manualId = parseGameId(manual);

  return <section className="metadata-match" aria-label={t("RetroAchievements game")}>
    <h3>{t("RetroAchievements game")}</h3>
    <p className="metadata-note">{match ? t("Linked to {title}.").replace("{title}", match.title || `#${match.raGameId}`) : t("Not linked")} {t("Changes here apply right away and stay on this device.")}</p>
    {match && <div className="editor-actions-row"><button type="button" className="secondary-button danger-outline" onClick={() => { writeRaMatch(gameId, null); setMatch(null); }}>{t("Unlink")}</button></div>}
    {!credentials && <p className="metadata-note">{t("Add your RetroAchievements user name and Web API key in Settings > Achievements.")}</p>}
    {credentials && <>
      <Select value={consoleId} label={t("Console")} placeholder={t("Choose a console")} onChange={setConsoleId} options={RA_CONSOLES.map((item) => ({ value: String(item.id), label: item.name }))} />
      {suggestion && !match && <p className="metadata-note">{t("Suggested match")}: <strong>{suggestion.title}</strong> <button type="button" className="text-button" onClick={() => link(suggestion.id, suggestion.title)}>{t("Use suggestion")}</button></p>}
      <form className="artwork-search-bar" onSubmit={submit}>
        <label className="artwork-search-input"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("Search by title")} placeholder={t("Search by title")} /></label>
        <button type="submit" className="secondary-button" disabled={busy || !query.trim()}>{t("Search")}</button>
      </form>
      {results && <div className="igdb-candidates">{results.map((game) => <button type="button" key={game.id} className={`igdb-candidate ${game.id === match?.raGameId ? "selected" : ""}`} onClick={() => link(game.id, game.title)}>
        <div className="igdb-candidate-copy"><strong>{game.title}</strong><small>{game.consoleName} · {game.numAchievements}</small></div>
      </button>)}</div>}
    </>}
    <div className="artwork-search-bar">
      <label className="artwork-search-input"><input value={manual} inputMode="numeric" onChange={(event) => setManual(event.target.value)} aria-label={t("RetroAchievements game ID")} placeholder={t("RetroAchievements game ID")} /></label>
      <button type="button" className="secondary-button" disabled={manualId === null} onClick={() => manualId !== null && link(manualId)}>{t("Link game")}</button>
    </div>
    {busy && <p className="metadata-note" role="status">{t("Loading…")}</p>}
    {message && <p className="metadata-note" role="status">{message}</p>}
  </section>;
}
