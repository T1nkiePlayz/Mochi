// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import type { Piko } from "../../models";

/** IGDB's id for Minecraft (Java Edition is the entry everything else is a spin-off of). */
export const MINECRAFT_IGDB_ID = 121;

type GameLike = Pick<Piko, "name"> & Partial<Pick<Piko, "igdbId" | "modLinks">>;

/** Lower-case, accent-free, punctuation-free form used for every name comparison. */
export function normalizeGameName(name: string): string {
  return name
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Spin-offs and other editions that share the name but are not the moddable Java game. */
const NOT_JAVA = /\b(dungeons|legends|earth|story mode|education|bedrock|pocket|windows 10|console|realms|classic|hytale|launcher for bedrock)\b/;

/**
 * True for Minecraft: Java Edition, which is the game Modrinth and the Minecraft section of CurseForge serve.
 * Decided by IGDB id first, then by name (so imported Prism/MultiMC instances called "Minecraft 1.21" count).
 * An explicit user link (`modLinks.minecraft`) wins over both.
 */
export function isMinecraftJava(piko: GameLike): boolean {
  if (piko.modLinks?.minecraft === true) return true;
  if (piko.modLinks?.minecraft === false) return false;
  if (piko.igdbId === MINECRAFT_IGDB_ID) return true;
  const name = normalizeGameName(piko.name);
  if (!/^minecraft\b/.test(name)) return false;
  return !NOT_JAVA.test(name);
}

export type ModSupport =
  /** Minecraft: Java Edition. Modrinth and CurseForge, with the full per-Tofu manager. */
  | "minecraft"
  /** Any other game that is not just a launcher shortcut. Mods come from its linked CurseForge / Nexus game. */
  | "ecosystem"
  /** A launcher shortcut or similar: nothing to mod. */
  | "none";

export function modSupportOf(piko: GameLike & Partial<Pick<Piko, "kind">>): ModSupport {
  if (isMinecraftJava(piko)) return "minecraft";
  if (piko.kind === "launcher") return "none";
  return "ecosystem";
}

export type EcosystemRef = { source: "modrinth" } | { source: "curseforge"; gameId: number } | { source: "nexus"; domain: string };
const CURSEFORGE_MINECRAFT_ID = 432;

/** True when the game belongs to the mod ecosystem a mod was listed in (so its Tofus are the natural targets). */
export function isLinkedTo(piko: GameLike, ref: EcosystemRef): boolean {
  if (ref.source === "modrinth") return isMinecraftJava(piko);
  if (ref.source === "curseforge") return piko.modLinks?.curseforge?.gameId === ref.gameId || ref.gameId === CURSEFORGE_MINECRAFT_ID && isMinecraftJava(piko);
  return piko.modLinks?.nexus?.domain === ref.domain;
}
