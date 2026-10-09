import type { Piko } from "../models";
import type { PlaytimeEntry } from "./platform";

/** Cheap 32-bit string hash (djb2); only used to compare signatures, not for security. */
const hash = (text: string) => { let h = 5381; for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return h >>> 0; };

/** Everything in the library that `buildFacts` reads; edits to anything else (artwork, last played, names) do not change it. */
export function librarySignature(library: Piko[]): string {
  const parts = library.map((piko) => [
    piko.id, piko.favorite ? 1 : 0, piko.sourceId ?? "", piko.source ?? "", piko.kind ?? "",
    piko.categories?.join(",") ?? "", piko.tags?.join(",") ?? "", piko.collectionIds?.join(",") ?? "",
    piko.tofus.map((tofu) => `${tofu.id === "default" ? "d" : "c"}${tofu.mods}`).join(","),
  ].join("|"));
  return `${library.length}:${hash(parts.join("\n"))}`;
}

/** Playtime reduced to whole minutes of total time plus how many games have any, so the 15 s refresh rarely changes it. */
export const playtimeSignature = (playtime: PlaytimeEntry[]): string => {
  let seconds = 0, games = 0;
  for (const entry of playtime) { seconds += entry.seconds; if (entry.seconds > 0) games += 1; }
  return `${Math.floor(seconds / 60)}:${games}`;
};
