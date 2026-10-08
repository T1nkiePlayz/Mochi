import { invoke } from "@tauri-apps/api/core";

/** One entry of native play history. `daily` rows are old sessions rolled up per day; `historic` is pre-history playtime. */
export type SessionRecord = {
  gameId: string; name: string; start: number; seconds: number;
  kind: "session" | "daily" | "historic"; count: number;
};

export const getPlaytimeHistory = (sinceEpoch?: number) =>
  invoke<SessionRecord[]>("get_playtime_history", { sinceEpoch: sinceEpoch ?? null });

export type RangeDays = 7 | 30 | 90 | 365;
export const HOUR_MS = 3_600_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** Local calendar day key, e.g. "2026-03-09". */
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
/** Adds calendar days in local time (DST safe). */
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** Monday = 0 ... Sunday = 6. */
export const weekdayIndex = (date: Date) => (date.getDay() + 6) % 7;

export type DayPiece = { day: string; gameId: string; name: string; seconds: number };

/** Splits a session at local midnights so every day only gets the time played on it. */
export function splitAtMidnight(record: SessionRecord): DayPiece[] {
  const startMs = record.start * 1000;
  if (record.kind !== "session") return [{ day: dayKey(new Date(startMs)), gameId: record.gameId, name: record.name, seconds: record.seconds }];
  const endMs = startMs + record.seconds * 1000;
  const pieces: DayPiece[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const date = new Date(cursor);
    const next = Math.max(addDays(startOfDay(cursor), 1).getTime(), cursor + 1);
    const stop = Math.min(next, endMs);
    pieces.push({ day: dayKey(date), gameId: record.gameId, name: record.name, seconds: Math.round((stop - cursor) / 1000) });
    cursor = stop;
  }
  return pieces.length ? pieces : [{ day: dayKey(new Date(startMs)), gameId: record.gameId, name: record.name, seconds: 0 }];
}

/** Seconds played per local hour of day (0-23); only real sessions have a time of day. */
export function hourHistogram(records: SessionRecord[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const record of records) {
    if (record.kind !== "session") continue;
    const endMs = (record.start + record.seconds) * 1000;
    let cursor = record.start * 1000;
    while (cursor < endMs) {
      const date = new Date(cursor);
      const intoHour = (date.getMinutes() * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
      const stop = Math.min(cursor + (HOUR_MS - intoHour), endMs);
      hours[date.getHours()] += (stop - cursor) / 1000;
      cursor = stop;
    }
  }
  return hours;
}

/** Total seconds per local day across the given records (historic placeholders excluded). */
export function dayTotals(records: SessionRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const record of records) {
    if (record.kind === "historic") continue;
    for (const piece of splitAtMidnight(record)) totals.set(piece.day, (totals.get(piece.day) ?? 0) + piece.seconds);
  }
  return totals;
}

/** Days with at least this much play count towards a streak. */
export const STREAK_MIN_SECONDS = 60;

export type Streaks = { current: number; longest: number; currentStartsOn?: string };

/** The current streak stays alive through today even if you have not played yet. */
export function computeStreaks(totals: Map<string, number>, now = Date.now()): Streaks {
  const played = (key: string) => (totals.get(key) ?? 0) >= STREAK_MIN_SECONDS;
  const today = startOfDay(now);
  let cursor = played(dayKey(today)) ? today : addDays(today, -1);
  let current = 0;
  let currentStartsOn: string | undefined;
  while (played(dayKey(cursor))) { current += 1; currentStartsOn = dayKey(cursor); cursor = addDays(cursor, -1); }
  const keys = [...totals.keys()].filter(played).sort();
  let longest = 0, run = 0, previous: Date | undefined;
  for (const key of keys) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    run = previous && dayKey(addDays(previous, 1)) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return { current, longest: Math.max(longest, current), currentStartsOn };
}

export type GameTotal = { gameId: string; name: string; seconds: number; sessions: number };
export type DayBucket = { key: string; date: Date; seconds: number; byGame: Map<string, number> };

export type Analysis = {
  buckets: DayBucket[];
  totalSeconds: number;
  sessionCount: number;
  averageSeconds: number;
  longestSeconds: number;
  gamesPlayed: number;
  games: GameTotal[];
  hours: number[];
  weekdays: number[];
  /** Playtime recorded before Mochi kept history; shown separately because it has no real dates. */
  historicSeconds: number;
  hasData: boolean;
};

/** Everything the overview charts need for the last `days` days (today included). */
export function analyse(records: SessionRecord[], days: RangeDays, now = Date.now()): Analysis {
  const today = startOfDay(now);
  const first = addDays(today, -(days - 1));
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  for (let i = 0; i < days; i += 1) {
    const date = addDays(first, i);
    const bucket = { key: dayKey(date), date, seconds: 0, byGame: new Map<string, number>() };
    buckets.push(bucket); index.set(bucket.key, bucket);
  }
  const games = new Map<string, GameTotal>();
  const inRange: SessionRecord[] = [];
  const weekdays = new Array<number>(7).fill(0);
  let sessionCount = 0, longestSeconds = 0, historicSeconds = 0;
  for (const record of records) {
    if (record.kind === "historic") { historicSeconds += record.seconds; continue; }
    let touched = false;
    for (const piece of splitAtMidnight(record)) {
      const bucket = index.get(piece.day);
      if (!bucket) continue;
      touched = true;
      bucket.seconds += piece.seconds;
      bucket.byGame.set(piece.gameId, (bucket.byGame.get(piece.gameId) ?? 0) + piece.seconds);
      weekdays[weekdayIndex(bucket.date)] += piece.seconds;
      const game = games.get(piece.gameId) ?? { gameId: piece.gameId, name: piece.name, seconds: 0, sessions: 0 };
      game.seconds += piece.seconds; game.name = piece.name;
      games.set(piece.gameId, game);
    }
    if (!touched) continue;
    inRange.push(record);
    const count = record.kind === "daily" ? record.count : 1;
    sessionCount += count;
    if (record.kind === "session") longestSeconds = Math.max(longestSeconds, record.seconds);
    const game = games.get(record.gameId);
    if (game) game.sessions += count;
  }
  const totalSeconds = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  return {
    buckets, totalSeconds, sessionCount, longestSeconds, historicSeconds, weekdays,
    averageSeconds: sessionCount ? totalSeconds / sessionCount : 0,
    gamesPlayed: games.size,
    games: [...games.values()].sort((a, b) => b.seconds - a.seconds),
    hours: hourHistogram(inRange),
    hasData: totalSeconds > 0,
  };
}

/** Groups day buckets into weeks (Monday start) for long ranges. */
export function groupByWeek(buckets: DayBucket[]): DayBucket[] {
  const weeks: DayBucket[] = [];
  for (const bucket of buckets) {
    const monday = addDays(bucket.date, -weekdayIndex(bucket.date));
    const key = dayKey(monday);
    let week = weeks.find((item) => item.key === key);
    if (!week) { week = { key, date: monday, seconds: 0, byGame: new Map() }; weeks.push(week); }
    week.seconds += bucket.seconds;
    bucket.byGame.forEach((seconds, id) => week!.byGame.set(id, (week!.byGame.get(id) ?? 0) + seconds));
  }
  return weeks;
}

export const formatHours = (seconds: number) => {
  const hours = seconds / 3600;
  return hours >= 100 ? `${Math.round(hours)}h` : hours >= 10 ? `${hours.toFixed(0)}h` : hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
};
export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
