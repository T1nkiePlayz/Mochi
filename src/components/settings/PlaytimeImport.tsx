import { useEffect, useMemo, useState } from "react";
import type { Piko } from "../../models";
import { useTranslation } from "../../lib/useTranslation";
import {
  detectPlaytimeSources, importPlaytime, playtimeSourceLabels, playtimeTargets, previewPlaytimeImport,
  type PlaytimePreviewRow, type PlaytimeSource,
} from "../../lib/playtimeImport";

/**
 * Playtime already recorded by Heroic, Lutris or GOG Galaxy, next to the Steam import: pick a
 * source found on this device, preview what would be added, then import. Importing twice adds nothing.
 */
export function PlaytimeImport({ library, onImported }: { library: Piko[]; onImported: () => void }) {
  const t = useTranslation();
  const [sources, setSources] = useState<PlaytimeSource[]>([]);
  const [source, setSource] = useState<PlaytimeSource | "">("");
  const [rows, setRows] = useState<PlaytimePreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const targets = useMemo(() => playtimeTargets(library), [library]);

  useEffect(() => {
    let alive = true;
    detectPlaytimeSources().then((found) => { if (alive) { setSources(found); setSource(found[0] ?? ""); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!sources.length) return null;
  const fail = (error: unknown) => setNote({ text: error instanceof Error ? error.message : String(error), error: true });
  const label = source ? playtimeSourceLabels[source] : "";
  const preview = async () => {
    if (!source || busy) return;
    setBusy(true); setNote(null);
    try {
      const found = await previewPlaytimeImport(source, targets);
      setRows(found);
      if (!found.length) setNote({ text: t("Nothing to import from {source}: everything already matches.").replace("{source}", label), error: false });
    } catch (error) { setRows(null); fail(error); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!source || busy) return;
    setBusy(true); setNote(null);
    try {
      const result = await importPlaytime(source, targets);
      setRows(null);
      setNote({ text: t("{source} playtime imported for {count} games.").replace("{source}", label).replace("{count}", String(result.imported)), error: false });
      onImported();
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  };
  return <>
    <div className="setting-row"><span><strong>{t("Import playtime from other launchers")}</strong><small>{t("Adds the playtime Heroic, Lutris or GOG Galaxy already recorded to Mochi's stats. Preview it first; importing twice adds nothing.")}</small></span>
      <span className="row-actions">
        <select aria-label={t("Playtime source")} value={source} disabled={busy} onChange={(event) => { setSource(event.target.value as PlaytimeSource); setRows(null); setNote(null); }}>{sources.map((id) => <option key={id} value={id}>{playtimeSourceLabels[id]}</option>)}</select>
        <button type="button" className="secondary-button" disabled={busy || targets.length === 0} onClick={() => void preview()}>{t("Preview")}</button>
      </span>
    </div>
    {rows && rows.length > 0 && <div className="setting-row"><span><ul aria-label={t("Playtime to import")}>{rows.map((row) => <li key={row.gameId}>{row.name}: {t("{minutes} min").replace("{minutes}", String(row.minutes))}</li>)}</ul></span>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void run()}>{t("Import {count} games").replace("{count}", String(rows.length))}</button></div>}
    {note && <p className="metadata-note settings-note" role={note.error ? "alert" : "status"}>{note.text}</p>}
  </>;
}
