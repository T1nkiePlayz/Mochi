import { invoke } from "@tauri-apps/api/core";
import { readJson, writeJson } from "./storage";

export type RaAchievement = {
  id: number; title: string; description: string; points: number; badge?: string | null; badgeLocked?: string | null;
  unlocked: boolean; hardcore: boolean; earnedAt?: number | null;
};
export type RaProgressSet = {
  gameId: number; title: string; consoleName: string; icon?: string | null; achievements: RaAchievement[];
  total: number; earned: number; earnedHardcore: number; pointsTotal: number; pointsEarned: number; pointsHardcore: number;
};
export type RaStatus = "ok" | "no-credentials" | "denied" | "not-found" | "offline" | "error";
export type RaProgressResult = { status: RaStatus; data?: RaProgressSet | null; stale: boolean; fetchedAt?: number | null; message?: string | null };
export type RaGame = { id: number; title: string; consoleId: number; consoleName: string; icon?: string | null; numAchievements: number; points: number };
export type RaSearchResult = { status: RaStatus; games: RaGame[]; stale: boolean; message?: string | null };
export type RaTestResult = { ok: boolean; status: RaStatus; user?: string | null; totalPoints?: number | null; message: string };

/** The user name and Web API key. Local to this device: never synced, exported, logged or shown in debug info. */
export type RaConfig = { username: string; apiKey: string };
/** The RetroAchievements game chosen for each Mochi game. Local to this device. */
export type RaMatch = { raGameId: number; consoleId?: number; title?: string };
/** Fired (on window) when a game's match or the credentials changed. */
export const RA_CHANGED = "mochi-retroachievements-changed";
const CONFIG_KEY = "mochi:retroachievements-config";
const MATCH_KEY = "mochi:retroachievements-games";

export function readRaConfig(): RaConfig {
  const raw = readJson<Partial<RaConfig>>(CONFIG_KEY, {});
  return { username: typeof raw.username === "string" ? raw.username : "", apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "" };
}
export function writeRaConfig(config: RaConfig) {
  writeJson(CONFIG_KEY, { username: config.username.trim(), apiKey: config.apiKey.trim() });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RA_CHANGED));
}
export const hasRaCredentials = (config: RaConfig) => config.username.trim() !== "" && config.apiKey.trim() !== "";

/** Accepts only well-formed entries; ids are positive integers. */
export function normalizeMatches(raw: unknown): Record<string, RaMatch> {
  const out: Record<string, RaMatch> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, 5000)) {
    const item = value as Partial<RaMatch> | null;
    if (!item || !Number.isInteger(item.raGameId) || (item.raGameId as number) <= 0) continue;
    Object.defineProperty(out, id, { enumerable: true, configurable: true, writable: true, value: {
      raGameId: item.raGameId as number,
      ...(Number.isInteger(item.consoleId) && (item.consoleId as number) > 0 ? { consoleId: item.consoleId } : {}),
      ...(typeof item.title === "string" ? { title: item.title.slice(0, 200) } : {}),
    } });
  }
  return out;
}
export const readRaMatches = () => normalizeMatches(readJson<unknown>(MATCH_KEY, {}));
export const readRaMatch = (gameId: string): RaMatch | null => { const all = readRaMatches(); return Object.prototype.hasOwnProperty.call(all, gameId) ? all[gameId] : null; };
export function writeRaMatch(gameId: string, match: RaMatch | null) {
  const all = readRaMatches();
  if (match) Object.defineProperty(all, gameId, { enumerable: true, configurable: true, writable: true, value: match }); else delete all[gameId];
  writeJson(MATCH_KEY, all);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RA_CHANGED));
}

export async function testRaConnection(config: RaConfig): Promise<RaTestResult> {
  try { return await invoke<RaTestResult>("ra_test_connection", { username: config.username.trim(), apiKey: config.apiKey.trim() }); }
  catch { return { ok: false, status: "error", message: "Could not test the connection." }; }
}
export async function getRaProgress(gameId: number, refresh = false): Promise<RaProgressResult> {
  const config = readRaConfig();
  try { return await invoke<RaProgressResult>("ra_get_progress", { username: config.username.trim(), apiKey: config.apiKey.trim(), gameId, refresh }); }
  catch { return { status: "error", stale: false, message: "Achievements are unavailable right now." }; }
}
export async function searchRaGames(consoleId: number, query: string, refresh = false): Promise<RaSearchResult> {
  const config = readRaConfig();
  try { return await invoke<RaSearchResult>("ra_search_games", { username: config.username.trim(), apiKey: config.apiKey.trim(), consoleId, query, refresh }); }
  catch { return { status: "error", games: [], stale: false, message: "The search failed." }; }
}

