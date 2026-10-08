import type { Piko } from "../models";
import { computeStreaks, STREAK_MIN_SECONDS, splitAtMidnight, type SessionRecord } from "./stats";
import { achievements } from "./achievementDefs";
import { rarityOrder, type AchievementCategory, type AchievementDef, type AchievementFlags, type Facts } from "./achievementTypes";

export * from "./achievementTypes";
export { achievements };

export const emptyFlags = (): AchievementFlags => ({ themes: [], usedDiscover: false, installedMod: false, controllerUsed: false, bigPictureUsed: false, views: [] });

/** Reads collections (id list or objects) from wherever the app stores them; tolerant of any shape. */
export function countCollections(stored: unknown, library: Piko[]): number {
  const ids = new Set<string>();
  if (Array.isArray(stored)) stored.forEach((item) => { if (item && typeof item === "object" && "id" in item) ids.add(String((item as { id: unknown }).id)); });
  library.forEach((piko) => piko.collectionIds?.forEach((id) => ids.add(id)));
  return ids.size;
}

const DAY_MS = 86_400_000;
const FESTIVE = new Set(["12-24", "12-25", "12-31", "01-01"]);
/** Whole days since the epoch for a local "YYYY-MM-DD" key; DST cannot skew it because it uses UTC. */
const ordinal = (key: string) => { const [y, m, d] = key.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
/** Monday = 0 ... Sunday = 6, for a day ordinal (1970-01-01 was a Thursday). */
const weekdayOf = (ord: number) => (((ord + 3) % 7) + 7) % 7;

type DayInfo = { seconds: number; sessions: number; games: Map<string, number> };

/**
 * One pass over the history (plus one over the library) produces every number the rules need,
 * so adding an achievement never adds another scan.
 */
export function buildFacts(records: SessionRecord[], library: Piko[], flags: AchievementFlags, collectionCount: number, now = Date.now()): Facts {
  const days = new Map<string, DayInfo>();
  const gameSeconds = new Map<string, number>();
  let totalSeconds = 0, sessionCount = 0, longestSessionSeconds = 0, nightSessions = 0, earlySessions = 0, quickSessions = 0;
  for (const record of records) {
    totalSeconds += record.seconds;
    gameSeconds.set(record.gameId, (gameSeconds.get(record.gameId) ?? 0) + record.seconds);
    if (record.kind === "historic") continue;
    const count = record.kind === "daily" ? record.count : 1;
    sessionCount += count;
    if (record.kind === "session") {
      longestSessionSeconds = Math.max(longestSessionSeconds, record.seconds);
      if (record.seconds >= 30 && record.seconds < 600) quickSessions += 1;
      const hour = new Date(record.start * 1000).getHours();
      if (hour < 4) nightSessions += 1; else if (hour < 7) earlySessions += 1;
    }
    let first = true;
    for (const piece of splitAtMidnight(record)) {
      let day = days.get(piece.day);
      if (!day) { day = { seconds: 0, sessions: 0, games: new Map() }; days.set(piece.day, day); }
      day.seconds += piece.seconds;
      if (first) { day.sessions += count; first = false; }
      if (piece.seconds >= STREAK_MIN_SECONDS / 2) day.games.set(piece.gameId, (day.games.get(piece.gameId) ?? 0) + 1);
    }
  }

  const totals = new Map<string, number>();
  let maxDaySeconds = 0, maxSessionsInDay = 0;
  for (const [key, day] of days) {
    totals.set(key, day.seconds);
    maxDaySeconds = Math.max(maxDaySeconds, day.seconds);
    maxSessionsInDay = Math.max(maxSessionsInDay, day.sessions);
  }
  const playedKeys = [...days.keys()].filter((key) => (days.get(key)?.seconds ?? 0) >= STREAK_MIN_SECONDS).sort();
  const weekdays = new Set<number>(), months = new Set<string>();
  let weekendDays = 0, festiveDays = 0, longestGapDays = 0, previous = -Infinity;
  for (const key of playedKeys) {
    const ord = ordinal(key), weekday = weekdayOf(ord);
    weekdays.add(weekday);
    if (weekday >= 5) weekendDays += 1;
    months.add(key.slice(0, 7));
    if (FESTIVE.has(key.slice(5))) festiveDays += 1;
    if (Number.isFinite(previous)) longestGapDays = Math.max(longestGapDays, ord - previous - 1);
    previous = ord;
  }

  // Distinct games in any 7-day window, with a sliding window over the sorted days (O(days)).
  const window = new Map<string, number>();
  const dayList = [...days.keys()].sort().map((key) => ({ ord: ordinal(key), games: days.get(key)!.games }));
  let maxGamesInWeek = 0, left = 0;
  dayList.forEach((entry) => {
    entry.games.forEach((_, id) => window.set(id, (window.get(id) ?? 0) + 1));
    for (; dayList[left].ord <= entry.ord - 7; left += 1) {
      dayList[left].games.forEach((_, id) => { const next = (window.get(id) ?? 1) - 1; if (next <= 0) window.delete(id); else window.set(id, next); });
    }
    maxGamesInWeek = Math.max(maxGamesInWeek, window.size);
  });

  const byId = new Map(library.map((piko) => [piko.id, piko]));
  const playedGenres = new Set<string>(), playedSources = new Set<string>();
  let gamesPlayed = 0, maxGameSeconds = 0, gamesOver10h = 0;
  for (const [id, seconds] of gameSeconds) {
    if (seconds <= 0) continue;
    gamesPlayed += 1;
    maxGameSeconds = Math.max(maxGameSeconds, seconds);
    if (seconds >= 36_000) gamesOver10h += 1;
    const piko = byId.get(id);
    piko?.categories?.forEach((genre) => playedGenres.add(genre.toLowerCase()));
    if (piko?.sourceId) playedSources.add(piko.sourceId);
  }

  const sources = new Set<string>(), tags = new Set<string>(), collectionSizes = new Map<string, number>();
  let customGames = 0, steamGames = 0, favouriteCount = 0, tofuCount = 0, customTofuCount = 0, totalMods = 0, moddedGames = 0;
  for (const piko of library) {
    if (piko.sourceId) sources.add(piko.sourceId);
    if (piko.source === "custom" && !piko.sourceId) customGames += 1;
    if (piko.sourceId === "steam" && piko.kind !== "launcher") steamGames += 1;
    if (piko.favorite) favouriteCount += 1;
    piko.tags?.forEach((tag) => tags.add(tag.toLowerCase()));
    piko.collectionIds?.forEach((id) => collectionSizes.set(id, (collectionSizes.get(id) ?? 0) + 1));
    let mods = 0;
    for (const tofu of piko.tofus) { tofuCount += 1; if (tofu.id !== "default") customTofuCount += 1; mods += tofu.mods; }
    totalMods += mods;
    if (mods > 0) moddedGames += 1;
  }

  return {
    totalSeconds, sessionCount, longestSessionSeconds, quickSessions, maxSessionsInDay, maxDaySeconds,
    longestStreak: computeStreaks(totals, now).longest, daysPlayed: playedKeys.length, weekendDays, weekdaysCovered: weekdays.size,
    longestGapDays, monthsActive: months.size, festiveDays, maxGamesInWeek, nightSessions, earlySessions,
    gamesPlayed, maxGameSeconds, gamesOver10h, playedGenres: playedGenres.size, playedSources: playedSources.size,
    gameCount: library.length, librarySources: sources.size, customGames, steamGames, collectionCount,
    maxCollectionSize: Math.max(0, ...collectionSizes.values()), favouriteCount, distinctTags: tags.size, tofuCount, customTofuCount, totalMods, moddedGames,
    steam: flags.steam?.known ? flags.steam : null, flags,
  };
}

export type AchievementProgress = { def: AchievementDef; value: number; fraction: number; met: boolean; /** False while the data this rule needs (Steam) has not been loaded. */ available: boolean };

export function evaluate(facts: Facts, defs: AchievementDef[] = achievements): AchievementProgress[] {
  return defs.map((def) => {
    const available = def.requires !== "steam" || facts.steam !== null;
    const value = available ? def.value(facts) : 0;
    return { def, value, fraction: Math.min(1, value / def.target), met: available && value >= def.target, available };
  });
}

/** Ids met now but not yet recorded as unlocked. */
export const newlyMet = (progress: AchievementProgress[], unlocked: Record<string, unknown>) =>
  progress.filter((item) => item.met && !(item.def.id in unlocked)).map((item) => item.def);

export function progressText(item: AchievementProgress): string {
  const { def, value } = item;
  if (!item.available) return "Needs Steam data";
  if (def.unit === "hours") return `${Math.min(value, def.target) / 3600 >= 10 ? Math.floor(Math.min(value, def.target) / 3600) : (Math.min(value, def.target) / 3600).toFixed(1)} / ${def.target / 3600} h`;
  if (def.target === 1) return item.met ? "Done" : "Not yet";
  return `${Math.min(Math.floor(value), def.target)} / ${def.target}${def.unit ? ` ${def.unit}` : ""}`;
}

export type AchievementFilter = { category: AchievementCategory | "all"; status: "all" | "unlocked" | "locked" };

/**
 * Filters and orders the list: unlocked first, then by rarity, then closest to done. Ladders show only the
 * next tier of a family while locked, so 5 hour tiers do not bury everything else; unlocked tiers all show.
 */
export function visibleAchievements(progress: AchievementProgress[], unlocked: Record<string, number>, filter: AchievementFilter, collapseTiers = true): AchievementProgress[] {
  const isDone = (item: AchievementProgress) => item.met || item.def.id in unlocked;
  const nextTier = new Map<string, string>();
  if (collapseTiers) for (const item of progress) { if (item.def.family && !isDone(item) && !nextTier.has(item.def.family)) nextTier.set(item.def.family, item.def.id); }
  return progress
    .filter((item) => filter.category === "all" || item.def.category === filter.category)
    .filter((item) => filter.status === "all" || (filter.status === "unlocked") === isDone(item))
    .filter((item) => !collapseTiers || isDone(item) || !item.def.family || nextTier.get(item.def.family) === item.def.id)
    .sort((a, b) => Number(isDone(b)) - Number(isDone(a)) || (isDone(a) && isDone(b) ? (unlocked[b.def.id] ?? 0) - (unlocked[a.def.id] ?? 0) : b.fraction - a.fraction || rarityOrder.indexOf(a.def.rarity) - rarityOrder.indexOf(b.def.rarity)));
}
