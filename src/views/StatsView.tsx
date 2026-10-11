import { useCallback, useEffect, useMemo, useState } from "react";
import { foldLegacyPlaytime } from "../lib/minecraftPiko";
import { BarChart3, Gamepad2 } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";
import { useApp } from "../state/AppContext";
import { useStoredAchievements } from "../state/useAchievements";
import { analyse, computeStreaks, dayTotals, formatDuration, formatHours, getPlaytimeHistory, groupByWeek, type RangeDays, type SessionRecord } from "../lib/stats";
import { buildFacts, countCollections, evaluate } from "../lib/achievements";
import { readJson, readString, storageKeys, writeString } from "../lib/storage";
import { isExtra } from "../lib/library";
import { Segmented } from "../components/stats/Segmented";
import { Composition, Heatmap, HourHistogram, StackedBars, TopGames, WeekdayPattern } from "../components/stats/Charts";
import { ShareCardDialog } from "../components/stats/ShareCardDialog";
import { usernameOf } from "../state/useAccount";
import { Share2 } from "lucide-react";
import { RecentSessions, YearInReview } from "../components/stats/SessionHistory";
import { useTranslation } from "../lib/useTranslation";
import { AchievementsPanel, RecentAchievements } from "../components/stats/AchievementsPanel";

const RANGES = [{ value: 7, label: "7 days" }, { value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 365, label: "Year" }] as const;
const RANGE_KEY = "mochi:stats-range";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="stat-kpi"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

function Card({ title, id, children, wide }: { title: string; id: string; children: React.ReactNode; wide?: boolean }) {
  return <section className={`stats-card${wide ? " wide" : ""}`} aria-labelledby={id}><div className="stats-card-head"><h2 id={id}>{title}</h2></div>{children}</section>;
}

