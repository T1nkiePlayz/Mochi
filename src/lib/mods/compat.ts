// Pure helpers: no runtime imports so they can be unit tested with plain `node --test` or vitest.
// Is a mod file usable in a Tofu, and how should Tofus be ordered? The Discover and manager UIs call these;
// they never block anything: "force install" is always allowed, this only explains the risk.
import type { ModLoader, Tofu } from "../../models";

export const MOD_LOADERS: readonly ModLoader[] = ["fabric", "quilt", "forge", "neoforge"];
export const ALL_LOADERS: readonly ModLoader[] = ["vanilla", ...MOD_LOADERS];
export const loaderLabels: Record<ModLoader, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };

/** What a mod file says it was built for. Empty `loaders` means it needs no loader (resource packs, shaders, data packs). */
export type ModVersionMeta = { gameVersions?: readonly string[]; loaders?: readonly string[] };

export type TofuTarget = { loader?: ModLoader; gameVersion?: string };
export type Compatibility = "compatible" | "maybe" | "incompatible";
export type CompatibilityResult = { status: Compatibility; reasons: string[] };

const GAME_VERSION = /\b1\.\d{1,2}(?:\.\d{1,2})?\b/;

/** A loader id from free text such as "Fabric", "neoforge-21.1" or a CurseForge version tag. */
export function parseLoader(text: string | undefined): ModLoader | undefined {
  const lower = (text ?? "").toLowerCase();
  if (/neo\s*-?forge/.test(lower)) return "neoforge";
  if (lower.includes("quilt")) return "quilt";
  if (lower.includes("fabric")) return "fabric";
  if (lower.includes("forge")) return "forge";
  return undefined;
}

/** The loader and Minecraft version a Tofu is set up for: its own fields first, then what its name/runtime/version text says. */
export function tofuTarget(tofu: Pick<Tofu, "version" | "runtime" | "name"> & Partial<Pick<Tofu, "loader">>): TofuTarget {
  const loader = tofu.loader ?? parseLoader(`${tofu.runtime} ${tofu.name} ${tofu.version}`);
  const gameVersion = GAME_VERSION.exec(tofu.version)?.[0] ?? GAME_VERSION.exec(tofu.runtime)?.[0];
  return { loader, gameVersion };
}

/** CurseForge lists loaders and game versions in one `gameVersions` array ("1.20.1", "Fabric", "Java 17"); split it. */
export function metaFromCurseforgeVersions(versions: readonly string[] | undefined): ModVersionMeta {
  const loaders = new Set<string>();
  const gameVersions: string[] = [];
  for (const version of versions ?? []) {
    const loader = parseLoader(version);
    if (loader) loaders.add(loader);
    else if (/^1\.\d{1,2}(\.\d{1,2})?$/.test(version)) gameVersions.push(version);
  }
  return { gameVersions, loaders: [...loaders] };
}

/** The compatibility facts of a source's file, whichever source it came from. */
export function metaFromModFile(file: { gameVersions?: readonly string[]; loaders?: readonly string[] }): ModVersionMeta {
  const split = metaFromCurseforgeVersions(file.gameVersions);
  return { gameVersions: split.gameVersions, loaders: file.loaders?.length ? file.loaders : split.loaders };
}

