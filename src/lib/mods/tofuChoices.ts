// Pure helpers: no runtime imports so they can be unit tested with plain `node --test` or vitest.
import type { Piko, Tofu } from "../../models";
import { bestNameMatch } from "./gameMatch.ts";
import { bestCompatibility, groupTofusByLoader, sortTofus, type CompatibilityResult, type ModVersionMeta } from "./compat.ts";
import { isLinkedTo, isMinecraftJava, type EcosystemRef } from "./gameSupport.ts";

export type TofuChoice = { piko: Piko; tofu: Tofu; compat?: CompatibilityResult };
export type TofuChoiceGroup = { label: string; rows: TofuChoice[] };
export type TofuChoices = {
  kind: "minecraft" | "game";
  groups: TofuChoiceGroup[];
  /** Why the list is empty, for the empty state. */
  empty: string;
};

const isMinecraftEcosystem = (ref: EcosystemRef) => ref.source === "modrinth" || (ref.source === "curseforge" && ref.gameId === 432);

/**
 * The Tofus that may receive a mod. Minecraft content: only Minecraft: Java Tofus, grouped by loader then newest game version,
 * each badged by `bestCompatibility` against what the listing says. Any other game: only that game's Tofus (linked through the
 * mod site, or by the same name), grouped per game. `metas` empty means the listing does not say, so no badge is shown.
 */
export function buildTofuChoices(options: { pikos: readonly Piko[]; ecosystem: EcosystemRef; gameName?: string; metas?: readonly ModVersionMeta[] }): TofuChoices {
  const { pikos, ecosystem, gameName, metas = [] } = options;
  const badge = (tofu: Tofu): CompatibilityResult | undefined => metas.length ? bestCompatibility(metas, tofu) : undefined;
  if (isMinecraftEcosystem(ecosystem)) {
    const owners = new Map<string, Piko>();
    const all: Tofu[] = [];
    for (const piko of pikos) if (isMinecraftJava(piko)) for (const tofu of piko.tofus ?? []) { owners.set(tofu.id, piko); all.push(tofu); }
    const groups = groupTofusByLoader(all)
      .map((group) => ({ label: group.label, rows: group.tofus.map((tofu) => ({ piko: owners.get(tofu.id)!, tofu, compat: badge(tofu) })) }));
    return { kind: "minecraft", groups, empty: "No Minecraft instances were found. Add a Minecraft launcher or instance to your library first." };
  }
  const mine = pikos.filter((piko) => piko.tofus?.length && (isLinkedTo(piko, ecosystem) || (gameName ? bestNameMatch(piko.name, [{ name: gameName }]) !== null : false)));
  const groups = mine.map((piko) => ({ label: piko.name, rows: sortTofus(piko.tofus).map((tofu) => ({ piko, tofu })) }));
  return { kind: "game", groups, empty: `No Tofu instances of ${gameName ?? "this game"} were found. Add the game to your library first.` };
}
