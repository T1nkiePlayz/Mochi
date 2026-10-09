import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { foldLegacyPlaytime, instanceTofuId, launchTargetFor, mergeInstances, migrateMinecraftPikos, parseInstanceTarget } from "./minecraftPiko";
import { launcherForPiko } from "./launchers";
import { sanitizeLibrary } from "./library";
import type { ImportedGame } from "./sources";

const instance = (id: string, name: string, version = "1.21.1", loader = "fabric"): ImportedGame => ({
  id: `prism:${id}`, name, source: "prism", launchTarget: `mc-instance://prism/${encodeURIComponent(id)}`, kind: "game",
  minecraft: { version, loader, gameDir: `/i/${id}/minecraft` },
});
const three = [instance("SkyBlock", "SkyBlock Enhanced"), instance("SMP", "SMP", "1.20.1", "forge"), instance("Vanilla Perfected", "Vanilla Perfected", "1.21", "vanilla")];

const oldPiko = (game: ImportedGame, extra: Partial<Piko> = {}): Piko => ({
  id: `imported-prism-${game.id}-1`, name: game.name, description: "", accent: "#fff", artwork: "", executablePath: game.launchTarget, sourceId: "prism", platformCategory: "Minecraft", categories: ["Minecraft"],
  tofus: [{ id: "default", name: "Default", version: game.minecraft!.version!, runtime: "prism", mods: 0, status: "Ready", loader: "fabric", path: `${game.minecraft!.gameDir}/mods`, contentRoot: game.minecraft!.gameDir }], ...extra,
});

describe("one Minecraft piko", () => {
  it("merges three instances into one piko with three tofus", () => {
    const result = mergeInstances([], three)!;
    expect(result.library).toHaveLength(1);
    expect(result.piko.id).toBe("minecraft");
    expect(result.piko.tofus.map((tofu) => tofu.name)).toEqual(["SkyBlock Enhanced", "SMP", "Vanilla Perfected"]);
    expect(result.piko.tofus[1]).toMatchObject({ loader: "forge", version: "1.20.1", launchTarget: "mc-instance://prism/SMP" });
    expect(result.piko.executablePath).toBe("mc-instance://prism/SkyBlock");
    expect(result.piko.tofus[2].id).toBe("mc-prism-Vanilla-Perfected");
  });

  it("re-import updates in place and keeps user edits", () => {
    const first = mergeInstances([], three)!.library;
    const edited = first.map((piko) => ({ ...piko, tofus: piko.tofus.map((tofu) => (tofu.name === "SMP" ? { ...tofu, path: "/mine" } : tofu)) }));
    const again = mergeInstances(edited, [instance("SMP", "SMP", "1.21.4", "neoforge"), instance("New", "New Pack")])!;
    expect(again.library).toHaveLength(1);
    expect(again.piko.tofus).toHaveLength(4);
    expect(again.piko.tofus.find((tofu) => tofu.name === "SMP")).toMatchObject({ version: "1.21.4", loader: "neoforge", path: "/mine" });
    expect(mergeInstances(again.library, [])).toBeNull();
  });

  it("parses and ids instance targets", () => {
    expect(parseInstanceTarget("mc-instance://prism/My%20Pack")).toEqual({ launcher: "prism", id: "My Pack" });
    expect(parseInstanceTarget("steam://x")).toBeNull();
    expect(instanceTofuId("mc-instance://prism/My%20Pack")).toMatch(/^mc-prism-[A-Za-z0-9_-]+$/);
  });

  it("launches the tofu's own instance, else the piko's target", () => {
    const piko = mergeInstances([], three)!.piko;
    expect(launchTargetFor(piko, piko.tofus[1])).toBe("mc-instance://prism/SMP");
    expect(launchTargetFor({ executablePath: "/bin/game" }, { launchTarget: undefined })).toBe("/bin/game");
    expect(launchTargetFor({ executablePath: "/bin/game" }, undefined)).toBe("/bin/game");
  });

  it("never classifies an instance named like a launcher as a launcher", () => {
    expect(launcherForPiko({ name: "Prism Launcher", executablePath: "mc-instance://prism/Prism%20Launcher" })).toBeUndefined();
  });
});

