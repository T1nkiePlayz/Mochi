// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.

export type ModSourceSettings = { modrinth: boolean; curseforge: boolean; nexus: boolean };
export const allSourcesOn: ModSourceSettings = { modrinth: true, curseforge: true, nexus: true };
export type SourceId = "modrinth" | "curseforge" | "nexus";

export type GameAvailability = {
  /** Minecraft: Java Edition (Modrinth and CurseForge both serve it). */
  minecraft?: boolean;
  /** The game exists on CurseForge. */
  curseforge?: boolean;
  /** The game exists on Nexus Mods. */
  nexus?: boolean;
  /** The user saved a Nexus API key. */
  nexusKey?: boolean;
};

/**
 * Which sources list mods for a game, best first. A source the user switched off never appears.
 * Minecraft: Modrinth and CurseForge. Any other game: CurseForge when it is there; Nexus Mods only when it is not
 * (or CurseForge is off) and a Nexus key is saved. CurseForge and Nexus are never shown together for one game.
 */
export function resolveSources(game: GameAvailability, settings: ModSourceSettings): SourceId[] {
  if (game.minecraft) return [...(settings.modrinth ? ["modrinth" as const] : []), ...(settings.curseforge ? ["curseforge" as const] : [])];
  if (settings.curseforge && game.curseforge) return ["curseforge"];
  if (settings.nexus && game.nexus && game.nexusKey) return ["nexus"];
  return [];
}

/** Minecraft content types (CurseForge class ids) and whether Modrinth can serve them. */
export type MinecraftContent = "mod" | "modpack" | "resourcepack" | "shader" | "world";
export const MINECRAFT_CLASS: Record<MinecraftContent, number> = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, world: 17 };
const MODRINTH_CONTENT = new Set<MinecraftContent>(["mod", "modpack", "resourcepack", "shader"]);

/** Source for one Minecraft content type when a specific source is preferred; falls back to the only one enabled. */
export function minecraftSourceFor(content: MinecraftContent, preferred: SourceId, settings: ModSourceSettings): SourceId | null {
  const modrinthOk = settings.modrinth && MODRINTH_CONTENT.has(content);
  if (preferred === "modrinth" && modrinthOk) return "modrinth";
  if (preferred === "curseforge" && settings.curseforge) return "curseforge";
  if (modrinthOk) return "modrinth";
  return settings.curseforge ? "curseforge" : null;
}

/** Whether a Discover game tab should exist, and which source feeds it. */
export function tabSource(game: { onCurseforge: boolean; onNexus: boolean }, settings: ModSourceSettings, nexusKey: boolean): SourceId | null {
  return resolveSources({ curseforge: game.onCurseforge, nexus: game.onNexus, nexusKey }, settings)[0] ?? null;
}

/** CurseForge lists test and hidden games too; only apiStatus 2 (public) ones are real. */
export function isPublicCurseforgeGame(game: { apiStatus?: number }): boolean {
  return game.apiStatus === 2;
}
