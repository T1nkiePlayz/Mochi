import { invoke } from "@tauri-apps/api/core";
import { steamAppIdOf } from "./merge";
import { ProviderError, type MetadataProvider, type ProviderResult } from "./types";

export type SteamStoreDetails = {
  appid: number; name: string; description: string; genres: string[]; screenshots: string[];
  releaseDate?: number | null; coverUrl: string; headerUrl: string; heroUrl: string;
};
export type SteamStoreResult = { status: "ok" | "not-found" | "offline" | "error"; details?: SteamStoreDetails | null; stale: boolean; message?: string | null };

export async function getSteamStoreDetails(appid: number): Promise<SteamStoreResult> {
  try { return await invoke<SteamStoreResult>("get_steam_store_details", { appid }); }
  catch (error) { return { status: "error", stale: false, message: error instanceof Error ? error.message : String(error) }; }
}

export function steamToResult(details: SteamStoreDetails): ProviderResult {
  return {
    text: { description: details.description, categories: details.genres, screenshots: details.screenshots, firstReleaseDate: details.releaseDate ?? undefined },
    art: [details.coverUrl, details.headerUrl].filter(Boolean).map((url) => ({ source: "steam" as const, url })),
  };
}

/** Keyless fallback for games that launch through Steam. */
export const steamProvider: MetadataProvider = {
  id: "steam", label: "Steam Store", provides: { text: true, art: true },
  async lookup(_context, piko) {
    const appid = steamAppIdOf(piko);
    if (!appid) return {};
    const result = await getSteamStoreDetails(appid);
    if (result.status === "ok" && result.details) return steamToResult(result.details);
    if (result.status === "not-found") return {};
    throw new ProviderError(result.message || "Steam Store is unavailable.", result.status === "offline" ? "offline" : "other");
  },
};