describe("migration of old instance pikos", () => {
  const steam: Piko = { id: "steam", name: "Steam", description: "", accent: "", artwork: "", executablePath: "steam", kind: "launcher", tofus: [{ id: "default", name: "Default", version: "", runtime: "", mods: 0, status: "Ready" }] };
  const library = () => [steam, oldPiko(three[0], { favorite: true, artworkSource: "custom", artwork: "url(x)", artworkCacheKey: "k1", playtimeNote: undefined } as Partial<Piko>), oldPiko(three[1], { tags: ["pvp"] }), oldPiko(three[2], { collectionIds: ["c1"] })];

  it("merges them into one piko keeping favourite, tags, collections, covers and legacy ids", () => {
    const out = migrateMinecraftPikos(library());
    expect(out.map((piko) => piko.id)).toEqual(["steam", "minecraft"]);
    const mc = out[1];
    expect(mc.favorite).toBe(true);
    expect(mc.tags).toEqual(["pvp"]);
    expect(mc.collectionIds).toEqual(["c1"]);
    expect(mc.tofus).toHaveLength(3);
    expect(mc.tofus[0]).toMatchObject({ id: "mc-prism-SkyBlock", name: "SkyBlock Enhanced", artwork: "url(x)", artworkCacheKey: "k1", legacyPikoId: "imported-prism-prism:SkyBlock-1", legacyTofuId: "default", path: "/i/SkyBlock/minecraft/mods", launchTarget: "mc-instance://prism/SkyBlock" });
    expect(mc.modLinks?.minecraft).toBe(true);
  });

  it("is idempotent and runs through sanitizeLibrary", () => {
    const once = sanitizeLibrary(library(), {});
    expect(sanitizeLibrary(once, {})).toEqual(once);
    expect(once.filter((piko) => piko.id === "minecraft")).toHaveLength(1);
    expect(migrateMinecraftPikos(once)).toBe(once);
  });

  it("keeps extra tofus and merges into an existing Minecraft piko", () => {
    const mc = mergeInstances([], [instance("Old", "Old")])!.piko;
    const withExtra = oldPiko(three[1]);
    withExtra.tofus.push({ id: "tofu-x", name: "Experiment", version: "1", runtime: "Native", mods: 0, status: "Ready" });
    const out = migrateMinecraftPikos([mc, withExtra]);
    expect(out).toHaveLength(1);
    expect(out[0].tofus.map((tofu) => tofu.name)).toEqual(["Old", "SMP", "SMP · Experiment"]);
    expect(out[0].tofus[2]).toMatchObject({ id: "tofu-x", launchTarget: "mc-instance://prism/SMP" });
  });

  it("folds old playtime into the Minecraft piko", () => {
    const out = migrateMinecraftPikos(library());
    const entries = [
      { gameId: "imported-prism-prism:SkyBlock-1", name: "a", seconds: 100, lastPlayed: 5 },
      { gameId: "imported-prism-prism:SMP-1", name: "b", seconds: 50, lastPlayed: 9 },
      { gameId: "minecraft", name: "Minecraft", seconds: 10, lastPlayed: 7 },
      { gameId: "steam", name: "Steam", seconds: 1, lastPlayed: 1 },
    ];
    const folded = foldLegacyPlaytime(entries, out);
    expect(folded.find((entry) => entry.gameId === "minecraft")).toMatchObject({ seconds: 160, lastPlayed: 9 });
    expect(folded).toHaveLength(2);
  });
});

describe("modpack link from the launcher", () => {
  const game = (pack?: NonNullable<ImportedGame["minecraft"]>["pack"]): ImportedGame => ({ id: "prism:A", name: "A", source: "prism", launchTarget: "mc-instance://prism/A", minecraft: { version: "1.21.1", loader: "fabric", gameDir: "/i/A/minecraft", pack } });
  it("stores the launcher's pack record as a managed link and refreshes it on re-import", () => {
    const first = mergeInstances([], [game({ source: "modrinth", projectId: "1KVo5zza", versionId: "v1" })])!;
    expect(first.piko.tofus[0].pack).toEqual({ source: "modrinth", projectId: "1KVo5zza", versionId: "v1", matchedBy: "managed" });
    const again = mergeInstances(first.library, [game({ source: "modrinth", projectId: "1KVo5zza", versionId: "v2" })])!;
    expect(again.piko.tofus[0].pack?.versionId).toBe("v2");
    const plain = mergeInstances(first.library, [game()])!;
    expect(plain.piko.tofus[0].pack?.versionId).toBe("v1");
  });
});