export function StatsView() {
  const t = useTranslation();
  const { lib, playtime, sessions, setActiveNav, account } = useApp();
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<"overview" | "achievements">("overview");
  const [range, setRange] = useState<RangeDays>(() => { const v = Number(readString(RANGE_KEY)); return v === 7 || v === 90 || v === 365 ? v : 30; });
  const [records, setRecords] = useState<SessionRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const stored = useStoredAchievements();

  const load = useCallback(async () => {
    try { setRecords(await getPlaytimeHistory()); setFailed(false); } catch { setFailed(true); setRecords((current) => current ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load, playtime]);
  useEffect(() => {
    if (!sessions.sessions.length) return;
    // Refresh while a game runs, but not while Mochi is hidden; catch up when it becomes visible.
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [sessions.sessions.length, load]);

  const changeRange = (value: RangeDays) => { setRange(value); writeString(RANGE_KEY, String(value)); };
  const data = useMemo(() => records ?? [], [records]);
  const analysis = useMemo(() => analyse(data, range), [data, range]);
  const totals = useMemo(() => dayTotals(data), [data]);
  const streaks = useMemo(() => computeStreaks(totals), [totals]);
  const weekly = range === 365;
  const buckets = useMemo(() => (weekly ? groupByWeek(analysis.buckets) : analysis.buckets), [weekly, analysis.buckets]);
  const playtimeById = useMemo(() => new Map(foldLegacyPlaytime(playtime, lib.library).map((entry) => [entry.gameId, entry.seconds])), [playtime, lib.library]);
  const progress = useMemo(() => evaluate(buildFacts(data, lib.library, stored.flags, countCollections(readJson<unknown>(storageKeys.collections, []), lib.library))), [data, lib.library, stored.flags]);

  if (records === null) {
    return <div className="stats-view" aria-busy="true"><div className="stats-skeleton" /><div className="stats-skeleton tall" /></div>;
  }
  const empty = !data.some((record) => record.seconds > 0);

  return (
    <div className="stats-view">
      <div className="page-heading stats-heading">
        <div><p className="eyebrow">{t("Your activity")}</p><h1>{t("Stats")}</h1></div>
        <Segmented kind="tab" label={t("Stats sections")} value={tab} onChange={setTab} controls={(v) => `stats-panel-${v}`}
          options={[{ value: "overview", label: t("Overview") }, { value: "achievements", label: t("Achievements") }]} />
      </div>
      {failed && <p className="stats-note" role="status">{t("Play history is unavailable right now. Showing what is cached.")}</p>}

      {tab === "achievements" ? (
        <div role="tabpanel" id="stats-panel-achievements"><AchievementsPanel progress={progress} unlocked={stored.unlocked} /></div>
      ) : (
        <div role="tabpanel" id="stats-panel-overview" className="stats-panel">
          {empty ? (
            <div className="empty-state stats-empty">
              <div className="empty-icon"><MochiIcon name="stats" fallback={BarChart3} size={23} /></div>
              <h2>{t("No playtime yet")}</h2>
              <p>{t("Launch a game from Mochi and your sessions will show up here: hours per day, favourites, streaks and more. Everything stays on this device.")}</p>
              <button type="button" className="secondary-button" onClick={() => setActiveNav("Library")}><Gamepad2 size={14} /> Open library</button>
            </div>
          ) : (
            <>
              <div className="stats-toolbar">
                <Segmented label={t("Time range")} value={range} options={RANGES.map((r) => ({ ...r, label: t(r.label) }))} onChange={changeRange} />
                {<button type="button" className="secondary-button" onClick={() => setSharing(true)}><Share2 size={14} /> Share card</button>}
                {analysis.historicSeconds > 0 && <span className="stats-muted">{t("Plus {hours} played before Mochi kept history.").replace("{hours}", formatHours(analysis.historicSeconds))}</span>}
              </div>
              <div className="stats-kpis">
                <Kpi label={t("Time played")} value={formatDuration(analysis.totalSeconds)} />
                <Kpi label={t("Sessions")} value={String(analysis.sessionCount)} />
                <Kpi label={t("Average session")} value={analysis.sessionCount ? formatDuration(analysis.averageSeconds) : t("None")} />
                <Kpi label={t("Longest session")} value={analysis.longestSeconds ? formatDuration(analysis.longestSeconds) : t("None")} />
                <Kpi label={t("Games played")} value={String(analysis.gamesPlayed)} />
                <Kpi label={t("Current streak")} value={`${streaks.current} ${t(streaks.current === 1 ? "day" : "days")}`} hint={t("Longest {count}").replace("{count}", String(streaks.longest))} />
              </div>
              <Card id="st-days" title={weekly ? t("Hours per week") : t("Hours per day")} wide><StackedBars buckets={buckets} games={analysis.games} weekly={weekly} /></Card>
              <div className="stats-grid">
                <Card id="st-top" title={t("Top games")}>{analysis.games.length ? <TopGames games={analysis.games} library={lib.library} /> : <p className="stats-muted">{t("No games played in this range.")}</p>}</Card>
                <Card id="st-hours" title={t("Time of day")}><HourHistogram hours={analysis.hours} /></Card>
                <Card id="st-week" title={t("Weekday pattern")}><WeekdayPattern weekdays={analysis.weekdays} /></Card>
                <Card id="st-comp" title={t("Library by source")}>{lib.library.length ? <Composition library={lib.library.filter((piko) => !isExtra(piko))} playtime={playtimeById} /> : <p className="stats-muted">{t("Your library is empty.")}</p>}</Card>
              </div>
              <Card id="st-heat" title={t("Past year")} wide><Heatmap totals={totals} /></Card>
              <div className="stats-grid">
                <Card id="st-recent" title={t("Recent sessions")}><RecentSessions records={data} /></Card>
                <Card id="st-year" title={t("Year in review")}><YearInReview records={data} /></Card>
              </div>
              <RecentAchievements progress={progress} unlocked={stored.unlocked} onOpen={() => setTab("achievements")} />
            </>
          )}
        </div>
      )}
      {sharing && <ShareCardDialog records={data} library={lib.library} unlocked={progress.filter((item) => item.met).length} totalAchievements={progress.length} username={usernameOf(account.user)} onClose={() => setSharing(false)} />}
    </div>
  );
}
