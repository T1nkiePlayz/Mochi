/** Play limits and break reminders. Everything is optional, and the whole feature is off by default. */
export type PlayLimits = {
  enabled: boolean;
  /** Minutes of play per day across all games; 0 = no daily limit. */
  dailyMinutes: number;
  /** Remind to take a break after this many minutes in one session; 0 = never. */
  breakEveryMinutes: number;
  /** Warn when this percentage of a limit is used (10..100). */
  warnAtPercent: number;
  /** Quiet hours ("bedtime"): minutes since midnight; ignored unless `bedtimeEnabled`. */
  bedtimeEnabled: boolean;
  bedtimeStart: number;
  bedtimeEnd: number;
  /** What happens when a limit is reached: only a reminder, or a confirmation before launching more. */
  enforce: "remind" | "confirm";
  /** Per-game daily limits in minutes, by game id. */
  perGame: Record<string, number>;
};

export const defaultPlayLimits: PlayLimits = {
  enabled: false, dailyMinutes: 0, breakEveryMinutes: 60, warnAtPercent: 80,
  bedtimeEnabled: false, bedtimeStart: 22 * 60, bedtimeEnd: 7 * 60, enforce: "remind", perGame: {},
};

const int = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function normalizePlayLimits(raw: unknown): PlayLimits {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const perGame: Record<string, number> = {};
  if (stored.perGame && typeof stored.perGame === "object") {
    for (const [id, minutes] of Object.entries(stored.perGame as Record<string, unknown>).slice(0, 500)) {
      const value = int(minutes, 0, 1440, 0);
      if (value > 0) Object.defineProperty(perGame, id, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return {
    enabled: stored.enabled === true,
    dailyMinutes: int(stored.dailyMinutes, 0, 1440, defaultPlayLimits.dailyMinutes),
    breakEveryMinutes: int(stored.breakEveryMinutes, 0, 720, defaultPlayLimits.breakEveryMinutes),
    warnAtPercent: int(stored.warnAtPercent, 10, 100, defaultPlayLimits.warnAtPercent),
    bedtimeEnabled: stored.bedtimeEnabled === true,
    bedtimeStart: int(stored.bedtimeStart, 0, 1439, defaultPlayLimits.bedtimeStart),
    bedtimeEnd: int(stored.bedtimeEnd, 0, 1439, defaultPlayLimits.bedtimeEnd),
    enforce: stored.enforce === "confirm" ? "confirm" : "remind",
    perGame,
  };
}

/** True when `minutes` (since midnight) falls in the quiet window, which may wrap past midnight. */
export function inBedtime(limits: PlayLimits, minutes: number): boolean {
  if (!limits.enabled || !limits.bedtimeEnabled || limits.bedtimeStart === limits.bedtimeEnd) return false;
  return limits.bedtimeStart < limits.bedtimeEnd
    ? minutes >= limits.bedtimeStart && minutes < limits.bedtimeEnd
    : minutes >= limits.bedtimeStart || minutes < limits.bedtimeEnd;
}

export type LimitStatus = { kind: "ok" } | { kind: "warn" | "reached"; scope: "daily" | "game" | "bedtime"; usedMinutes: number; limitMinutes: number };

/** The most important limit state for one game right now. `playedToday` is minutes across all games, `gameToday` for this game. */
export function limitStatus(limits: PlayLimits, gameId: string, playedToday: number, gameToday: number, nowMinutes: number): LimitStatus {
  if (!limits.enabled) return { kind: "ok" };
  if (inBedtime(limits, nowMinutes)) return { kind: "reached", scope: "bedtime", usedMinutes: 0, limitMinutes: 0 };
  const checks: Array<["daily" | "game", number, number]> = [];
  const gameLimit = Object.prototype.hasOwnProperty.call(limits.perGame, gameId) ? limits.perGame[gameId] : 0;
  if (gameLimit > 0) checks.push(["game", gameToday, gameLimit]);
  if (limits.dailyMinutes > 0) checks.push(["daily", playedToday, limits.dailyMinutes]);
  for (const [scope, used, limit] of checks) if (used >= limit) return { kind: "reached", scope, usedMinutes: Math.floor(used), limitMinutes: limit };
  for (const [scope, used, limit] of checks) if (used * 100 >= limit * limits.warnAtPercent) return { kind: "warn", scope, usedMinutes: Math.floor(used), limitMinutes: limit };
  return { kind: "ok" };
}

export function describeLimit(status: LimitStatus, gameName: string): { title: string; message: string } | null {
  if (status.kind === "ok") return null;
  if (status.scope === "bedtime") return { title: "Quiet hours", message: `It is past your bedtime. ${gameName} is still running.` };
  const what = status.scope === "daily" ? "daily limit" : `limit for ${gameName}`;
  return status.kind === "reached"
    ? { title: "Play limit reached", message: `You have reached your ${what} (${status.limitMinutes} min).` }
    : { title: "Play limit almost reached", message: `${status.usedMinutes} of ${status.limitMinutes} min of your ${what} used.` };
}

export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const parseClock = (text: string): number | null => { const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim()); return match && +match[1] < 24 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null; };

export type TodayRecord = { gameId: string; start: number; seconds: number; kind: string };
export type TodayActive = { gameId: string; startedAt: number };

export const localMidnight = (now: Date) => Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);

/** Minutes played since local midnight: finished sessions plus the part of running sessions that falls today. */
export function minutesToday(records: TodayRecord[], active: TodayActive[], nowSec: number, midnightSec: number): { total: number; byGame: Map<string, number> } {
  const byGame = new Map<string, number>();
  const add = (id: string, seconds: number) => byGame.set(id, (byGame.get(id) ?? 0) + Math.max(0, seconds) / 60);
  for (const record of records) if (record.kind === "session" && record.start + record.seconds > midnightSec) add(record.gameId, record.start + record.seconds - Math.max(record.start, midnightSec));
  for (const session of active) add(session.gameId, nowSec - Math.max(session.startedAt, midnightSec));
  return { total: [...byGame.values()].reduce((sum, value) => sum + value, 0), byGame };
}

/** Break reminders due for a session that has run `elapsedMinutes`: the number of whole intervals passed. 0 when off. */
export const breaksDue = (limits: PlayLimits, elapsedMinutes: number) => (limits.enabled && limits.breakEveryMinutes > 0 ? Math.floor(elapsedMinutes / limits.breakEveryMinutes) : 0);
