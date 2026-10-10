import { useMemo, useState } from "react";
import { formatDuration, formatHours, type SessionRecord } from "../../lib/stats";
import { recentSessions, reviewYear, yearsWithPlay } from "../../lib/yearReview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const when = (start: number) => new Date(start * 1000).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Newest sessions, one row each. */
export function RecentSessions({ records }: { records: SessionRecord[] }) {
  const sessions = useMemo(() => recentSessions(records), [records]);
  if (!sessions.length) return <p className="stats-muted">Sessions appear here once you play from Mochi.</p>;
  return <ul className="session-history">{sessions.map((session) => <li key={`${session.gameId}:${session.start}`}><strong>{session.name}</strong><span>{when(session.start)}</span><span>{formatDuration(session.seconds)}</span></li>)}</ul>;
}

/** A shareable summary of one calendar year: totals, favourites and the busiest month, drawn from local history. */
export function YearInReview({ records }: { records: SessionRecord[] }) {
  const years = useMemo(() => yearsWithPlay(records), [records]);
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen ?? years[0];
  const review = useMemo(() => (year === undefined ? null : reviewYear(records, year)), [records, year]);
  if (!review || year === undefined) return <p className="stats-muted">Your year in review appears after you have played something.</p>;
  const peak = Math.max(...review.secondsByMonth, 1);
  const summary = `${review.year} in Mochi: ${formatHours(review.totalSeconds)} across ${review.gamesPlayed} game${review.gamesPlayed === 1 ? "" : "s"}${review.topGames[0] ? `, most of it in ${review.topGames[0].name}` : ""}.`;
  return <div className="year-review">
    <div className="year-review-head">
      <label>Year <select value={year} onChange={(event) => setChosen(Number(event.target.value))}>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={() => void navigator.clipboard?.writeText(summary).catch(() => undefined)}>Copy summary</button>
    </div>
    <p className="year-review-summary">{summary}</p>
    <div className="stats-kpis">
      <div className="stat-kpi"><span>Time played</span><strong>{formatDuration(review.totalSeconds)}</strong></div>
      <div className="stat-kpi"><span>Days played</span><strong>{review.daysPlayed}</strong></div>
      <div className="stat-kpi"><span>Sessions</span><strong>{review.sessions}</strong></div>
      <div className="stat-kpi"><span>Longest streak</span><strong>{review.longestStreak} day{review.longestStreak === 1 ? "" : "s"}</strong></div>
      {review.busiestMonth && <div className="stat-kpi"><span>Busiest month</span><strong>{MONTH_NAMES[review.busiestMonth.month]}</strong><small>{formatHours(review.busiestMonth.seconds)}</small></div>}
      {review.busiestDay && <div className="stat-kpi"><span>Busiest day</span><strong>{review.busiestDay.day}</strong><small>{formatHours(review.busiestDay.seconds)}</small></div>}
    </div>
    <ol className="year-review-top">{review.topGames.map((game) => <li key={game.gameId}><strong>{game.name}</strong><span>{formatHours(game.seconds)}</span></li>)}</ol>
    <div className="year-review-months" role="img" aria-label="Hours per month">{review.secondsByMonth.map((seconds, index) => <div key={index} title={`${MONTH_NAMES[index]}: ${formatHours(seconds)}`}><span style={{ height: `${Math.round((seconds / peak) * 100)}%` }} /><small>{MONTHS[index]}</small></div>)}</div>
  </div>;
}
