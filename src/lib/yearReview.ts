import { computeStreaks, dayTotals, splitAtMidnight, type SessionRecord } from "./stats";

export type YearReview = {
  year: number;
  totalSeconds: number;
  sessions: number;
  gamesPlayed: number;
  daysPlayed: number;
  longestStreak: number;
  /** Month index 0-11 with the most play, and its seconds (null when nothing was played). */
  busiestMonth: { month: number; seconds: number } | null;
  /** Local day key with the most play. */
  busiestDay: { day: string; seconds: number } | null;
  topGames: Array<{ gameId: string; name: string; seconds: number }>;
  secondsByMonth: number[];
};

/** Years that have any recorded play, newest first. */
export function yearsWithPlay(records: SessionRecord[]): number[] {
  const years = new Set<number>();
  for (const record of records) if (record.kind !== "historic" && record.seconds > 0) years.add(new Date(record.start * 1000).getFullYear());
  return [...years].sort((a, b) => b - a);
}

/** Totals for one calendar year (local time). Sessions are split at midnight so a late-night session lands on the right day. */
export function reviewYear(records: SessionRecord[], year: number): YearReview {
  const inYear = records.filter((record) => record.kind !== "historic");
  const byGame = new Map<string, { name: string; seconds: number }>();
  const byMonth = new Array<number>(12).fill(0);
  const byDay = new Map<string, number>();
  let sessions = 0;
  for (const record of inYear) {
    let counted = false;
    for (const piece of splitAtMidnight(record)) {
      if (!piece.day.startsWith(`${year}-`) || piece.seconds <= 0) continue;
      byMonth[Number(piece.day.slice(5, 7)) - 1]! += piece.seconds;
      byDay.set(piece.day, (byDay.get(piece.day) ?? 0) + piece.seconds);
      const game = byGame.get(piece.gameId) ?? { name: piece.name, seconds: 0 };
      game.seconds += piece.seconds;
      byGame.set(piece.gameId, game);
      counted = true;
    }
    if (counted) sessions += record.kind === "session" ? 1 : record.count;
  }
  const totalSeconds = byMonth.reduce((sum, value) => sum + value, 0);
  const month = byMonth.reduce((best, value, index) => (value > best.seconds ? { month: index, seconds: value } : best), { month: 0, seconds: 0 });
  const day = [...byDay.entries()].reduce<{ day: string; seconds: number } | null>((best, [key, seconds]) => (!best || seconds > best.seconds ? { day: key, seconds } : best), null);
  const yearDays = new Map([...dayTotals(inYear)].filter(([key]) => key.startsWith(`${year}-`)));
  return {
    year, totalSeconds, sessions, gamesPlayed: byGame.size, daysPlayed: [...byDay.values()].filter((seconds) => seconds > 0).length,
    longestStreak: computeStreaks(yearDays, new Date(year, 11, 31, 12).getTime()).longest,
    busiestMonth: month.seconds > 0 ? month : null, busiestDay: day,
    topGames: [...byGame.entries()].map(([gameId, value]) => ({ gameId, ...value })).sort((a, b) => b.seconds - a.seconds).slice(0, 5),
    secondsByMonth: byMonth,
  };
}

/** The most recent real sessions (not rolled-up days), newest first. */
export function recentSessions(records: SessionRecord[], limit = 30): SessionRecord[] {
  return records.filter((record) => record.kind === "session" && record.seconds > 0).sort((a, b) => b.start - a.start).slice(0, limit);
}
