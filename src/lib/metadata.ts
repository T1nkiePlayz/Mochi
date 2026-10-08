import type { Piko } from "../models";
import type { IgdbGame } from "./igdb";

export const sanitizeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

export const resolveIgdbImage = (url?: string, size = "t_cover_big") =>
  url ? (url.startsWith("//") ? `https:${url}` : url).replace(/t_[a-z0-9_]+(?=\/)/, size) : undefined;

export const coverGradient = (url: string) => `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), url('${url}')`;

/** Applies an IGDB match to a Piko. Fields the user edited by hand are kept. */
export function applyIgdbMetadata(piko: Piko, metadata: IgdbGame | null): Piko {
  const locked = new Set(piko.lockedFields ?? []);
  const artworkUrl = resolveIgdbImage(metadata?.cover?.url) || resolveIgdbImage(metadata?.artworks?.[0]?.url, "t_1080p");
  const screenshots = (metadata?.screenshots ?? []).map((item) => resolveIgdbImage(item.url, "t_screenshot_big")).filter((url): url is string => Boolean(url)).slice(0, 8);
  const keepArtwork = locked.has("artwork") || piko.artworkSource === "custom";
  return {
    ...piko,
    name: locked.has("name") ? piko.name : metadata?.name || piko.name,
    categories: locked.has("categories") ? piko.categories : metadata?.genres?.map((genre) => genre.name).filter(Boolean) ?? [],
    description: locked.has("description") ? piko.description : metadata?.summary?.trim() || piko.description,
    artworkUrl: keepArtwork ? piko.artworkUrl : artworkUrl,
    artworkCacheKey: keepArtwork ? piko.artworkCacheKey : artworkUrl ? piko.artworkCacheKey || sanitizeKey(piko.id) : undefined,
    artwork: keepArtwork ? piko.artwork : artworkUrl ? coverGradient(artworkUrl) : piko.artwork,
    artworkSource: keepArtwork ? piko.artworkSource : artworkUrl ? "igdb" : piko.artworkSource,
    igdbId: metadata?.id,
    screenshots,
    trailerId: metadata?.videos?.find((video) => video.video_id)?.video_id,
    firstReleaseDate: metadata?.first_release_date,
  };
}
