import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { steamAppIdOf } from "./metadata/merge";

/** One Steam game of the library: the app id Steam records playtime under, and the game it belongs to. */
export type SteamPlaytimeTarget = { appid: number; gameId: string; name: string };

/** How far one import got: games updated, games already matching, Steam apps outside the library. */
export type SteamPlaytimeImportResult = { imported: number; unchanged: number; unmapped: number };

/**
 * Steam games in the library, one entry per app id (`steamAppIdOf`: imported Steam games and
 * games whose launch target is `steam://rungameid/…`). Launchers never receive playtime.
 */
export function steamPlaytimeTargets(library: Piko[]): SteamPlaytimeTarget[] {
  const seen = new Set<number>();
  const targets: SteamPlaytimeTarget[] = [];
  for (const piko of library) {
    if (piko.kind === "launcher") continue;
    const appid = steamAppIdOf(piko);
    if (appid === null || seen.has(appid)) continue;
    seen.add(appid);
    targets.push({ appid, gameId: piko.id, name: piko.name });
  }
  return targets;
}

/**
 * Reads Steam's saved playtime (`localconfig.vdf`) on this device and adds whatever Mochi is
 * missing as one earlier session per game. Repeating it adds nothing.
 */
export const importSteamPlaytime = (targets: SteamPlaytimeTarget[]) =>
  invoke<SteamPlaytimeImportResult>("import_steam_playtime", { targets });
