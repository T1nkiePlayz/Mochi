import type { Piko } from "../models";
import { computeStreaks, dayKey, dayTotals, startOfDay, addDays, STREAK_MIN_SECONDS, splitAtMidnight, type SessionRecord } from "./stats";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const rarityLabels: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };

/** Local facts that are not derivable from play history; recorded by `useAchievements`. */
export type AchievementFlags = { themes: string[]; usedDiscover: boolean; installedMod: boolean };

/** Everything a rule may look at. Build it with `buildFacts`; rules stay pure functions of it. */
export type Facts = {
  totalSeconds: number;
  sessionCount: number;
  longestSessionSeconds: number;
  longestStreak: number;
  /** Most distinct games played inside any 7-day window. */
  maxGamesInWeek: number;
  nightSessions: number;
  earlySessions: number;
  gameCount: number;
  collectionCount: number;
  customTofuCount: number;
  flags: AchievementFlags;
};

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  rarity: Rarity;
  /** Name of a lucide icon, resolved in the UI. */
  icon: string;
  /** Hidden achievements show as a mystery until unlocked. */
  hidden?: boolean;
  target: number;
  value: (facts: Facts) => number;
  /** Unit for progress text. */
  unit?: "hours" | "days" | "games" | "sessions" | "themes" | "";
};

const hours = (n: number) => n * 3600;

/** Add an achievement by adding one entry here. */
export const achievements: AchievementDef[] = [
  { id: "first-launch", title: "First launch", description: "Launch a game through Mochi.", rarity: "common", icon: "Rocket", target: 1, value: (f) => f.sessionCount + (f.totalSeconds > 0 ? 1 : 0), unit: "sessions" },
  { id: "hour-1", title: "Warming up", description: "Play for 1 hour in total.", rarity: "common", icon: "Timer", target: hours(1), value: (f) => f.totalSeconds, unit: "hours" },
  { id: "hours-10", title: "Getting hooked", description: "Play for 10 hours in total.", rarity: "uncommon", icon: "Hourglass", target: hours(10), value: (f) => f.totalSeconds, unit: "hours" },
  { id: "hours-100", title: "Centurion", description: "Play for 100 hours in total.", rarity: "rare", icon: "Medal", target: hours(100), value: (f) => f.totalSeconds, unit: "hours" },
  { id: "hours-500", title: "Lifestyle", description: "Play for 500 hours in total.", rarity: "epic", icon: "Trophy", target: hours(500), value: (f) => f.totalSeconds, unit: "hours" },
  { id: "hours-1000", title: "Touch grass?", description: "Play for 1,000 hours in total.", rarity: "legendary", icon: "Crown", hidden: true, target: hours(1000), value: (f) => f.totalSeconds, unit: "hours" },
  { id: "streak-3", title: "On a roll", description: "Play 3 days in a row.", rarity: "common", icon: "Flame", target: 3, value: (f) => f.longestStreak, unit: "days" },
  { id: "streak-7", title: "Week warrior", description: "Play 7 days in a row.", rarity: "uncommon", icon: "Flame", target: 7, value: (f) => f.longestStreak, unit: "days" },
  { id: "streak-30", title: "Unstoppable", description: "Play 30 days in a row.", rarity: "epic", icon: "Flame", target: 30, value: (f) => f.longestStreak, unit: "days" },
  { id: "night-owl", title: "Night owl", description: "Start a session after midnight (00:00 to 04:00).", rarity: "uncommon", icon: "Moon", target: 1, value: (f) => f.nightSessions, unit: "sessions" },
  { id: "early-bird", title: "Early bird", description: "Start a session between 04:00 and 07:00.", rarity: "uncommon", icon: "Sunrise", target: 1, value: (f) => f.earlySessions, unit: "sessions" },
  { id: "marathon", title: "Marathon", description: "Play a single 4 hour session.", rarity: "rare", icon: "Footprints", target: hours(4), value: (f) => f.longestSessionSeconds, unit: "hours" },
  { id: "ultramarathon", title: "Ultramarathon", description: "Play a single 8 hour session.", rarity: "epic", icon: "Mountain", hidden: true, target: hours(8), value: (f) => f.longestSessionSeconds, unit: "hours" },
  { id: "variety", title: "Variety pack", description: "Play 5 different games within one week.", rarity: "rare", icon: "Shuffle", target: 5, value: (f) => f.maxGamesInWeek, unit: "games" },
  { id: "collector-10", title: "Collector", description: "Have 10 games in your library.", rarity: "common", icon: "Library", target: 10, value: (f) => f.gameCount, unit: "games" },
  { id: "collector-50", title: "Hoarder", description: "Have 50 games in your library.", rarity: "rare", icon: "Library", target: 50, value: (f) => f.gameCount, unit: "games" },
  { id: "collector-100", title: "Archivist", description: "Have 100 games in your library.", rarity: "epic", icon: "Library", target: 100, value: (f) => f.gameCount, unit: "games" },
  { id: "organised", title: "Organised", description: "Create a collection.", rarity: "common", icon: "FolderTree", target: 1, value: (f) => f.collectionCount },
  { id: "themer", title: "Themer", description: "Try 5 different themes.", rarity: "uncommon", icon: "Palette", target: 5, value: (f) => f.flags.themes.length, unit: "themes" },
  { id: "modder", title: "Modder", description: "Install a mod.", rarity: "uncommon", icon: "Puzzle", target: 1, value: (f) => (f.flags.installedMod ? 1 : 0) },
  { id: "explorer", title: "Explorer", description: "Open Discover.", rarity: "common", icon: "Compass", target: 1, value: (f) => (f.flags.usedDiscover ? 1 : 0) },
  { id: "tinkerer", title: "Tinkerer", description: "Create a Tofu (an environment for a game).", rarity: "common", icon: "Wrench", target: 1, value: (f) => f.customTofuCount },
];

