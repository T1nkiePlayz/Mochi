import { invoke } from "@tauri-apps/api/core";
import { readJson, writeJson } from "./storage";

export type SteamAchievement = {
  apiName: string; name: string; description: string; icon?: string | null; iconGray?: string | null;
  unlocked: boolean; unlockedAt?: number | null; hidden: boolean;
};
export type SteamAchievementSet = { appid: number; gameName: string; achievements: SteamAchievement[]; unlocked: number; total: number };
export type SteamAchievementsStatus = "ok" | "private" | "no-achievements" | "no-steam-user" | "offline" | "error";
export type SteamAchievementsResult = {
  status: SteamAchievementsStatus; data?: SteamAchievementSet | null; stale: boolean; fetchedAt?: number | null;
  message?: string | null; steamId?: string | null; source: "webapi" | "community" | "cache";
};
export type AchievementSummary = { appid: number; steamId: string; unlocked: number; total: number; fetchedAt: number };

/** Optional user overrides. Local to this device (never synced); the key is only ever sent to Steam. */
export type SteamAchievementConfig = { steamId: string; apiKey: string };
/** Fired (on window) after Steam achievements were loaded so Mochi achievements can re-evaluate. */
export const STEAM_ACHIEVEMENTS_CHANGED = "mochi-steam-achievements-changed";
const CONFIG_KEY = "mochi:steam-achievements-config";

export function readSteamConfig(): SteamAchievementConfig {
  const raw = readJson<Partial<SteamAchievementConfig>>(CONFIG_KEY, {});
  return { steamId: typeof raw.steamId === "string" ? raw.steamId : "", apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "" };
}
export const writeSteamConfig = (config: SteamAchievementConfig) => writeJson(CONFIG_KEY, config);

export async function getSteamAchievements(appid: number, refresh = false): Promise<SteamAchievementsResult> {
  const config = readSteamConfig();
  try {
    return await invoke<SteamAchievementsResult>("get_steam_achievements", { appid, steamId: config.steamId.trim() || null, apiKey: config.apiKey.trim() || null, refresh });
  } catch (error) {
    return { status: "error", stale: false, source: "community", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function getSteamAchievementTotals(): Promise<AchievementSummary[]> {
  try { return await invoke<AchievementSummary[]>("get_steam_achievement_totals"); } catch { return []; }
}

/** Library-wide numbers for Mochi achievements. `known` is false until any Steam data has been loaded. */
export type SteamTotals = { known: boolean; gamesWithData: number; unlocked: number; total: number; perfectGames: number };
export function summariseTotals(items: AchievementSummary[]): SteamTotals {
  let unlocked = 0, total = 0, perfectGames = 0, gamesWithData = 0;
  for (const item of items) {
    if (item.total <= 0) continue;
    gamesWithData += 1; unlocked += item.unlocked; total += item.total;
    if (item.unlocked >= item.total) perfectGames += 1;
  }
  return { known: gamesWithData > 0, gamesWithData, unlocked, total, perfectGames };
}

/** Unlocked first (newest first), then locked in Steam's own order with hidden ones last. */
export function sortSteamAchievements(list: SteamAchievement[]): SteamAchievement[] {
  const order = new Map(list.map((item, index) => [item, index]));
  return [...list].sort((a, b) => Number(b.unlocked) - Number(a.unlocked)
    || (a.unlocked ? (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0) : Number(a.hidden) - Number(b.hidden))
    || order.get(a)! - order.get(b)!);
}

export const steamPercent = (set: Pick<SteamAchievementSet, "unlocked" | "total">) => (set.total ? Math.round((set.unlocked / set.total) * 100) : 0);
