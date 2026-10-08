import type { ModrinthGameVersion } from "./modrinth";
import { readJson, writeJson } from "./storage";

export type VersionKind = "release" | "snapshot" | "old";
export type GameVersion = { id: string; kind: VersionKind; date: number; major: boolean; line: string };
export type VersionGroup = { title: string; versions: GameVersion[] };

const RELEASE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

/** "1.21.4" -> "1.21.x", "26.3" -> "26.x", "1.0" -> "1.0.x". */
export function versionLine(id: string): string {
  const match = RELEASE.exec(id);
  if (!match) return "";
  return match[1] === "1" ? `1.${match[2]}.x` : `${match[1]}.x`;
}

/**
 * Modrinth marks snapshots, pre-releases, release candidates and April Fools builds
 * all as `snapshot`; betas and alphas are separate types. Only plain releases are "release".
 */
export function classifyVersion(tag: Pick<ModrinthGameVersion, "version" | "version_type">): VersionKind {
  if (tag.version_type === "release" && RELEASE.test(tag.version)) return "release";
  if (tag.version_type === "alpha" || tag.version_type === "beta") return "old";
  return "snapshot";
}

/** Newest first, by release date (the tag list is not reliably ordered and ids sort badly as text). */
export function normalizeVersions(tags: ModrinthGameVersion[]): GameVersion[] {
  return tags
    .map((tag) => ({ id: tag.version, kind: classifyVersion(tag), date: Date.parse(tag.date) || 0, major: Boolean(tag.major), line: versionLine(tag.version) }))
    .sort((a, b) => b.date - a.date);
}

export function latestRelease(versions: GameVersion[]): GameVersion | undefined {
  return versions.find((version) => version.kind === "release");
}

export function isKnownVersion(versions: GameVersion[], id: string): boolean {
  return versions.some((version) => version.id === id);
}

/** Groups releases by major line (newest line first); snapshots/old builds get their own trailing groups. */
export function groupVersions(versions: GameVersion[], options: { includeSnapshots: boolean; query?: string }): VersionGroup[] {
  const needle = (options.query ?? "").trim().toLowerCase();
  const matches = (version: GameVersion) => !needle || version.id.toLowerCase().includes(needle) || version.line.toLowerCase().includes(needle);
  const groups: VersionGroup[] = [];
  const lines = new Map<string, VersionGroup>();
  const snapshots: GameVersion[] = [];
  const old: GameVersion[] = [];
  for (const version of versions) {
    if (!matches(version)) continue;
    if (version.kind === "release") {
      let group = lines.get(version.line);
      if (!group) { group = { title: version.line, versions: [] }; lines.set(version.line, group); groups.push(group); }
      group.versions.push(version);
    } else if (options.includeSnapshots || (needle && version.id.toLowerCase() === needle)) {
      (version.kind === "snapshot" ? snapshots : old).push(version);
    }
  }
  if (snapshots.length) groups.push({ title: "Snapshots and pre-releases", versions: snapshots });
  if (old.length) groups.push({ title: "Beta and alpha", versions: old });
  return groups;
}

const RECENT_KEY = "mochi:discover-recent-versions";
type RecentEntry = { id: string; count: number; last: number };

export function readRecentVersions(): RecentEntry[] {
  const value = readJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<RecentEntry> & { id: string } => Boolean(item) && typeof (item as RecentEntry).id === "string")
    .map((item) => ({ id: item.id, count: Number.isFinite(item.count) ? Number(item.count) : 1, last: Number.isFinite(item.last) ? Number(item.last) : 0 }));
}

export function recordRecentVersion(id: string): void {
  if (!id) return;
  const entries = readRecentVersions();
  const found = entries.find((entry) => entry.id === id);
  if (found) { found.count += 1; found.last = Date.now(); } else entries.push({ id, count: 1, last: Date.now() });
  writeJson(RECENT_KEY, entries.sort((a, b) => b.last - a.last).slice(0, 12));
}

/** Pinned shortcuts: most used first, then most recent. */
export function pinnedVersions(versions: GameVersion[], limit = 4): GameVersion[] {
  const byId = new Map(versions.map((version) => [version.id, version]));
  return readRecentVersions()
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .map((entry) => byId.get(entry.id))
    .filter((version): version is GameVersion => Boolean(version))
    .slice(0, limit);
}
