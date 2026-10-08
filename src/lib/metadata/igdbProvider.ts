import { lookupIgdbGames, type IgdbGame } from "../igdb";
import { resolveIgdbImage } from "../metadata";
import { bestIgdbMatch } from "../search";
import { ProviderError, type MetadataProvider, type ProviderResult } from "./types";

export function igdbToResult(game: IgdbGame | null): ProviderResult {
  if (!game) return {};
  const cover = resolveIgdbImage(game.cover?.url);
  const art = resolveIgdbImage(game.artworks?.[0]?.url, "t_1080p");
  return {
    text: {
      name: game.name, description: game.summary, categories: game.genres?.map((genre) => genre.name),
      screenshots: (game.screenshots ?? []).map((item) => resolveIgdbImage(item.url, "t_screenshot_big")).filter((url): url is string => Boolean(url)),
      trailerId: game.videos?.find((video) => video.video_id)?.video_id, firstReleaseDate: game.first_release_date, igdbId: game.id,
    },
    art: [cover, art].filter((url): url is string => Boolean(url)).map((url) => ({ source: "igdb" as const, url })),
  };
}

export const igdbProvider: MetadataProvider = {
  id: "igdb", label: "IGDB", provides: { text: true, art: true },
  async lookup({ client }, piko) {
    if (!client) throw new ProviderError("Sign in to use IGDB.", "auth");
    return igdbToResult(bestIgdbMatch(piko.name, await lookupIgdbGames(client, piko.name)));
  },
};
