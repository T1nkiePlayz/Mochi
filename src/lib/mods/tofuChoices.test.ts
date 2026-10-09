import { describe, expect, it } from "vitest";
import type { Piko, Tofu } from "../../models";
import { buildTofuChoices } from "./tofuChoices";
import { metasOfItem } from "./itemMeta";

const tofu = (id: string, name: string, version: string, loader?: Tofu["loader"]) => ({ id, name, version, runtime: "Java", mods: 0, status: "Ready", loader }) as Tofu;
const piko = (id: string, name: string, tofus: Tofu[], extra: Partial<Piko> = {}) => ({ id, name, tofus, ...extra }) as Piko;
const mc = piko("mc", "Minecraft", [tofu("a", "Old Forge", "1.20.1", "forge"), tofu("b", "Fabric new", "1.21.1", "fabric"), tofu("c", "Fabric old", "1.19.4", "fabric")]);
const terraria = piko("t", "Terraria", [tofu("t1", "tModLoader", "1.4.4")], { modLinks: { curseforge: { gameId: 431, slug: "terraria", name: "Terraria" } } });
const pikos = [mc, terraria, piko("s", "Stardew Valley", [tofu("s1", "Vanilla", "1.6")])];

describe("buildTofuChoices", () => {
  it("Minecraft content lists only Minecraft Tofus, grouped by loader, newest version first, with badges", () => {
    const choices = buildTofuChoices({ pikos, ecosystem: { source: "modrinth" }, metas: [{ gameVersions: ["1.21.1"], loaders: ["fabric"] }] });
    expect(choices.kind).toBe("minecraft");
    expect(choices.groups.map((group) => group.label)).toEqual(["Fabric", "Forge"]);
    expect(choices.groups[0].rows.map((row) => row.tofu.id)).toEqual(["b", "c"]);
    expect(choices.groups[0].rows.map((row) => row.compat?.status)).toEqual(["compatible", "incompatible"]);
    expect(choices.groups[1].rows[0].compat?.status).toBe("incompatible");
  });
  it("CurseForge Minecraft (game 432) behaves the same; no metas means no badge", () => {
    const choices = buildTofuChoices({ pikos, ecosystem: { source: "curseforge", gameId: 432 } });
    expect(choices.groups.flatMap((group) => group.rows).every((row) => row.compat === undefined)).toBe(true);
    expect(choices.groups.flatMap((group) => group.rows)).toHaveLength(3);
  });
  it("another game lists only that game", () => {
    const choices = buildTofuChoices({ pikos, ecosystem: { source: "curseforge", gameId: 431 }, gameName: "Terraria" });
    expect(choices.groups.map((group) => group.label)).toEqual(["Terraria"]);
  });
  it("a game not linked yet is found by name; nothing else leaks in", () => {
    const choices = buildTofuChoices({ pikos, ecosystem: { source: "nexus", domain: "stardewvalley" }, gameName: "Stardew Valley" });
    expect(choices.groups.map((group) => group.label)).toEqual(["Stardew Valley"]);
    expect(buildTofuChoices({ pikos: [mc], ecosystem: { source: "nexus", domain: "balatro" }, gameName: "Balatro" }).groups).toEqual([]);
  });
});

describe("metasOfItem", () => {
  it("reads CurseForge latest files and Modrinth hits", () => {
    expect(metasOfItem({ source: "curseforge", native: { latestFiles: [{ gameVersions: ["1.20.1", "Forge"] }] } })).toEqual([{ gameVersions: ["1.20.1"], loaders: ["forge"] }]);
    expect(metasOfItem({ source: "modrinth", native: { versions: ["1.21"], categories: ["fabric", "magic"] } })).toEqual([{ gameVersions: ["1.21"], loaders: ["fabric"] }]);
    expect(metasOfItem({ source: "nexus", native: {} })).toEqual([]);
  });
});
