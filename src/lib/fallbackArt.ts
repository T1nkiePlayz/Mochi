import type { Piko } from "../models";
import { launcherIcon } from "./launcherArt";
import grassBlock from "../assets/minecraft-grass-block.svg";
import { cssUrl } from "./metadata/merge";

/** Older libraries stored one fixed purple gradient as "no artwork"; it is not real artwork. */
const isLegacyPlaceholder = (value: string) => value.includes("rgba(73,57,103");

/**
 * A CSS `background-image` for the stored `artwork` field, or undefined when there is none.
 * The field holds either a CSS image/gradient (from metadata) or a bare URL (bundled launcher art).
 */
export function artworkBackground(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (!text || isLegacyPlaceholder(text)) return undefined;
  if (/^(url|linear-gradient|radial-gradient|conic-gradient|image-set)\(/i.test(text)) return text;
  return /^(\/|\.|https?:|data:|blob:|asset:|tauri:)/i.test(text) || /\.(svg|png|jpe?g|webp|gif)(\?|#|$)/i.test(text) ? cssUrl(text) : undefined;
}

/** True when this game has (or is expected to have) real cover art, so cards can use the full cover layout. */
export function hasArtwork(piko: Pick<Piko, "artwork" | "artworkUrl" | "artworkSource">): boolean {
  return Boolean(piko.artworkUrl || piko.artworkSource || artworkBackground(piko.artwork));
}

/** True when the game has real metadata (cover art or an IGDB match); false means the card shows generated placeholder art. */
export function hasMetadata(piko: Pick<Piko, "artwork" | "artworkUrl" | "artworkSource" | "igdbId">): boolean {
  return hasArtwork(piko) || Boolean(piko.igdbId);
}

/** Stable partition: games with metadata first, placeholder-art games after, each keeping their existing relative order. */
export function placeholdersLast<T extends Parameters<typeof hasMetadata>[0]>(games: readonly T[]): T[] {
  return [...games.filter(hasMetadata), ...games.filter((game) => !hasMetadata(game))];
}

const SKIP = new Set(["the", "a", "an", "of", "and"]);

/** One or two capital letters for a game name: "Half-Life 2" gives "H2", "The Witcher 3" gives "W3". */
export function initialsOf(name: string): string {
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").normalize("NFC").split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  const significant = words.filter((word, index) => index === 0 ? !SKIP.has(word.toLowerCase()) || words.length === 1 : !SKIP.has(word.toLowerCase()));
  const picked = significant.length ? significant : words;
  if (!picked.length) return "?";
  if (picked.length === 1) return [...picked[0]].slice(0, 2).map((char, index) => (index === 0 ? char.toUpperCase() : char.toLowerCase())).join("");
  const last = picked[picked.length - 1];
  return (picked[0][0] + (/^\d/.test(last) ? last[0] : picked[1][0])).toUpperCase();
}

/** Stable 0-359 hue for a seed (FNV-1a), so the same game always gets the same colours. */
export function hueOf(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash % 360;
}

export type GeneratedArt = { hue: number; initials: string; sourceIcon: string; launcher: boolean };

type ArtSubject = { id?: string; name: string; kind?: Piko["kind"]; sourceId?: Piko["sourceId"] };

/** Everything needed to draw a good-looking local cover for a game that has no artwork. */
export function generatedArt(subject: ArtSubject): GeneratedArt {
  const launcher = subject.kind === "launcher";
  return {
    hue: hueOf(subject.name.trim().toLowerCase() || subject.id || "game"),
    initials: initialsOf(subject.name),
    // Minecraft instances come from Prism-style launchers, but the badge is the game's own grass block, not the launcher triangle.
    sourceIcon: subject.sourceId === "prism" ? grassBlock : subject.sourceId ? launcherIcon(subject.sourceId) : "",
    launcher,
  };
}
