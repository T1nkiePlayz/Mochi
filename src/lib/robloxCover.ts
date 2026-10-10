import type { Piko } from "../models";

const ROBLOX_LAUNCHERS = new Set(["sober", "vinegar"]);
const isRoblox = (piko: Piko) => piko.kind !== "launcher" && piko.name.trim().toLowerCase() === "roblox";
const hasIgdbCover = (piko: Piko) => piko.artworkSource === "igdb" && Boolean(piko.artworkCacheKey || piko.artworkUrl);

/**
 * Sober and Vinegar are only launchers for Roblox, so when the user has added Roblox and it has an IGDB cover,
 * they borrow it. Their own choice always wins (custom or locked artwork), and nothing changes without a Roblox cover.
 * Returns the same array when there is nothing to change.
 */
export function withRobloxCover(library: Piko[]): Piko[] {
  const roblox = library.find((piko) => isRoblox(piko) && hasIgdbCover(piko));
  if (!roblox) return library;
  let changed = false;
  const next = library.map((piko) => {
    if (piko.kind !== "launcher" || !piko.launcherId || !ROBLOX_LAUNCHERS.has(piko.launcherId)) return piko;
    if (piko.artworkSource === "custom" || piko.lockedFields?.includes("artwork")) return piko;
    if (piko.artworkSource === "igdb" && piko.artworkCacheKey === roblox.artworkCacheKey && piko.artworkUrl === roblox.artworkUrl) return piko;
    changed = true;
    return { ...piko, artworkSource: "igdb" as const, artworkCacheKey: roblox.artworkCacheKey, artworkUrl: roblox.artworkUrl };
  });
  return changed ? next : library;
}
