import type { Piko } from "../models";
import type { PlaytimeEntry } from "./platform";
import { isExtra, isLauncher } from "./library";

export type Mood = "relaxed" | "focused" | "social" | "competitive";
export type TimeAvailable = "quick" | "hour" | "evening";
export type LengthPref = "short" | "any";
export type PickerOptions = { mood: Mood; time: TimeAvailable; length: LengthPref };

export const moods: Array<{ id: Mood; label: string }> = [
  { id: "relaxed", label: "Relaxed" }, { id: "focused", label: "Focused" }, { id: "social", label: "Social" }, { id: "competitive", label: "Competitive" },
];
export const times: Array<{ id: TimeAvailable; label: string }> = [{ id: "quick", label: "15 min" }, { id: "hour", label: "1 hour" }, { id: "evening", label: "An evening" }];

/** Genre / tag fragments (lowercase, substring match) behind each choice. A heuristic: IGDB genre names plus common tags. */
const MOOD_HINTS: Record<Mood, string[]> = {
  relaxed: ["simulator", "puzzle", "adventure", "point-and-click", "visual novel", "casual", "card", "board", "music", "cozy", "farming", "indie"],
  focused: ["role-playing", "rpg", "strategy", "tactical", "turn-based", "hack and slash", "stealth", "platform", "metroidvania", "souls"],
  social: ["co-op", "coop", "multiplayer", "party", "mmo", "card", "board", "local"],
  competitive: ["fighting", "shooter", "sport", "racing", "moba", "battle royale", "real time strategy", "pvp", "arcade"],
};
const QUICK_HINTS = ["arcade", "puzzle", "racing", "sport", "fighting", "platform", "roguelike", "roguelite", "shooter", "card"];
const LONG_HINTS = ["role-playing", "rpg", "strategy", "simulator", "mmo", "open world", "adventure", "4x"];
const SHORT_HINTS = ["puzzle", "arcade", "platform", "racing", "sport", "fighting", "visual novel", "walking", "short"];

/** Games played less than this still count as "barely touched" and can be suggested. */
export const LEAST_PLAYED_SECONDS = 5 * 3600;

const labelsOf = (piko: Piko) => [...(piko.categories ?? []), ...(piko.tags ?? [])].map((label) => label.toLowerCase());
export const matchesHints = (piko: Piko, hints: string[]) => labelsOf(piko).some((label) => hints.some((hint) => label.includes(hint)));

/** `hoursToBeat` (optional, keyed by Piko id) comes from IGDB time-to-beat; without it the genre heuristic is used. */
export type PickerContext = { playtime: Map<string, PlaytimeEntry>; isInstalled: (piko: Piko) => boolean; hoursToBeat?: ReadonlyMap<string, number> };

const SHORT_HOURS = 8;
const LONG_HOURS = 25;

/** Games worth suggesting: installed, not a launcher/extra, not finished or dropped, and wanted/in progress or barely played. */
export function pickerCandidates(library: Piko[], context: PickerContext): Piko[] {
  return library.filter((piko) => {
    if (isLauncher(piko) || isExtra(piko) || !context.isInstalled(piko)) return false;
    const status = piko.backlog?.status;
    if (status === "finished" || status === "dropped") return false;
    return status === "want" || status === "playing" || (context.playtime.get(piko.id)?.seconds ?? 0) < LEAST_PLAYED_SECONDS;
  });
}

/** Weight of one candidate: backlog "want" and unplayed games first, then adjusted by mood, time and length. Always > 0. */
export function pickerWeight(piko: Piko, options: PickerOptions, context: PickerContext): number {
  const seconds = context.playtime.get(piko.id)?.seconds ?? 0;
  let weight = piko.backlog?.status === "want" ? 4 : piko.backlog?.status === "playing" ? 2.5 : seconds <= 0 ? 2.5 : 1;
  if (matchesHints(piko, MOOD_HINTS[options.mood])) weight *= 3;
  const hours = context.hoursToBeat?.get(piko.id);
  const isShort = hours === undefined ? matchesHints(piko, SHORT_HINTS) : hours <= SHORT_HOURS;
  const isLong = hours === undefined ? matchesHints(piko, LONG_HINTS) : hours >= LONG_HOURS;
  if (options.time === "quick") { if (hours === undefined ? matchesHints(piko, QUICK_HINTS) : hours <= 4) weight *= 2.5; if (isLong) weight *= 0.5; }
  if (options.time === "evening" && isLong) weight *= 2;
  if (options.length === "short") { if (isShort) weight *= 2; if (isLong) weight *= 0.4; }
  return weight;
}

/** Deterministic PRNG (mulberry32) so tests and "Pick again" sequences can be seeded. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted random choice from the candidates, skipping `exclude` ids (a repeat only once everything was shown). */
export function pickGame(library: Piko[], options: PickerOptions, context: PickerContext, rng: () => number = Math.random, exclude: ReadonlySet<string> = new Set()): Piko | null {
  const all = pickerCandidates(library, context);
  const fresh = all.filter((piko) => !exclude.has(piko.id));
  const pool = fresh.length ? fresh : all;
  if (!pool.length) return null;
  const weights = pool.map((piko) => pickerWeight(piko, options, context));
  let roll = rng() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pool.length; index++) { roll -= weights[index]!; if (roll < 0) return pool[index]!; }
  return pool[pool.length - 1]!;
}
