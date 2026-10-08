import type { SteamTotals } from "./steamAchievements";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const rarityLabels: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
export const rarityOrder: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export type AchievementCategory = "Playtime" | "Streaks" | "Habits" | "Variety" | "Library" | "Explore" | "Mods" | "Steam";
export const achievementCategories: AchievementCategory[] = ["Playtime", "Streaks", "Habits", "Variety", "Library", "Explore", "Mods", "Steam"];

/** Local facts that are not derivable from play history or the library; recorded by `useAchievementWatcher`. */
export type AchievementFlags = {
  themes: string[]; usedDiscover: boolean; installedMod: boolean;
  controllerUsed: boolean; bigPictureUsed: boolean;
  /** Sections of the app that have been opened. */
  views: string[];
  /** Totals of Steam achievements read from the on-disk cache; absent until Steam data has been loaded. */
  steam?: SteamTotals;
};

/** Everything a rule may look at. Build it with `buildFacts`; rules stay pure functions of it. */
export type Facts = {
  totalSeconds: number;
  sessionCount: number;
  longestSessionSeconds: number;
  /** Sessions between 30 seconds and 10 minutes. */
  quickSessions: number;
  maxSessionsInDay: number;
  maxDaySeconds: number;
  longestStreak: number;
  daysPlayed: number;
  weekendDays: number;
  /** How many different weekdays (Mon..Sun) have ever had play. */
  weekdaysCovered: number;
  /** Longest stretch of days without play that was followed by playing again. */
  longestGapDays: number;
  monthsActive: number;
  /** Days played on Dec 24, 25, 31 or Jan 1. */
  festiveDays: number;
  /** Most distinct games played inside any 7-day window. */
  maxGamesInWeek: number;
  nightSessions: number;
  earlySessions: number;
  gamesPlayed: number;
  maxGameSeconds: number;
  gamesOver10h: number;
  playedGenres: number;
  playedSources: number;
  gameCount: number;
  librarySources: number;
  customGames: number;
  steamGames: number;
  collectionCount: number;
  maxCollectionSize: number;
  favouriteCount: number;
  distinctTags: number;
  tofuCount: number;
  customTofuCount: number;
  totalMods: number;
  moddedGames: number;
  /** Null when no Steam achievement data has been loaded yet. */
  steam: SteamTotals | null;
  flags: AchievementFlags;
};

export type AchievementUnit = "hours" | "days" | "games" | "sessions" | "themes" | "mods" | "tags" | "sections" | "achievements" | "";

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  rarity: Rarity;
  category: AchievementCategory;
  /** Name of a lucide icon, resolved in the UI. */
  icon: string;
  /** Hidden achievements show as a mystery until unlocked. */
  hidden?: boolean;
  target: number;
  value: (facts: Facts) => number;
  unit?: AchievementUnit;
  /** Part of a ladder of tiers (e.g. "hours"); set by the definition helper, not by hand. */
  family?: string;
  tier?: number;
  tierCount?: number;
  /** Cannot progress until Steam data exists; shown as such instead of a misleading 0. */
  requires?: "steam";
};
