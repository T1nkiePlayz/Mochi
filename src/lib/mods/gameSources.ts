// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
import type { ModSourceSettings, SourceId } from "./resolveSources.ts";

/** What the user picked for one game tab. "auto" = the primary site, plus the others when it has too few mods. */
export type GameSourceChoice = "auto" | "curseforge" | "nexus";
export const sourceChoices: GameSourceChoice[] = ["auto", "curseforge", "nexus"];
export const isSourceChoice = (value: unknown): value is GameSourceChoice => value === "auto" || value === "curseforge" || value === "nexus";

export type GameSourceInput = {
  /** CurseForge game id when the game exists there. */
  onCurseforge: boolean;
  /** The game's Nexus domain when it is listed there (or known from the built-in list). */
  onNexus: boolean;
  nexusKey: boolean;
  choice: GameSourceChoice;
};

export type GameSources = {
  /** Source that feeds the list first (null: nothing can be shown). */
  primary: SourceId | null;
  /** Other sites Mochi may add when the primary has fewer mods than the threshold. Empty when the user pinned one site. */
  extras: SourceId[];
  /** The tab's site choices (switcher): empty or one entry means no switcher. */
  choices: GameSourceChoice[];
  /** Nexus Mods lists this game, the toggle is on, but there is no saved key: show "Connect Nexus". */
  needsNexusKey: boolean;
};

/**
 * Which sites feed a non-Minecraft game tab. CurseForge is the default primary; Nexus Mods is the fallback or the
 * explicit choice. A switched-off site is never listed; Nexus without a key is reported through `needsNexusKey`.
 */
export function resolveGameSources(game: GameSourceInput, settings: ModSourceSettings): GameSources {
  const cf = game.onCurseforge && settings.curseforge;
  const nexusWanted = game.onNexus && settings.nexus;
  const nexus = nexusWanted && game.nexusKey;
  const both = cf && nexusWanted;
  const choices: GameSourceChoice[] = both ? sourceChoices : [];
  let choice = game.choice;
  if (choice === "curseforge" && !cf) choice = "auto";
  if (choice === "nexus" && !nexusWanted) choice = "auto";
  if (choice === "nexus") return { primary: nexus ? "nexus" : null, extras: [], choices, needsNexusKey: !nexus };
  if (choice === "curseforge") return { primary: "curseforge", extras: [], choices, needsNexusKey: false };
  if (cf) return { primary: "curseforge", extras: nexus ? ["nexus"] : [], choices, needsNexusKey: nexusWanted && !game.nexusKey };
  if (nexus) return { primary: "nexus", extras: [], choices, needsNexusKey: false };
  return { primary: null, extras: [], choices, needsNexusKey: nexusWanted && !game.nexusKey };
}
