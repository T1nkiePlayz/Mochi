import { experimentalIds } from "../lib/experimental";

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
};

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Accepts anything read from storage (including settings written by older versions) and returns valid settings. */
export function normalizeBehavior(raw: unknown): Behavior {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = new Set(experimentalIds());
  const provider = stored.metadataProvider;
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
  };
}