/** Numeric comparison of dotted versions; unknown shapes sort last. */
export function compareGameVersions(a: string | undefined, b: string | undefined): number {
  const parts = (value: string | undefined) => (value && GAME_VERSION.test(value) ? value.split(".").map((part) => Number.parseInt(part, 10) || 0) : null);
  const [pa, pb] = [parts(a), parts(b)];
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const series = (version: string) => version.split(".").slice(0, 2).join(".");

function checkVersion(gameVersion: string | undefined, versions: readonly string[] | undefined, reasons: string[]): Compatibility {
  if (!versions?.length) { reasons.push("This file does not say which game versions it supports."); return "maybe"; }
  if (!gameVersion) { reasons.push("This Tofu has no game version set."); return "maybe"; }
  if (versions.includes(gameVersion)) return "compatible";
  const sameSeries = versions.filter((version) => series(version) === series(gameVersion));
  if (sameSeries.length) { reasons.push(`Built for ${sameSeries.join(", ")}; this Tofu runs ${gameVersion}. Same release series, so it often works.`); return "maybe"; }
  const shown = versions.length > 4 ? `${versions.slice(0, 4).join(", ")} and more` : versions.join(", ");
  reasons.push(`Built for ${shown}, not ${gameVersion}.`);
  return "incompatible";
}

function checkLoader(target: TofuTarget, loaders: readonly string[] | undefined, reasons: string[]): Compatibility {
  const needed = (loaders ?? []).map((loader) => parseLoader(loader)).filter((loader): loader is ModLoader => loader !== undefined);
  // No mod loader named: resource packs, shaders and similar run anywhere.
  if (!needed.length) return "compatible";
  const names = needed.map((loader) => loaderLabels[loader]).join(" / ");
  if (!target.loader) { reasons.push(`Needs ${names}; this Tofu has no loader set.`); return "maybe"; }
  if (target.loader === "vanilla") { reasons.push(`Needs ${names}, but this Tofu is vanilla.`); return "incompatible"; }
  if (needed.includes(target.loader)) return "compatible";
  if (target.loader === "quilt" && needed.includes("fabric")) { reasons.push("Quilt runs most Fabric mods, but not all."); return "maybe"; }
  if (target.loader === "neoforge" && needed.includes("forge")) {
    // NeoForge started as a Forge fork and kept compatibility on 1.20.1 only.
    if (target.gameVersion === "1.20.1") { reasons.push("NeoForge on 1.20.1 still loads most Forge mods."); return "maybe"; }
    reasons.push(`Built for Forge; NeoForge ${target.gameVersion ?? ""} needs NeoForge mods.`.replace("  ", " "));
    return "incompatible";
  }
  reasons.push(`Built for ${names}, but this Tofu uses ${loaderLabels[target.loader]}.`);
  return "incompatible";
}

/**
 * Whether `meta` (one mod file) fits `tofu`. `compatible`: loader and game version match. `maybe`: something is unknown or only
 * partly matching (the reasons say what). `incompatible`: a clear mismatch. Callers may still offer "install anyway".
 */
export function compatibility(meta: ModVersionMeta, tofu: Tofu | TofuTarget): CompatibilityResult {
  const target: TofuTarget = "id" in tofu ? tofuTarget(tofu) : tofu;
  const reasons: string[] = [];
  const parts = [checkLoader(target, meta.loaders, reasons), checkVersion(target.gameVersion, meta.gameVersions, reasons)];
  const status: Compatibility = parts.includes("incompatible") ? "incompatible" : parts.includes("maybe") ? "maybe" : "compatible";
  return { status, reasons };
}

/** Best result across a mod's files (the list a user can choose from): the file that fits the Tofu best. */
export function bestCompatibility(files: ReadonlyArray<ModVersionMeta>, tofu: Tofu | TofuTarget): CompatibilityResult {
  const rank: Record<Compatibility, number> = { compatible: 0, maybe: 1, incompatible: 2 };
  let best: CompatibilityResult | undefined;
  for (const meta of files) {
    const result = compatibility(meta, tofu);
    if (!best || rank[result.status] < rank[best.status]) best = result;
  }
  return best ?? { status: "maybe", reasons: ["No file information is available."] };
}

const loaderOrder = (loader: ModLoader | undefined) => (loader ? ALL_LOADERS.indexOf(loader) : ALL_LOADERS.length);

/** Loader (vanilla, fabric, quilt, forge, neoforge, unknown last), then newest game version first, then name. */
export function compareTofus(a: Tofu, b: Tofu): number {
  const [ta, tb] = [tofuTarget(a), tofuTarget(b)];
  return loaderOrder(ta.loader) - loaderOrder(tb.loader) || compareGameVersions(tb.gameVersion, ta.gameVersion) || a.name.localeCompare(b.name);
}

export function sortTofus(tofus: readonly Tofu[]): Tofu[] { return [...tofus].sort(compareTofus); }

export type TofuGroup = { loader: ModLoader | undefined; label: string; tofus: Tofu[] };

/** Tofus grouped by loader (in loader order), each group sorted by game version, newest first. Tofus without a loader form the last group. */
export function groupTofusByLoader(tofus: readonly Tofu[]): TofuGroup[] {
  const groups = new Map<ModLoader | undefined, Tofu[]>();
  for (const tofu of sortTofus(tofus)) {
    const loader = tofuTarget(tofu).loader;
    groups.set(loader, [...(groups.get(loader) ?? []), tofu]);
  }
  return [...groups.entries()].map(([loader, items]) => ({ loader, label: loader ? loaderLabels[loader] : "No loader set", tofus: items }))
    .sort((a, b) => loaderOrder(a.loader) - loaderOrder(b.loader));
}

/** Translate compatibility explanations while preserving dynamic versions and loader names. */
export function translateCompatibilityReason(reason: string, t: (message: string) => string): string {
  if (reason === "This file does not say which game versions it supports." || reason === "This Tofu has no game version set." || reason === "Quilt runs most Fabric mods, but not all." || reason === "NeoForge on 1.20.1 still loads most Forge mods.") return t(reason);
  let match = reason.match(/^Built for (.+); this Tofu runs (.+)\\. Same release series, so it often works\\.$/);
  if (match) return t("Built for {versions}; this Tofu runs {gameVersion}. Same release series, so it often works.").replace("{versions}", match[1]).replace("{gameVersion}", match[2]);
  match = reason.match(/^Built for (.+), not (.+)\\.$/);
  if (match) return t("Built for {versions}, not {gameVersion}.").replace("{versions}", match[1]).replace("{gameVersion}", match[2]);
  match = reason.match(/^Needs (.+); this Tofu has no loader set\\.$/);
  if (match) return t("Needs {loaders}; this Tofu has no loader set.").replace("{loaders}", match[1]);
  match = reason.match(/^Needs (.+), but this Tofu is vanilla\\.$/);
  if (match) return t("Needs {loaders}, but this Tofu is vanilla.").replace("{loaders}", match[1]);
  match = reason.match(/^Built for Forge; NeoForge(?: (.*?))? needs NeoForge mods\\.$/);
  if (match) return t("Built for Forge; NeoForge {gameVersion} needs NeoForge mods.").replace("{gameVersion}", match[1] ?? "").replace(/\\s{2,}/g, " ");
  match = reason.match(/^Built for (.+), but this Tofu uses (.+)\\.$/);
  if (match) return t("Built for {loaders}, but this Tofu uses {loader}.").replace("{loaders}", match[1]).replace("{loader}", match[2]);
  return reason;
}
