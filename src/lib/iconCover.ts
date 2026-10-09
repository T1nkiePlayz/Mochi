import { invoke } from "@tauri-apps/api/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyArtworkChanged } from "./artwork";
import { invokeProviderFunction } from "./functions";

type IconCoverResult = { cover?: string | null; svg?: string | null };

const SVG_SIZE = 512;

/** Draws SVG markup onto a canvas and returns it as a PNG data URL (the native side cannot render SVG). */
export async function rasterizeSvg(svg: string, size = SVG_SIZE): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try { await image.decode(); } catch { return null; }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // Icons without intrinsic size report 0; draw them at the full square.
  const width = image.naturalWidth || size;
  const height = image.naturalHeight || size;
  const scale = Math.min(size / width, size / height);
  context.drawImage(image, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
  try { return canvas.toDataURL("image/png"); } catch { return null; }
}

/**
 * Builds a cover from an icon (local path, or an allow-listed artwork URL such as an IGDB logo)
 * and caches it under `cacheKey`. Without `replace`, an existing cover is kept. Never rejects.
 */
export async function cacheIconCover(cacheKey: string, source: string, replace = false): Promise<boolean> {
  try {
    let result = await invoke<IconCoverResult>("cache_icon_cover", { cacheKey, source, replace });
    if (result.svg) {
      const png = await rasterizeSvg(result.svg);
      if (!png) return false;
      result = await invoke<IconCoverResult>("cache_icon_cover", { cacheKey, source: png, replace });
    }
    if (!result.cover) return false;
  } catch {
    return false;
  }
  try { notifyArtworkChanged(cacheKey); } catch { /* no window (tests) */ }
  return true;
}

/** Runs `task` over `items`, `limit` at a time. */
export async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
  }));
}

/**
 * IGDB company profiles for launchers (igdb.com/companies/<slug>). The `igdb-company` action tries the
 * slug, then the exact name; slugs are asked in order until one has a logo. Launchers without a company are left out.
 */
export const LAUNCHER_COMPANIES: Record<string, { slugs: string[]; name: string }> = {
  steam: { slugs: ["steam", "valve", "valve-corporation"], name: "Valve" },
  epic: { slugs: ["epic-games"], name: "Epic Games" },
  gog: { slugs: ["gog-dot-com", "gog"], name: "GOG.com" },
  battlenet: { slugs: ["blizzard-entertainment"], name: "Blizzard Entertainment" },
  ea: { slugs: ["electronic-arts"], name: "Electronic Arts" },
  ubisoft: { slugs: ["ubisoft-entertainment", "ubisoft"], name: "Ubisoft Entertainment" },
  rockstar: { slugs: ["rockstar-games"], name: "Rockstar Games" },
  amazon: { slugs: ["amazon-games", "amazon-game-studios"], name: "Amazon Games" },
  jagex: { slugs: ["jagex"], name: "Jagex" },
  minecraft: { slugs: ["mojang-studios", "mojang"], name: "Mojang Studios" },
  "minecraft-bedrock": { slugs: ["mojang-studios", "mojang"], name: "Mojang Studios" },
  itch: { slugs: ["itch-dot-io", "itch-io"], name: "itch.io" },
  hytale: { slugs: ["hypixel-studios"], name: "Hypixel Studios" },
  curseforge: { slugs: ["overwolf"], name: "Overwolf" },
  gamejolt: { slugs: ["game-jolt"], name: "Game Jolt" },
};

type IgdbCompanyAnswer = { company?: { logoUrl?: string; logoUrlLarge?: string } | null };

/** A logo URL Mochi can cache (IGDB's image host only). */
export function companyLogoUrl(answer: IgdbCompanyAnswer | null | undefined): string | null {
  const url = answer?.company?.logoUrl || answer?.company?.logoUrlLarge;
  return typeof url === "string" && /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/[\w/.-]+$/.test(url) ? url : null;
}

/** Looks up a launcher's company logo on IGDB (through the provider edge function). Null when unknown, signed out or offline. */
export async function launcherLogoUrl(client: SupabaseClient, launcherId: string): Promise<string | null> {
  const wanted = LAUNCHER_COMPANIES[launcherId];
  if (!wanted) return null;
  for (const slug of wanted.slugs) {
    try {
      const url = companyLogoUrl(await invokeProviderFunction<IgdbCompanyAnswer>(client, { action: "igdb-company", slug, name: wanted.name }));
      if (url) return url;
    } catch {
      return null; // no IGDB key, signed out or offline: the bundled art stays
    }
  }
  return null;
}

type CoverSubject = { id: string; artworkCacheKey?: string; artworkSource?: string; lockedFields?: string[]; launcherId?: string; kind?: string };
const userArt = (piko: CoverSubject) => piko.artworkSource === "custom" || Boolean(piko.lockedFields?.includes("artwork"));

/** Caches icon covers for freshly imported games (`icons`: piko id -> icon path). Resolves the ids that got one. */
export async function applyIconCovers(pikos: CoverSubject[], icons: Map<string, string>): Promise<Set<string>> {
  const done = new Set<string>();
  await eachLimited(pikos.filter((piko) => icons.has(piko.id) && piko.artworkCacheKey && !userArt(piko)), 3, async (piko) => {
    if (await cacheIconCover(piko.artworkCacheKey!, icons.get(piko.id)!)) done.add(piko.id);
  });
  return done;
}

/** Replaces launcher covers with their company's IGDB logo. Resolves the ids that got one. */
export async function applyLauncherLogos(client: SupabaseClient, pikos: CoverSubject[]): Promise<Set<string>> {
  const done = new Set<string>();
  const targets = pikos.filter((piko) => piko.kind === "launcher" && piko.launcherId && LAUNCHER_COMPANIES[piko.launcherId] && piko.artworkCacheKey && !userArt(piko));
  const urls = new Map<string, Promise<string | null>>();
  await eachLimited(targets, 3, async (piko) => {
    const id = piko.launcherId!;
    if (!urls.has(id)) urls.set(id, launcherLogoUrl(client, id));
    const url = await urls.get(id)!;
    if (url && await cacheIconCover(piko.artworkCacheKey!, url, true)) done.add(piko.id);
  });
  return done;
}
