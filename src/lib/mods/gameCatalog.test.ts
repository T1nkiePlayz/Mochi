import { describe, expect, it } from "vitest";
import { SEED_GAMES, entryBadges, searchGameCatalog, visibleSeedGames } from "./gameCatalog";

const cf = [
  { id: 69271, name: "Minecraft Dungeons", slug: "minecraft-dungeons" },
  { id: 431, name: "Terraria", slug: "terraria" },
  { id: 432, name: "Minecraft", slug: "minecraft" },
];
const nexus = [
  { name: "RuneScape: Dragonwilds", domainName: "runescapedragonwilds", modCount: 300 },
  { name: "Terraria", domainName: "terraria", modCount: 150 },
  { name: "Balatro", domainName: "balatro" },
];
const on = { cfEnabled: true, nexusEnabled: true };

describe("game catalogue search", () => {
  it("finds RuneScape: Dragonwilds however it is typed", () => {
    for (const query of ["RuneScape Dragonwilds", "runescape: dragonwilds", "dragon wilds", "dragonwilds", "rsdw", "RUNESCAPE  DRAGONWILDS"]) {
      expect(searchGameCatalog(query, cf, nexus, on).map((entry) => entry.nexus?.domain), query).toContain("runescapedragonwilds");
    }
  });
  it("still finds it without a Nexus key through the built-in list", () => {
    const [entry] = searchGameCatalog("dragonwilds", cf, [], on);
    expect(entry.nexus).toMatchObject({ domain: "runescapedragonwilds", known: true });
  });
  it("one row per game with both source badges", () => {
    const rows = searchGameCatalog("terraria", cf, nexus, on);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "cf:431", cf: { id: 431 }, nexus: { domain: "terraria", modCount: 150 } });
    expect(entryBadges(rows[0])).toEqual(["CurseForge", "Nexus Mods"]);
  });
  it("respects the source switches", () => {
    expect(searchGameCatalog("balatro", cf, nexus, { cfEnabled: true, nexusEnabled: false })).toEqual([]);
    expect(searchGameCatalog("terraria", cf, nexus, { cfEnabled: false, nexusEnabled: true })[0].cf).toBeUndefined();
  });
  it("aliases and ranking", () => {
    expect(searchGameCatalog("mcd", cf, nexus, on)[0].name).toBe("Minecraft Dungeons");
    expect(searchGameCatalog("minecraft", cf, nexus, on)[0].name).toBe("Minecraft");
  });
  it("seeds list CurseForge-backed games first, then the gated Nexus-only ones", () => {
    expect(SEED_GAMES.slice(0, 3).map((game) => game.cfId)).toEqual([69271, 669, 431]);
    expect(SEED_GAMES.slice(0, 3).some((game) => game.nexusOnly)).toBe(false);
    expect(SEED_GAMES.slice(3).every((game) => game.nexusOnly)).toBe(true);
    expect(SEED_GAMES.find((game) => game.name === "Minecraft Dungeons")?.cfId).toBe(69271);
    expect(SEED_GAMES.map((game) => game.name)).not.toContain("Satisfactory");
    expect(SEED_GAMES.find((game) => game.name === "Subnautica 2")).toMatchObject({ nexusDomain: "subnautica2", nexusOnly: true });
  });
});

describe("visibleSeedGames", () => {
  const names = (rows: ReturnType<typeof visibleSeedGames>) => rows.map((row) => row.seed.name);
  it("without a Nexus key hides every Nexus-only seed", () => {
    for (const list of [cf, []]) expect(names(visibleSeedGames(SEED_GAMES, list, false))).toEqual(["Minecraft Dungeons", "Stardew Valley", "Terraria"]);
  });
  it("with a Nexus key shows them as Nexus-only tabs", () => {
    const rows = visibleSeedGames(SEED_GAMES, cf, true);
    expect(names(rows)).toEqual(SEED_GAMES.map((game) => game.name));
    expect(rows.find((row) => row.seed.name === "Balatro")?.cf).toBeNull();
  });
  it("a seed the CurseForge list contains shows without a key", () => {
    const rows = visibleSeedGames(SEED_GAMES, [...cf, { id: 1, name: "Subnautica", slug: "subnautica" }], false);
    expect(rows.find((row) => row.seed.name === "Subnautica")?.cf?.id).toBe(1);
    expect(names(rows)).not.toContain("Subnautica: Below Zero");
  });
  it("Subnautica 2 never matches the Subnautica CurseForge entry", () => {
    const rows = visibleSeedGames(SEED_GAMES, [{ id: 1, name: "Subnautica", slug: "subnautica" }], false);
    expect(names(rows)).not.toContain("Subnautica 2");
  });
  it("CurseForge disabled skips matching", () => {
    expect(names(visibleSeedGames(SEED_GAMES, cf, false, false))).toEqual(["Minecraft Dungeons", "Stardew Valley", "Terraria"]);
  });
});
