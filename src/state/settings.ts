import { experimentalIds } from "../lib/experimental";
import { DEFAULT_AUTO_EXTEND_BELOW, clampAutoExtendBelow } from "../lib/mods/autoExtend";
import { defaultPlayLimits, normalizePlayLimits, type PlayLimits } from "../lib/playLimits";
import { allSourcesOn, type ModSourceSettings } from "../lib/mods/resolveSources";

export type Behavior = {
  launchOnStartup: boolean;
  keepOpen: boolean;
  confirmLaunch: boolean;
  detailedErrors: boolean;
  notificationsEnabled: boolean;
  inAppNotifications: boolean;
  systemNotifications: boolean;
  /** Check GitHub releases for new versions. */
  autoUpdate: boolean;
  /** Open straight into Big Picture mode (also when started at login). */
  bigPictureOnStartup: boolean;
  /** Which metadata sources to use: both, or a single one. */
  metadataProvider: "auto" | "igdb" | "steamgriddb";
  /** Enabled experimental feature ids (see lib/experimental.ts). */
  experimental: string[];
  /** Experimental feature ids the user has already been shown. */
  experimentalSeen: string[];
  /** Lay a game's own accent colour over the theme while its page is open. */
  gameThemes: boolean;
  /** Which mod sites Mochi may contact and list. Nexus Mods additionally needs a saved key. */
  modSources: ModSourceSettings;
  /** Update installed mods (SHA-1 verified, with a rollback copy) when a game is launched. Off by default. */
  autoUpdateMods: boolean;
  /** Discover adds other mod sites to a game that lists fewer than this many mods (0 = never, max 100). */
  modAutoExtendBelow: number;
  /** Shared folders with one sub-folder per game that Mochi also searches for screenshots (Steam is always searched). */
  screenshotFolders: string[];
  /** Tell me when a game I just closed has new screenshots. */
  screenshotNotices: boolean;
  /** Notice new and removed installs by re-checking import sources in the background. */
  watchFolders: boolean;
  /** Daily limits, break reminders and bedtime. Off by default. */
  playLimits: PlayLimits;
  /** Show the Deals tab (free games, sales, price watch for the wishlist). Off by default. */
  showDeals: boolean;
  /** Check Steam news and mod updates for my games and list them in the Deals tab. Off by default. */
  gameNews: boolean;
};

export const defaultBehavior: Behavior = {
  launchOnStartup: false,
  keepOpen: true,
  confirmLaunch: true,
  detailedErrors: false,
  notificationsEnabled: true,
  inAppNotifications: true,
  systemNotifications: true,
  autoUpdate: true,
  bigPictureOnStartup: false,
  metadataProvider: "auto",
  experimental: [],
  experimentalSeen: [],
  gameThemes: false,
  modSources: { ...allSourcesOn },
  autoUpdateMods: false,
  modAutoExtendBelow: DEFAULT_AUTO_EXTEND_BELOW,
  screenshotFolders: [],
  screenshotNotices: true,
  watchFolders: true,
  playLimits: defaultPlayLimits,
  showDeals: false,
  gameNews: false,
};

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Accepts anything read from storage (including settings written by older versions) and returns valid settings. */
export function normalizeBehavior(raw: unknown): Behavior {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = new Set(experimentalIds());
  const provider = stored.metadataProvider;
  const modSources = (stored.modSources && typeof stored.modSources === "object" ? stored.modSources : {}) as Record<string, unknown>;
  return {
    launchOnStartup: bool(stored.launchOnStartup, defaultBehavior.launchOnStartup),
    keepOpen: bool(stored.keepOpen, defaultBehavior.keepOpen),
    confirmLaunch: bool(stored.confirmLaunch, defaultBehavior.confirmLaunch),
    detailedErrors: bool(stored.detailedErrors, defaultBehavior.detailedErrors),
    notificationsEnabled: bool(stored.notificationsEnabled, defaultBehavior.notificationsEnabled),
    inAppNotifications: bool(stored.inAppNotifications, defaultBehavior.inAppNotifications),
    systemNotifications: bool(stored.systemNotifications, defaultBehavior.systemNotifications),
    autoUpdate: bool(stored.autoUpdate, defaultBehavior.autoUpdate),
    bigPictureOnStartup: bool(stored.bigPictureOnStartup, defaultBehavior.bigPictureOnStartup),
    metadataProvider: provider === "igdb" || provider === "steamgriddb" ? provider : "auto",
    experimental: ids(stored.experimental).filter((id) => known.has(id)),
    experimentalSeen: ids(stored.experimentalSeen),
    gameThemes: bool(stored.gameThemes, defaultBehavior.gameThemes),
    modSources: {
      modrinth: bool(modSources.modrinth, true),
      curseforge: bool(modSources.curseforge, true),
      nexus: bool(modSources.nexus, true),
    },
    autoUpdateMods: bool(stored.autoUpdateMods, defaultBehavior.autoUpdateMods),
    modAutoExtendBelow: clampAutoExtendBelow(stored.modAutoExtendBelow),
    screenshotFolders: ids(stored.screenshotFolders).filter((folder) => folder.startsWith("/")).slice(0, 20),
    screenshotNotices: bool(stored.screenshotNotices, defaultBehavior.screenshotNotices),
    watchFolders: bool(stored.watchFolders, defaultBehavior.watchFolders),
    playLimits: normalizePlayLimits(stored.playLimits),
    // Graduated from experimental: people who had them switched on keep them on.
    showDeals: bool(stored.showDeals, ids(stored.experimental).includes("deal-alerts")),
    gameNews: bool(stored.gameNews, ids(stored.experimental).includes("game-news")),
  };
}
