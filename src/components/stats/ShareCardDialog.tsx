import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, X } from "lucide-react";
import { ModalShell } from "../mods/ModalShell";
import { Segmented } from "./Segmented";
import { loadArtwork } from "../../lib/artworkCache";
import { buildCardData, buildCardSvg, copyPng, coverToDataUrl, defaultShareOptions, readPalette, savePng, svgDataUrl, svgToPng, type CardCovers, type ShareOptions, type SharePeriod } from "../../lib/shareCard";
import type { SessionRecord } from "../../lib/stats";
import type { Piko } from "../../models";
import { useTranslation } from "../../lib/useTranslation";

const TOGGLES: Array<[keyof Omit<ShareOptions, "period">, string]> = [["games", "Top games"], ["playtime", "Total playtime"], ["achievements", "Achievements count"], ["account", "Account name"]];

/** Experimental "Share card": builds a PNG of the stats locally; nothing is uploaded. */
export function ShareCardDialog({ records, library, unlocked, totalAchievements, username, onClose }: { records: SessionRecord[]; library: Piko[]; unlocked: number; totalAchievements: number; username: string; onClose: () => void }) {
  const t = useTranslation();
  const [options, setOptions] = useState<ShareOptions>(defaultShareOptions);
  const [covers, setCovers] = useState<CardCovers>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tried = useRef(new Set<string>());
  const palette = useMemo(() => readPalette(), []);
  const data = useMemo(() => buildCardData({ records, library, unlocked, totalAchievements, username, options }), [records, library, unlocked, totalAchievements, username, options]);
  const cardLabels = useMemo(() => ({ ariaLabel: t("Mochi stats card"), playStats: t("Play stats"), accountStats: t("Stats for {account}"), timePlayed: t("Time played"), achievements: t("Achievements"), topGames: t("Top games"), noGamesPlayed: t("No games played in this period."), generatedLocally: t("Generated locally by Mochi"), saveDialogTitle: t("Save share card"), pngImage: t("PNG image") }), [t]);
  const svg = useMemo(() => buildCardSvg(data, palette, covers, cardLabels), [data, palette, covers, cardLabels]);

  useEffect(() => {
    let cancelled = false;
    for (const game of data.games ?? []) {
      if (tried.current.has(game.gameId)) continue;
      tried.current.add(game.gameId);
      const key = library.find((piko) => piko.id === game.gameId)?.artworkCacheKey;
      if (!key) continue;
      void loadArtwork(key).then(coverToDataUrl).then((url) => { if (url && !cancelled) setCovers((current) => ({ ...current, [game.gameId]: url })); });
    }
    return () => { cancelled = true; };
  }, [data.games, library]);
  // A cancelled pass must be retried next time, so forget what it had started.
  useEffect(() => () => { tried.current.clear(); }, [data.games]);

  const toggle = (key: keyof Omit<ShareOptions, "period">, value: boolean) => setOptions((current) => ({ ...current, [key]: value }));
  const run = async (action: (blob: Blob) => Promise<string>) => {
    setBusy(true); setMessage(t("Preparing image…"));
    try { setMessage(await action(await svgToPng(svg, 1))); } catch (error) { setMessage(error instanceof Error ? t(error.message) : t("Something went wrong.")); } finally { setBusy(false); }
  };
  const onSave = () => run(async (blob) => ((await savePng(blob, { saveDialogTitle: t("Save share card"), pngImage: t("PNG image") })) ? t("Saved.") : ""));
  const onCopy = () => run(async (blob) => ((await copyPng(blob)) === "copied" ? t("Copied to the clipboard.") : t("Copying images is not supported here. Use Save PNG instead.")));

  return (
    <ModalShell label={t("Share card")} className="modal share-card-modal" onClose={onClose}>
      <div className="modal-header"><div><p className="eyebrow">{t("Experimental")}</p><h2>{t("Share card")}</h2></div><button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17} /></button></div>
      <div className="share-card-body">
        <img className="share-card-preview" src={svgDataUrl(svg)} alt={t("Preview of the share card")} />
        <div className="share-card-controls">
          <fieldset className="share-card-fieldset"><legend>{t("Include")}</legend>
            {TOGGLES.map(([key, label]) => <label key={key} className="check-row"><input type="checkbox" checked={options[key]} onChange={(event) => toggle(key, event.target.checked)} /> {t(label)}</label>)}
          </fieldset>
          <Segmented label={t("Period")} value={options.period} options={[{ value: "all", label: t("All time") }, { value: "30", label: t("Last 30 days") }]} onChange={(period: SharePeriod) => setOptions((current) => ({ ...current, period }))} />
          <p className="stats-muted">{t("Built on this device. Nothing is uploaded; only what is ticked appears on the image.")}</p>
          <div className="share-card-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={() => void onSave()}><Download size={14} /> {t("Save PNG")}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void onCopy()}><Copy size={14} /> {t("Copy image")}</button>
          </div>
          <p className="metadata-note" role="status">{message}</p>
        </div>
      </div>
    </ModalShell>
  );
}
