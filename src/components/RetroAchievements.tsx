import { useId, useMemo, useState } from "react";
import { ExternalLink, Lock, RefreshCw, Trophy } from "lucide-react";
import { RemoteImage } from "./RemoteImage";
import { useOnline } from "../lib/offline";
import { useRaMatch, useRetroAchievements } from "../state/useRetroAchievements";
import { useTranslation } from "../lib/useTranslation";
import { getTranslationLocale } from "../lib/translationLocale";
import { openExternalUrl } from "../lib/platform";
import { raGameUrl, raPercent, sortRaAchievements, type RaAchievement } from "../lib/retroAchievements";

const PREVIEW = 12;
const dateText = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(getTranslationLocale(), { day: "numeric", month: "short", year: "numeric" });
const numberText = (value: number) => value.toLocaleString(getTranslationLocale());

function Badge({ item }: { item: RaAchievement }) {
  const t = useTranslation();
  const art = item.unlocked ? item.badge : item.badgeLocked || item.badge;
  const fallback = <span className="steam-ach-fallback" aria-hidden="true">{item.unlocked ? <Trophy size={16} /> : <Lock size={16} />}</span>;
  const when = item.unlocked && item.earnedAt ? `${item.hardcore ? t("Hardcore") : t("Softcore")} · ${dateText(item.earnedAt)}` : item.unlocked ? (item.hardcore ? t("Hardcore") : t("Softcore")) : t("Locked");
  return (
    <li className={`steam-ach-row ra-ach-row ${item.unlocked ? "unlocked" : "locked"}`}>
      {art ? <RemoteImage className="steam-ach-icon" src={art} alt="" loading="lazy" referrerPolicy="no-referrer" fallback={fallback} /> : fallback}
      <div className="steam-ach-text"><strong>{item.title}</strong><p>{item.description || t("No description.")}</p></div>
      <small className="steam-ach-date">{item.points} · {item.earnedAt ? <time dateTime={new Date(item.earnedAt * 1000).toISOString()}>{when}</time> : when}</small>
    </li>
  );
}

function Panel({ raGameId, gameName }: { raGameId: number; gameName: string }) {
  const t = useTranslation();
  const { loading, result, refresh } = useRetroAchievements(raGameId);
  const online = useOnline();
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listId = useId();
  const data = result?.data ?? null;
  const sorted = useMemo(() => (data ? sortRaAchievements(data.achievements) : []), [data]);
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW);
  const percent = data ? raPercent({ earned: data.earned, total: data.total }) : 0;
  const problem = !data && result ? t(result.message || "Achievements are unavailable right now.") : null;

  return (
    <section className="game-details-section steam-ach ra-ach" aria-labelledby={headingId} aria-busy={loading}>
      <div className="discover-section-heading">
        <div><h3 id={headingId}>{t("RetroAchievements")}</h3><p>{data ? `${numberText(data.earned)} ${t("of")} ${numberText(data.total)} ${t("unlocked")}` : t("Your progress in this game, read from your RetroAchievements account.")}</p></div>
        <span className="ra-ach-actions">
          <button type="button" className="text-button" onClick={() => void openExternalUrl(raGameUrl(raGameId)).catch(() => undefined)}><ExternalLink size={13} /> {t("View on RetroAchievements")}</button>
          <button type="button" className="text-button" onClick={() => void refresh()} disabled={loading || !online} aria-label={`${t("Refresh achievements")}: ${gameName}`}><RefreshCw size={13} className={loading ? "spin" : undefined} /> {loading ? t("Loading…") : t("Refresh")}</button>
        </span>
      </div>
      {data && (
        <>
          <div className="steam-ach-summary">
            <div className="stat-meter wide" role="progressbar" aria-label={`${gameName} RetroAchievements unlocked`} aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.earned} aria-valuetext={`${numberText(data.earned)} ${t("of")} ${numberText(data.total)}, ${numberText(percent)} ${t("percent")}`}><i style={{ width: `${percent}%` }} /></div>
            <span>{numberText(percent)}%</span>
          </div>
          <p className="steam-ach-note ra-ach-stats">
            <span>{t("Hardcore")}: {numberText(data.earnedHardcore)}</span> · <span>{t("Softcore")}: {numberText(data.earned - data.earnedHardcore)}</span> · <span>{t("{earned} of {total} points").replace("{earned}", numberText(data.pointsEarned)).replace("{total}", numberText(data.pointsTotal))}</span>
          </p>
        </>
      )}
      {loading && !data && <p className="stats-muted" role="status">{t("Loading achievements…")}</p>}
      {data && result?.stale && <p className="steam-ach-note" role="status">{online ? t(result.message || "Showing saved data; RetroAchievements could not be reached.") : t("You are offline. Showing the last saved achievements.")}</p>}
      {problem && !loading && <p className="steam-ach-note" role="status">{!online && result?.status === "offline" ? t("You are offline, and no saved achievements exist for this game yet.") : problem}</p>}
      {data && (
        <>
          <ul className="steam-ach-list" id={listId}>{shown.map((item) => <Badge key={item.id} item={item} />)}</ul>
          {sorted.length > PREVIEW && <button type="button" className="text-button steam-ach-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>{expanded ? t("Show fewer") : `${t("Show all")} ${numberText(sorted.length)}`}</button>}
        </>
      )}
    </section>
  );
}

/** Shown on a game's page once the game is linked to a RetroAchievements game (game editor > Metadata). Never throws. */
export function RetroAchievements({ gameId, gameName }: { gameId: string; gameName: string }) {
  const match = useRaMatch(gameId);
  return match ? <Panel key={match.raGameId} raGameId={match.raGameId} gameName={gameName} /> : null;
}