/** RetroAchievements console ids. */
export const RA_CONSOLES: ReadonlyArray<{ id: number; name: string; aliases: string[] }> = [
  { id: 1, name: "Mega Drive / Genesis", aliases: ["genesis", "mega drive", "megadrive", "sega genesis", "sega mega drive"] },
  { id: 2, name: "Nintendo 64", aliases: ["n64", "nintendo 64"] },
  { id: 3, name: "SNES / Super Famicom", aliases: ["snes", "super nintendo", "super famicom", "super nes"] },
  { id: 4, name: "Game Boy", aliases: ["game boy", "gameboy", "gb"] },
  { id: 5, name: "Game Boy Advance", aliases: ["game boy advance", "gba"] },
  { id: 6, name: "Game Boy Color", aliases: ["game boy color", "gbc"] },
  { id: 7, name: "NES / Famicom", aliases: ["nes", "famicom", "nintendo entertainment system"] },
  { id: 8, name: "PC Engine / TurboGrafx-16", aliases: ["pc engine", "turbografx 16", "turbografx", "tg16"] },
  { id: 9, name: "Sega CD", aliases: ["sega cd", "mega cd"] },
  { id: 10, name: "32X", aliases: ["32x", "sega 32x"] },
  { id: 11, name: "Master System", aliases: ["master system", "sega master system"] },
  { id: 12, name: "PlayStation", aliases: ["playstation", "ps1", "psx", "playstation 1"] },
  { id: 13, name: "Atari Lynx", aliases: ["atari lynx", "lynx"] },
  { id: 14, name: "Neo Geo Pocket", aliases: ["neo geo pocket", "ngp", "neo geo pocket color"] },
  { id: 15, name: "Game Gear", aliases: ["game gear", "sega game gear"] },
  { id: 17, name: "Atari Jaguar", aliases: ["atari jaguar", "jaguar"] },
  { id: 18, name: "Nintendo DS", aliases: ["nintendo ds", "nds", "ds"] },
  { id: 21, name: "PlayStation 2", aliases: ["playstation 2", "ps2"] },
  { id: 25, name: "Atari 2600", aliases: ["atari 2600", "2600"] },
  { id: 27, name: "Arcade", aliases: ["arcade", "mame"] },
  { id: 28, name: "Virtual Boy", aliases: ["virtual boy"] },
  { id: 39, name: "Sega Saturn", aliases: ["sega saturn", "saturn"] },
  { id: 40, name: "Dreamcast", aliases: ["dreamcast", "sega dreamcast"] },
  { id: 41, name: "PlayStation Portable", aliases: ["playstation portable", "psp"] },
  { id: 53, name: "WonderSwan", aliases: ["wonderswan", "wonderswan color"] },
];

/** The console id for a platform name such as "SNES" or "Game Boy Advance", or null when unknown. */
export function consoleIdForPlatform(platform: string | undefined | null): number | null {
  const name = normalizeTitle(platform ?? "");
  if (!name) return null;
  for (const console of RA_CONSOLES) if (console.aliases.includes(name) || normalizeTitle(console.name) === name) return console.id;
  return null;
}

/** Lowercase words only: brackets, punctuation, accents and spacing removed. Mirrors `normalize_title` in src-tauri/src/retroachievements.rs. */
export function normalizeTitle(title: string): string {
  let depth = 0;
  let out = "";
  for (const char of title.normalize("NFKD").replace(/[̀-ͯ]/g, "")) {
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else out += /[\p{L}\p{N}]/u.test(char) ? char.toLowerCase() : " ";
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

/** Leading "the" and trailing ", the" are ignored when comparing, and roman/arabic numerals are not mixed up. */
const comparable = (title: string) => normalizeTitle(title).replace(/^the /, "").replace(/ the$/, "");

/** 1 for an identical normalized title, down to 0 for no shared words. */
export function titleScore(a: string, b: string): number {
  const x = comparable(a), y = comparable(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const wx = new Set(x.split(" ")), wy = new Set(y.split(" "));
  let shared = 0;
  for (const word of wx) if (wy.has(word)) shared += 1;
  const dice = (2 * shared) / (wx.size + wy.size);
  return x.startsWith(y) || y.startsWith(x) ? Math.max(dice, 0.8) : dice * 0.9;
}

/** Candidates ranked by title similarity (best first), dropping weak matches. */
export function rankMatches<T extends { title: string }>(title: string, candidates: T[], minimum = 0.5): Array<{ game: T; score: number }> {
  return candidates
    .map((game) => ({ game, score: titleScore(title, game.title) }))
    .filter((item) => item.score >= minimum)
    .sort((a, b) => b.score - a.score || a.game.title.length - b.game.title.length);
}

/** The single obvious suggestion, or null when nothing is clearly right (an exact title, or a clear lead). */
export function autoSuggest<T extends { title: string }>(title: string, candidates: T[]): T | null {
  const ranked = rankMatches(title, candidates, 0.7);
  if (!ranked.length) return null;
  if (ranked[0].score === 1) return ranked[0].game;
  return ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.15 ? ranked[0].game : null;
}

/** Digits only, a positive safe integer. Returns null for anything else. */
export function parseGameId(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/** Unlocked first (newest first), then locked in RetroAchievements' own order. */
export function sortRaAchievements(list: RaAchievement[]): RaAchievement[] {
  const order = new Map(list.map((item, index) => [item, index]));
  return [...list].sort((a, b) => Number(b.unlocked) - Number(a.unlocked)
    || (a.unlocked ? (b.earnedAt ?? 0) - (a.earnedAt ?? 0) : 0) || order.get(a)! - order.get(b)!);
}
export const raPercent = (set: Pick<RaProgressSet, "earned" | "total">) => (set.total ? Math.round((set.earned / set.total) * 100) : 0);

/** The profile page of a game on retroachievements.org. */
export const raGameUrl = (id: number) => `https://retroachievements.org/game/${id}`;
