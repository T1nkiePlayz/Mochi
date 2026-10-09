// Pure helpers: no runtime imports so they can be unit tested with plain `node --test` or vitest.
import { compareGameVersions, compatibility, type CompatibilityResult, type TofuTarget } from "./compat.ts";
import type { Tofu } from "../../models";

export type VersionRow = { game_versions: string[]; loaders: string[]; version_type?: "release" | "beta" | "alpha"; date_published: string };
export type VersionFilter = { loader?: string; gameVersion?: string; channel?: string; fit?: Tofu | TofuTarget | null };

const channelOf = (version: VersionRow) => version.version_type ?? "release";

/** Loaders that are real mod loaders; shaders and resource packs list "iris", "minecraft" and so on, which are not shown as filters. */
export function listLoaders(versions: readonly VersionRow[]): string[] {
  const known = new Set(["fabric", "quilt", "forge", "neoforge", "liteloader", "rift"]);
  return [...new Set(versions.flatMap((version) => version.loaders))].filter((loader) => known.has(loader)).sort();
}

/** Release versions first (newest first), then anything else the project lists. */
export function listGameVersions(versions: readonly VersionRow[]): string[] {
  return [...new Set(versions.flatMap((version) => version.game_versions))].sort((a, b) => {
    const [ra, rb] = [/^\d+\.\d+(\.\d+)?$/.test(a), /^\d+\.\d+(\.\d+)?$/.test(b)];
    return ra !== rb ? (ra ? -1 : 1) : compareGameVersions(b, a) || b.localeCompare(a);
  });
}

/** How a version fits a Tofu: loaders only count for mods (`mod` true); packs and shaders are loader-agnostic. */
export function versionFit(version: VersionRow, tofu: Tofu | TofuTarget, mod: boolean): CompatibilityResult {
  return compatibility({ gameVersions: version.game_versions, loaders: mod ? version.loaders : [] }, tofu);
}

/** Filters (all optional, all AND) and newest-first order. `fit` keeps only versions that are not incompatible with that Tofu. */
export function filterVersions<T extends VersionRow>(versions: readonly T[], filter: VersionFilter, mod: boolean): T[] {
  return versions
    .filter((version) => !filter.loader || version.loaders.includes(filter.loader))
    .filter((version) => !filter.gameVersion || version.game_versions.includes(filter.gameVersion))
    .filter((version) => !filter.channel || channelOf(version) === filter.channel)
    .filter((version) => !filter.fit || versionFit(version, filter.fit, mod).status !== "incompatible")
    .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
}

/** "1.20.1, 1.20.2, 1.20.4" collapsed for a table cell: the first few and a count of the rest. */
export function collapseList(values: readonly string[], shown = 3): { shown: string[]; more: number } {
  return { shown: values.slice(0, shown), more: Math.max(0, values.length - shown) };
}
