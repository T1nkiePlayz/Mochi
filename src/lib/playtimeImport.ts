import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import type { SteamPlaytimeImportResult } from "./steamPlaytime";

/** Launchers whose saved playtime Mochi can import (besides Steam). */
export type PlaytimeSource = "heroic" | "lutris" | "gog";

/** Brand names, shown as written in every language. */
export const playtimeSourceLabels: Record<PlaytimeSource, string> = { heroic: "Heroic", lutris: "Lutris", gog: "GOG Galaxy" };

/** One library game and every store identity it can be matched by (`heroic:<appName>`, `lutris:<id>`, `gog:<id>`). */
export type PlaytimeTarget = { keys: string[]; gameId: string; name: string };

/** One game of the preview and the minutes an import would add to it. */
export type PlaytimePreviewRow = { gameId: string; name: string; minutes: number };

export type PlaytimeImportResult = SteamPlaytimeImportResult;

/**
 * Library games with a store identity, one entry per game. Heroic: `appName` of the
 * `heroic://launch` target (a GOG appName is also the GOG id). Lutris: the id of
 * `lutris:rungameid/<id>`. GOG: the id of `gog:<id>` games. Launchers never receive playtime.
 */
export function playtimeTargets(library: Piko[]): PlaytimeTarget[] {
  const targets: PlaytimeTarget[] = [];
  for (const piko of library) {
    if (piko.kind === "launcher") continue;
    const keys = new Set<string>();
    const target = piko.executablePath ?? "";
    if (target.startsWith("heroic://launch")) {
      const query = target.slice(target.indexOf("?") + 1);
      const params = new URLSearchParams(target.includes("?") ? query : "");
      const app = params.get("appName");
      if (app) {
        keys.add(`heroic:${app}`);
        if (params.get("runner") === "gog") keys.add(`gog:${app}`);
      }
    }
    const lutris = /^lutris:rungameid\/([^/?#\s]+)$/.exec(target);
    if (lutris) keys.add(`lutris:${lutris[1]}`);
    const gog = piko.sourceId === "gog" ? /^gog:(\d{1,20})$/.exec(piko.id) : null;
    if (gog) keys.add(`gog:${gog[1]}`);
    if (keys.size) targets.push({ keys: [...keys], gameId: piko.id, name: piko.name });
  }
  return targets;
}

/** Sources with playtime data on this device (empty on a machine without them). */
export const detectPlaytimeSources = () => invoke<PlaytimeSource[]>("playtime_import_sources");

/** What importing `source` would add, per game. Changes nothing. */
export const previewPlaytimeImport = (source: PlaytimeSource, targets: PlaytimeTarget[]) =>
  invoke<PlaytimePreviewRow[]>("preview_playtime_import", { source, targets });

/** Adds what Mochi is missing as one earlier session per game. Repeating it adds nothing. */
export const importPlaytime = (source: PlaytimeSource, targets: PlaytimeTarget[]) =>
  invoke<PlaytimeImportResult>("import_playtime", { source, targets });
