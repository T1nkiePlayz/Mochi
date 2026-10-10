import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { steamAppIdOf } from "./metadata/merge";
import { readJson, writeJson } from "./storage";

export type ScreenshotFile = { path: string; modified: number; source: "steam" | "folder" };
type Thumb = { path: string; thumb: string };

const seenKey = "mochi:screenshots-seen";

export const scanRequestFor = (piko: Pick<Piko, "id" | "name" | "sourceId" | "executablePath" | "screenshotFolders">, sharedFolders: string[]) => ({
  steamAppId: steamAppIdOf(piko), gameName: piko.name, gameFolders: piko.screenshotFolders ?? [], sharedFolders,
});

export const scanScreenshots = (request: ReturnType<typeof scanRequestFor>) => invoke<ScreenshotFile[]>("scan_screenshots", { request });

/** Thumbnails come from Mochi's own cache folder, so the window may show them. Originals open in the system viewer. */
export async function thumbnailsFor(files: ScreenshotFile[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let start = 0; start < files.length; start += 60) {
    const thumbs = await invoke<Thumb[]>("make_screenshot_thumbs", { paths: files.slice(start, start + 60).map((file) => file.path) }).catch(() => [] as Thumb[]);
    for (const item of thumbs) result.set(item.path, convertFileSrc(item.thumb));
  }
  return result;
}

const readSeen = (): Record<string, number> => {
  const raw = readJson<unknown>(seenKey, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, number> : {};
};
export const lastSeen = (gameId: string): number | null => { const seen = readSeen(); return Object.prototype.hasOwnProperty.call(seen, gameId) && Number.isFinite(seen[gameId]) ? seen[gameId] : null; };
export function markSeen(gameId: string, files: ScreenshotFile[]) {
  const newest = files.reduce((best, file) => Math.max(best, file.modified), 0);
  const seen = readSeen();
  Object.defineProperty(seen, gameId, { value: Math.max(newest, lastSeen(gameId) ?? 0, Math.floor(Date.now() / 1000)), enumerable: true, writable: true, configurable: true });
  writeJson(seenKey, seen);
}

/** Files newer than the last time the user looked. Nothing is "new" before the first look, so old libraries do not flood. */
export const newSince = (files: ScreenshotFile[], seen: number | null) => (seen === null ? [] : files.filter((file) => file.modified > seen));
