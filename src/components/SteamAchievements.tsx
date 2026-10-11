import { useId, useMemo, useState, type FormEvent } from "react";
import { Lock, RefreshCw, Trophy } from "lucide-react";
import { RemoteImage } from "./RemoteImage";
import { useOnline } from "../lib/offline";
import { useSteamAchievements } from "../state/useSteamAchievements";
import { useTranslation } from "../lib/useTranslation";
import { getTranslationLocale } from "../lib/translationLocale";
import { readSteamConfig, sortSteamAchievements, steamPercent, writeSteamConfig, type SteamAchievement } from "../lib/steamAchievements";

const PREVIEW = 8;
const dateText = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(getTranslationLocale(), { day: "numeric", month: "short", year: "numeric" });

function Row({ item }: { item: SteamAchievement }) {
  const t = useTranslation();
  const masked = item.hidden && !item.unlocked;
  const art = item.unlocked ? item.icon : item.iconGray || item.icon;
  const fallback = <span className="steam-ach-fallback" aria-hidden="true">{masked || !item.unlocked ? <Lock size={16} /> : <Trophy size={16} />}</span>;
  return (
    <li className={`steam-ach-row ${item.unlocked ? "unlocked" : "locked"}${masked ? " masked" : ""}`}>
      {masked || !art ? fallback : <RemoteImage className="steam-ach-icon" src={art} alt="" loading="lazy" referrerPolicy="no-referrer" fallback={fallback} />}
      <div className="steam-ach-text">
        <strong>{masked ? t("Hidden achievement") : item.name}</strong>
        <p>{masked ? t("Details stay hidden until you unlock it.") : item.description || t("No description.")}</p>
      </div>
      <small className="steam-ach-date">{item.unlocked ? (item.unlockedAt ? <>{t("Unlocked")} <time dateTime={new Date(item.unlockedAt * 1000).toISOString()}>{dateText(item.unlockedAt)}</time></> : t("Unlocked")) : t("Locked")}</small>
    </li>
  );
}

/** Shown in a Steam game's Overview. Never throws: every failure becomes a calm message. */
export function SteamAchievements({ appid, gameName }: { appid: number; gameName: string }) {
  const { loading, result, refresh } = useSteamAchievements(appid);
  const online = useOnline();
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState(readSteamConfig);
  const headingId = useId();
  const listId = useId();
  const data = result?.data ?? null;
  const sorted = useMemo(() => (data ? sortSteamAchievements(data.achievements) : []), [data]);
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW);
  const percent = data ? steamPercent(data) : 0;

  const save = (event: FormEvent) => { event.preventDefault(); writeSteamConfig(config); void refresh(); };
  const status = result?.status;
  const problem = !data && result && status !== "no-achievements" ? result.message || "Achievements are unavailable right now." : null;
  const busy = status === "rate-limited";
  const needsSetup = status === "private" || status === "no-steam-user";

  return (
    <section className="game-details-section steam-ach" aria-labelledby={headingId} aria-busy={loading}>
      <div className="discover-section-heading">
        <div><h3 id={headingId}>Steam achievements</h3><p>{data ? `${data.unlocked} of ${data.total} unlocked` : "Your progress in this game, read from your Steam profile."}</p></div>
        <button type="button" className="text-button" onClick={() => void refresh()} disabled={loading || !online} aria-label={`Refresh ${gameName} achievements`}><RefreshCw size={13} className={loading ? "spin" : undefined} /> {loading ? "Loading…" : "Refresh"}</button>
      </div>
      {data && (
        <div className="steam-ach-summary">
          <div className="stat-meter wide" role="progressbar" aria-label={`${gameName} Steam achievements unlocked`} aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.unlocked} aria-valuetext={`${data.unlocked} of ${data.total}, ${percent} percent`}><i style={{ width: `${percent}%` }} /></div>
          <span>{percent}%</span>
        </div>
      )}
      {loading && !data && <p className="stats-muted" role="status">Loading achievements…</p>}
      {data && result?.stale && <p className="steam-ach-note" role="status">{online ? result.message || "Showing saved data; Steam could not be reached." : "You are offline. Showing the last saved achievements."}</p>}
      {busy && !data && <p className="steam-ach-note" role="status">{result?.message || "Steam is busy right now. Mochi will try again later."}</p>}
      {status === "no-achievements" && <p className="stats-muted" role="status">{result?.message || "This game has no Steam achievements."}</p>}
      {problem && !busy && <p className="steam-ach-note" role="status">{!online && status === "offline" ? "You are offline, and no saved achievements exist for this game yet." : problem}</p>}
      {needsSetup && (
        <details className="steam-ach-setup">
          <summary>Connect your Steam profile</summary>
          <form onSubmit={save}>
            <label>SteamID64 (optional)<input value={config.steamId} onChange={(event) => setConfig({ ...config, steamId: event.target.value })} inputMode="numeric" placeholder="76561198…" autoComplete="off" spellCheck={false} /></label>
            <label>Steam Web API key (optional)<input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} placeholder="32 character key" autoComplete="off" spellCheck={false} /></label>
            <small>Mochi never ships a key. A key you enter stays on this device and is only sent to Steam. Without one, Mochi reads your public Steam profile, so set Game details to Public in Steam's privacy settings.</small>
            <button type="submit" className="secondary-button">Save and retry</button>
          </form>
        </details>
      )}
      {data && (
        <>
          <ul className="steam-ach-list" id={listId}>{shown.map((item) => <Row key={item.apiName || item.name} item={item} />)}</ul>
          {sorted.length > PREVIEW && <button type="button" className="text-button steam-ach-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${sorted.length}`}</button>}
        </>
      )}
    </section>
  );
}
