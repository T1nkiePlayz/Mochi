import type { AchievementCategory, AchievementDef, Facts, Rarity } from "./achievementTypes";

const hours = (n: number) => n * 3600;

type Tier = { id: string; title: string; description: string; rarity: Rarity; target: number; hidden?: boolean; icon?: string };
type Ladder = { family: string; category: AchievementCategory; icon: string; value: (facts: Facts) => number; unit?: AchievementDef["unit"]; requires?: "steam" };

/** A family of achievements that measure the same thing at growing targets. */
function ladder(base: Ladder, tiers: Tier[]): AchievementDef[] {
  return tiers.map((tier, index) => ({ ...base, ...tier, icon: tier.icon ?? base.icon, tier: index + 1, tierCount: tiers.length }));
}
const single = (def: Omit<AchievementDef, "family" | "tier" | "tierCount">): AchievementDef[] => [def];

/** Add an achievement by adding one entry here (or one tier to a ladder). Ids are stored forever: never rename one. */
export const achievements: AchievementDef[] = [
  // Playtime
  ...single({ id: "first-launch", title: "First launch", description: "Launch a game through Mochi.", rarity: "common", category: "Playtime", icon: "Rocket", target: 1, value: (f) => (f.sessionCount > 0 || f.totalSeconds > 0 ? 1 : 0), unit: "sessions" }),
  ...ladder({ family: "hours", category: "Playtime", icon: "Timer", value: (f) => f.totalSeconds, unit: "hours" }, [
    { id: "hour-1", title: "Warming up", description: "Play for 1 hour in total.", rarity: "common", target: hours(1) },
    { id: "hours-10", title: "Getting hooked", description: "Play for 10 hours in total.", rarity: "uncommon", target: hours(10), icon: "Hourglass" },
    { id: "hours-50", title: "Dedicated", description: "Play for 50 hours in total.", rarity: "uncommon", target: hours(50), icon: "Hourglass" },
    { id: "hours-100", title: "Centurion", description: "Play for 100 hours in total.", rarity: "rare", target: hours(100), icon: "Medal" },
    { id: "hours-250", title: "Veteran", description: "Play for 250 hours in total.", rarity: "rare", target: hours(250), icon: "Medal" },
    { id: "hours-500", title: "Lifestyle", description: "Play for 500 hours in total.", rarity: "epic", target: hours(500), icon: "Trophy" },
    { id: "hours-1000", title: "Touch grass?", description: "Play for 1,000 hours in total.", rarity: "legendary", target: hours(1000), icon: "Crown", hidden: true },
  ]),
  ...ladder({ family: "sessions", category: "Playtime", icon: "Gamepad2", value: (f) => f.sessionCount, unit: "sessions" }, [
    { id: "sessions-50", title: "Regular", description: "Play 50 sessions.", rarity: "uncommon", target: 50 },
    { id: "sessions-250", title: "Creature of habit", description: "Play 250 sessions.", rarity: "rare", target: 250 },
    { id: "sessions-1000", title: "Always one more", description: "Play 1,000 sessions.", rarity: "epic", target: 1000 },
  ]),
  ...ladder({ family: "long-session", category: "Playtime", icon: "Footprints", value: (f) => f.longestSessionSeconds, unit: "hours" }, [
    { id: "session-1h", title: "Settling in", description: "Play a single 1 hour session.", rarity: "common", target: hours(1) },
    { id: "marathon", title: "Marathon", description: "Play a single 4 hour session.", rarity: "rare", target: hours(4) },
    { id: "ultramarathon", title: "Ultramarathon", description: "Play a single 8 hour session.", rarity: "epic", target: hours(8), icon: "Mountain", hidden: true },
  ]),
  ...single({ id: "day-off", title: "Day off", description: "Play 8 hours in a single day.", rarity: "rare", category: "Playtime", icon: "CalendarCheck", target: hours(8), value: (f) => f.maxDaySeconds, unit: "hours" }),
  ...single({ id: "quick-fix", title: "Quick fix", description: "Play 10 sessions shorter than 10 minutes.", rarity: "uncommon", category: "Playtime", icon: "Zap", target: 10, value: (f) => f.quickSessions, unit: "sessions" }),

  // Streaks and days played
  ...ladder({ family: "streak", category: "Streaks", icon: "Flame", value: (f) => f.longestStreak, unit: "days" }, [
    { id: "streak-3", title: "On a roll", description: "Play 3 days in a row.", rarity: "common", target: 3 },
    { id: "streak-7", title: "Week warrior", description: "Play 7 days in a row.", rarity: "uncommon", target: 7 },
    { id: "streak-14", title: "Fortnight", description: "Play 14 days in a row.", rarity: "rare", target: 14 },
    { id: "streak-30", title: "Unstoppable", description: "Play 30 days in a row.", rarity: "epic", target: 30 },
    { id: "streak-100", title: "Centurion streak", description: "Play 100 days in a row.", rarity: "legendary", target: 100, hidden: true },
  ]),
  ...ladder({ family: "days-played", category: "Streaks", icon: "CalendarDays", value: (f) => f.daysPlayed, unit: "days" }, [
    { id: "days-30", title: "Habit", description: "Play on 30 different days.", rarity: "uncommon", target: 30 },
    { id: "days-100", title: "Part of the routine", description: "Play on 100 different days.", rarity: "rare", target: 100 },
    { id: "days-365", title: "Full orbit", description: "Play on 365 different days.", rarity: "epic", target: 365 },
  ]),
  ...single({ id: "every-weekday", title: "Seven days a week", description: "Play on every day of the week (Monday to Sunday) at least once.", rarity: "uncommon", category: "Streaks", icon: "CalendarRange", target: 7, value: (f) => f.weekdaysCovered, unit: "days" }),
  ...single({ id: "seasoned", title: "Seasoned", description: "Play in 6 different months.", rarity: "uncommon", category: "Streaks", icon: "Leaf", target: 6, value: (f) => f.monthsActive }),
  ...single({ id: "comeback", title: "Welcome back", description: "Return to gaming after 30 or more days away.", rarity: "rare", category: "Streaks", icon: "Undo2", target: 30, value: (f) => f.longestGapDays, unit: "days", hidden: true }),

  // Habits: when you play
  ...ladder({ family: "night", category: "Habits", icon: "Moon", value: (f) => f.nightSessions, unit: "sessions" }, [
    { id: "night-owl", title: "Night owl", description: "Start a session after midnight (00:00 to 04:00).", rarity: "uncommon", target: 1 },
    { id: "night-owl-10", title: "Nocturnal", description: "Start 10 sessions after midnight.", rarity: "rare", target: 10 },
    { id: "night-owl-25", title: "Insomniac", description: "Start 25 sessions after midnight.", rarity: "epic", target: 25, hidden: true },
  ]),
  ...ladder({ family: "early", category: "Habits", icon: "Sunrise", value: (f) => f.earlySessions, unit: "sessions" }, [
    { id: "early-bird", title: "Early bird", description: "Start a session between 04:00 and 07:00.", rarity: "uncommon", target: 1 },
    { id: "early-bird-10", title: "Dawn patrol", description: "Start 10 sessions between 04:00 and 07:00.", rarity: "rare", target: 10 },
  ]),
  ...single({ id: "weekender", title: "Weekender", description: "Play on 8 different weekend days.", rarity: "common", category: "Habits", icon: "PartyPopper", target: 8, value: (f) => f.weekendDays, unit: "days" }),
  ...single({ id: "just-one-more", title: "Just one more", description: "Play 5 separate sessions in a single day.", rarity: "uncommon", category: "Habits", icon: "RotateCcw", target: 5, value: (f) => f.maxSessionsInDay, unit: "sessions" }),
  ...single({ id: "festive", title: "Festive spirit", description: "Play on Christmas Eve or Day, New Year's Eve or New Year's Day.", rarity: "rare", category: "Habits", icon: "Gift", target: 1, value: (f) => f.festiveDays, hidden: true }),

  // Variety
  ...ladder({ family: "games-played", category: "Variety", icon: "Dices", value: (f) => f.gamesPlayed, unit: "games" }, [
    { id: "sampler-5", title: "Sampler", description: "Play 5 different games.", rarity: "common", target: 5 },
    { id: "sampler-25", title: "Connoisseur", description: "Play 25 different games.", rarity: "rare", target: 25 },
  ]),
  ...ladder({ family: "week-variety", category: "Variety", icon: "Shuffle", value: (f) => f.maxGamesInWeek, unit: "games" }, [
    { id: "variety", title: "Variety pack", description: "Play 5 different games within one week.", rarity: "rare", target: 5 },
    { id: "variety-10", title: "Channel surfer", description: "Play 10 different games within one week.", rarity: "epic", target: 10 },
  ]),
  ...single({ id: "main-character", title: "Main character", description: "Play a single game for 100 hours.", rarity: "rare", category: "Variety", icon: "Star", target: hours(100), value: (f) => f.maxGameSeconds, unit: "hours" }),
  ...single({ id: "many-favourites", title: "Spoilt for choice", description: "Play 5 different games for at least 10 hours each.", rarity: "epic", category: "Variety", icon: "Layers", target: 5, value: (f) => f.gamesOver10h, unit: "games" }),
  ...single({ id: "genre-hopper", title: "Genre hopper", description: "Play games from 5 different genres.", rarity: "uncommon", category: "Variety", icon: "Shapes", target: 5, value: (f) => f.playedGenres }),
  ...single({ id: "launcher-hopper", title: "Launcher hopper", description: "Play games from 3 different launchers or stores.", rarity: "uncommon", category: "Variety", icon: "Rocket", target: 3, value: (f) => f.playedSources }),

  // Library
  ...ladder({ family: "library", category: "Library", icon: "Library", value: (f) => f.gameCount, unit: "games" }, [
    { id: "collector-10", title: "Collector", description: "Have 10 games in your library.", rarity: "common", target: 10 },
    { id: "collector-50", title: "Hoarder", description: "Have 50 games in your library.", rarity: "rare", target: 50 },
    { id: "collector-100", title: "Archivist", description: "Have 100 games in your library.", rarity: "epic", target: 100 },
    { id: "collector-250", title: "Dragon's hoard", description: "Have 250 games in your library.", rarity: "legendary", target: 250, hidden: true },
  ]),
  ...ladder({ family: "collections", category: "Library", icon: "FolderTree", value: (f) => f.collectionCount }, [
    { id: "organised", title: "Organised", description: "Create a collection.", rarity: "common", target: 1 },
    { id: "curator", title: "Curator", description: "Create 5 collections.", rarity: "uncommon", target: 5 },
  ]),
  ...single({ id: "full-shelf", title: "Full shelf", description: "Put 10 games in one collection.", rarity: "rare", category: "Library", icon: "FolderTree", target: 10, value: (f) => f.maxCollectionSize, unit: "games" }),
  ...ladder({ family: "favourites", category: "Library", icon: "Heart", value: (f) => f.favouriteCount, unit: "games" }, [
    { id: "favourite-1", title: "Favourite", description: "Mark a game as a favourite.", rarity: "common", target: 1 },
    { id: "favourite-10", title: "Heartfelt", description: "Mark 10 games as favourites.", rarity: "uncommon", target: 10 },
  ]),
  ...ladder({ family: "tags", category: "Library", icon: "Tag", value: (f) => f.distinctTags, unit: "tags" }, [
    { id: "tag-1", title: "Labeller", description: "Tag a game.", rarity: "common", target: 1 },
    { id: "tag-10", title: "Taxonomist", description: "Use 10 different tags.", rarity: "rare", target: 10 },
  ]),
  ...single({ id: "diy", title: "Do it yourself", description: "Add a game by hand.", rarity: "common", category: "Library", icon: "PenLine", target: 1, value: (f) => f.customGames }),
  ...single({ id: "steam-fan", title: "Steam fan", description: "Have 10 Steam games in your library.", rarity: "uncommon", category: "Library", icon: "Gamepad2", target: 10, value: (f) => f.steamGames, unit: "games" }),
  ...single({ id: "multi-launcher", title: "Everything in one place", description: "Bring games in from 3 different sources.", rarity: "uncommon", category: "Library", icon: "Boxes", target: 3, value: (f) => f.librarySources }),

  // Explore
  ...ladder({ family: "themes", category: "Explore", icon: "Palette", value: (f) => f.flags.themes.length, unit: "themes" }, [
    { id: "fresh-coat", title: "Fresh coat", description: "Try 2 different themes.", rarity: "common", target: 2 },
    { id: "themer", title: "Themer", description: "Try 5 different themes.", rarity: "uncommon", target: 5 },
    { id: "wardrobe", title: "Wardrobe", description: "Try 10 different themes.", rarity: "rare", target: 10 },
  ]),
  ...single({ id: "explorer", title: "Explorer", description: "Open Discover.", rarity: "common", category: "Explore", icon: "Compass", target: 1, value: (f) => (f.flags.usedDiscover ? 1 : 0) }),
  ...single({ id: "tourist", title: "Tourist", description: "Open every section of Mochi.", rarity: "uncommon", category: "Explore", icon: "Map", target: 6, value: (f) => f.flags.views.length, unit: "sections" }),
  ...single({ id: "gamepad", title: "Player one", description: "Use a controller with Mochi.", rarity: "common", category: "Explore", icon: "Gamepad", target: 1, value: (f) => (f.flags.controllerUsed ? 1 : 0) }),
  ...single({ id: "couch", title: "Couch mode", description: "Open Big Picture.", rarity: "common", category: "Explore", icon: "Tv", target: 1, value: (f) => (f.flags.bigPictureUsed ? 1 : 0) }),

  // Mods and environments
  ...ladder({ family: "mods", category: "Mods", icon: "Puzzle", value: (f) => (f.flags.installedMod ? Math.max(1, f.totalMods) : f.totalMods), unit: "mods" }, [
    { id: "modder", title: "Modder", description: "Install a mod.", rarity: "uncommon", target: 1 },
    { id: "mods-10", title: "Mod enthusiast", description: "Have 10 mods installed.", rarity: "rare", target: 10 },
    { id: "mods-50", title: "Mod pack", description: "Have 50 mods installed.", rarity: "epic", target: 50 },
  ]),
  ...single({ id: "multi-modder", title: "Multi-modder", description: "Mod 3 different games.", rarity: "rare", category: "Mods", icon: "Puzzle", target: 3, value: (f) => f.moddedGames, unit: "games" }),
  ...ladder({ family: "tofus", category: "Mods", icon: "Wrench", value: (f) => f.customTofuCount }, [
    { id: "tinkerer", title: "Tinkerer", description: "Create a Tofu (an environment for a game).", rarity: "common", target: 1 },
    { id: "environmentalist", title: "Environmentalist", description: "Create 3 Tofus.", rarity: "uncommon", target: 3 },
  ]),

  // Steam (needs Steam achievement data, loaded from the Steam Community profile)
  ...ladder({ family: "steam", category: "Steam", icon: "Award", value: (f) => f.steam?.unlocked ?? 0, unit: "achievements", requires: "steam" }, [
    { id: "steam-1", title: "Steam starter", description: "Unlock your first Steam achievement.", rarity: "common", target: 1 },
    { id: "steam-25", title: "Trophy shelf", description: "Unlock 25 Steam achievements.", rarity: "uncommon", target: 25 },
    { id: "steam-100", title: "Achievement hunter", description: "Unlock 100 Steam achievements.", rarity: "rare", target: 100 },
    { id: "steam-500", title: "Platinum mindset", description: "Unlock 500 Steam achievements.", rarity: "epic", target: 500 },
    { id: "steam-1000", title: "Living legend", description: "Unlock 1,000 Steam achievements.", rarity: "legendary", target: 1000, hidden: true },
  ]),
  ...ladder({ family: "steam-perfect", category: "Steam", icon: "BadgeCheck", value: (f) => f.steam?.perfectGames ?? 0, unit: "games", requires: "steam" }, [
    { id: "steam-perfect-1", title: "Perfectionist", description: "Unlock every achievement in a Steam game.", rarity: "rare", target: 1 },
    { id: "steam-perfect-5", title: "Completionist", description: "Unlock every achievement in 5 Steam games.", rarity: "epic", target: 5 },
  ]),
];