/** Reads collections (id list or objects) from wherever the app stores them; tolerant of any shape. */
export function countCollections(stored: unknown, library: Piko[]): number {
  const ids = new Set<string>();
  if (Array.isArray(stored)) stored.forEach((item) => { if (item && typeof item === "object" && "id" in item) ids.add(String((item as { id: unknown }).id)); });
  library.forEach((piko) => piko.collectionIds?.forEach((id) => ids.add(id)));
  return ids.size;
}

export function buildFacts(records: SessionRecord[], library: Piko[], flags: AchievementFlags, collectionCount: number, now = Date.now()): Facts {
  const totals = dayTotals(records);
  const streaks = computeStreaks(totals, now);
  let totalSeconds = 0, sessionCount = 0, longestSessionSeconds = 0, nightSessions = 0, earlySessions = 0;
  const gamesByDay = new Map<string, Set<string>>();
  for (const record of records) {
    totalSeconds += record.seconds;
    if (record.kind === "historic") continue;
    sessionCount += record.kind === "daily" ? record.count : 1;
    if (record.kind === "session") {
      longestSessionSeconds = Math.max(longestSessionSeconds, record.seconds);
      const hour = new Date(record.start * 1000).getHours();
      if (hour < 4) nightSessions += 1; else if (hour < 7) earlySessions += 1;
    }
    for (const piece of splitAtMidnight(record)) {
      if (piece.seconds < STREAK_MIN_SECONDS / 2) continue;
      if (!gamesByDay.has(piece.day)) gamesByDay.set(piece.day, new Set());
      gamesByDay.get(piece.day)!.add(piece.gameId);
    }
  }
  let maxGamesInWeek = 0;
  const days = [...gamesByDay.keys()].sort();
  for (const key of days) {
    const [y, m, d] = key.split("-").map(Number);
    const window = new Set<string>();
    for (let i = 0; i < 7; i += 1) gamesByDay.get(dayKey(addDays(startOfDay(new Date(y, m - 1, d).getTime()), -i)))?.forEach((id) => window.add(id));
    maxGamesInWeek = Math.max(maxGamesInWeek, window.size);
  }
  return {
    totalSeconds, sessionCount, longestSessionSeconds, longestStreak: streaks.longest, maxGamesInWeek, nightSessions, earlySessions,
    gameCount: library.length, collectionCount,
    customTofuCount: library.reduce((sum, piko) => sum + piko.tofus.filter((tofu) => tofu.id !== "default").length, 0),
    flags,
  };
}

export type AchievementProgress = { def: AchievementDef; value: number; fraction: number; met: boolean };

export function evaluate(facts: Facts): AchievementProgress[] {
  return achievements.map((def) => {
    const value = def.value(facts);
    return { def, value, fraction: Math.min(1, value / def.target), met: value >= def.target };
  });
}

/** Ids met now but not yet recorded as unlocked. */
export const newlyMet = (progress: AchievementProgress[], unlocked: Record<string, unknown>) =>
  progress.filter((item) => item.met && !(item.def.id in unlocked)).map((item) => item.def);

export function progressText(item: AchievementProgress): string {
  const { def, value } = item;
  if (def.unit === "hours") return `${Math.min(value, def.target) / 3600 >= 10 ? Math.floor(Math.min(value, def.target) / 3600) : (Math.min(value, def.target) / 3600).toFixed(1)} / ${def.target / 3600} h`;
  if (def.target === 1) return item.met ? "Done" : "Not yet";
  return `${Math.min(Math.floor(value), def.target)} / ${def.target}${def.unit ? ` ${def.unit}` : ""}`;
}
