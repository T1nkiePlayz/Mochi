// Pure helpers: no runtime imports so they can be unit tested without a network or Tauri.
import { compatibility, metaFromModFile, type TofuTarget } from "./compat";

/** The slice of a source's file list that update logic needs (`ModFile` satisfies it). */
export type UpdateCandidate = {
  id: string;
  version?: string;
  name?: string;
  fileName: string;
  date?: string;
  channel?: "release" | "beta" | "alpha";
  gameVersions?: string[];
  loaders?: string[];
};

export type InstalledRef = { fileId: string; fileDate?: string };

const time = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);

/**
 * The newer file to offer for an installed one, or undefined. Only releases newer than the installed file qualify, a file that is
 * clearly incompatible with the Tofu is skipped, and a fully compatible file beats a "maybe" one however new the latter is.
 * An installed file with no known date is never replaced (nothing proves the candidate is newer).
 */
export function pickUpdate<T extends UpdateCandidate>(installed: InstalledRef, files: readonly T[], target: TofuTarget): T | undefined {
  const installedTime = time(installed.fileDate);
  if (!installedTime) return undefined;
  const rank = { compatible: 0, maybe: 1, incompatible: 2 } as const;
  const options = files
    .filter((file) => file.id !== installed.fileId && (file.channel ?? "release") === "release" && time(file.date) > installedTime)
    .map((file) => ({ file, fit: rank[compatibility(metaFromModFile(file), target).status] }))
    .filter((option) => option.fit < 2)
    .sort((a, b) => a.fit - b.fit || time(b.file.date) - time(a.file.date));
  return options[0]?.file;
}

/** How a found update can be applied. `manual` updates only offer the mod's page (restricted downloads, Nexus without Premium). */
export type UpdateApply =
  | { kind: "download"; provider: "modrinth" | "curseforge" | "nexus"; url: string; filename: string; sha1?: string }
  | { kind: "manual"; pageUrl: string; reason: string };

export type ModUpdateItem = {
  /** Absolute path of the installed file (unique per Tofu). */
  path: string;
  filename: string;
  title: string;
  iconUrl?: string;
  source: "modrinth" | "curseforge" | "nexus";
  enabled: boolean;
  currentVersion: string;
  newVersion: string;
  /** Everything needed to record the new file after the update. */
  record: { source: "modrinth" | "curseforge" | "nexus"; projectId: string; fileId: string; version?: string; title?: string; iconUrl?: string; fileDate?: string };
  apply: UpdateApply;
};

export type UpdateCheck = {
  checkedAt: number;
  items: ModUpdateItem[];
  /** Reasons part of the check was skipped or failed (offline, a site switched off, ...), for display. */
  notes: string[];
};

/** Updates that Mochi itself can install. */
export const installableUpdates = (items: readonly ModUpdateItem[]) => items.filter((item) => item.apply.kind === "download");

/** How often a Tofu is re-checked in the background. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const dueForCheck = (lastCheckedAt: number | undefined, now: number, interval = UPDATE_CHECK_INTERVAL_MS) =>
  !lastCheckedAt || now - lastCheckedAt >= interval || lastCheckedAt > now;
