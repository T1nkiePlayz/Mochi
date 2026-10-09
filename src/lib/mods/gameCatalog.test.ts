import { describe, expect, it } from "vitest";
import { SEED_GAMES, entryBadges, searchGameCatalog } from "./gameCatalog";

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
  it("seeds start with Balatro, Dragonwilds and Minecraft Dungeons on their verified ids", () => {
    expect(SEED_GAMES.slice(0, 3).map((game) => game.nexusDomain)).toEqual(["balatro", "runescapedragonwilds", "minecraftdungeons"]);
    expect(SEED_GAMES.find((game) => game.name === "Minecraft Dungeons")?.cfId).toBe(69271);
  });
});
