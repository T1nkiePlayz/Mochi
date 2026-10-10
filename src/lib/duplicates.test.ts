import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { dismissPairs, findDuplicates, mergeGame, normalizeName, pickPrimary, storeKey, unmergeGame } from "./duplicates";
import { launchTargetFor, foldLegacyPlaytime } from "./minecraftPiko";
import { activeSource, mergedIds, sourceInstallPathFor } from "./launchSources";

const game = (id: string, name: string, executablePath: string, extra: Partial<Piko> = {}): Piko => ({
  id, name, description: "", accent: "#fff", artwork: "", executablePath, source: "custom",
  tofus: [{ id: "default", name: "Default", version: "Imported", runtime: "steam", mods: 0, status: "Ready" }], ...extra,
});
const steam = (id: string, name: string, appid: number, extra: Partial<Piko> = {}) => game(id, name, `steam://rungameid/${appid}`, { sourceId: "steam", platformCategory: "Steam", installPath: `/steam/${appid}`, ...extra });
const heroic = (id: string, name: string, app: string, runner: string, extra: Partial<Piko> = {}) => game(id, name, `heroic://launch?appName=${app}&runner=${runner}`, { sourceId: "heroic", platformCategory: "Heroic", ...extra });

describe("normalizeName", () => {
  it("ignores case, trademark signs, punctuation, accents and a leading The", () => {
    expect(normalizeName("The Witcher® 3: Wild Hunt™")).toBe("witcher 3 wild hunt");
    expect(normalizeName("Pokémon  Red")).toBe("pokemon red");
    expect(normalizeName("Dead Cells (2018)")).toBe("dead cells");
    expect(normalizeName("Tom & Jerry")).toBe("tom and jerry");
  });
  it("writes a trailing roman numeral as a digit but keeps plain numbers, years and single letters", () => {
    expect(normalizeName("Portal II")).toBe(normalizeName("Portal 2"));
    expect(normalizeName("Final Fantasy VII")).toBe("final fantasy 7");
    expect(normalizeName("Football Manager 2024")).toBe("football manager 2024");
    expect(normalizeName("Mega Man X")).toBe("mega man x");
    expect(normalizeName("Portal")).not.toBe(normalizeName("Portal 2"));
  });
});

describe("storeKey", () => {
  it("reads store ids from launch targets", () => {
    expect(storeKey("steam://rungameid/620")).toBe("steam:620");
    expect(storeKey("heroic://launch?appName=Sugar&runner=legendary")).toBe("epic:Sugar");
    expect(storeKey("heroic://launch?appName=1207&runner=gog")).toBe("gog:1207");
    expect(storeKey("flatpak://Org.Foo.Bar")).toBe("flatpak:org.foo.bar");
    expect(storeKey("/usr/bin/game")).toBeNull();
    expect(storeKey(undefined)).toBeNull();
  });
});

describe("findDuplicates", () => {
  it("groups the same game from several sources by name", () => {
    const library = [steam("s", "The Witcher 3: Wild Hunt", 292030), heroic("h", "Witcher 3 Wild Hunt", "1", "gog"), heroic("h2", "The Witcher® 3: Wild Hunt", "1207", "gog"), game("o", "Other", "/bin/o")];
    const groups = findDuplicates(library);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((piko) => piko.id)).toEqual(["s", "h", "h2"]);
  });
  it("groups by store id even when the names differ", () => {
    const groups = findDuplicates([steam("a", "Half-Life 2", 220), steam("b", "HL2 (my copy)", 220)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("id");
  });
  it("does not merge sequels, editions or different years", () => {
    expect(findDuplicates([steam("a", "Portal", 400), steam("b", "Portal 2", 620)])).toEqual([]);
    expect(findDuplicates([steam("a", "Doom", 1), heroic("b", "Doom Eternal", "x", "legendary")])).toEqual([]);
    expect(findDuplicates([steam("a", "Football Manager 2023", 1), steam("b", "Football Manager 2024", 2)])).toEqual([]);
    expect(findDuplicates([steam("a", "Civilization V", 1), steam("b", "Civilization VI", 2)])).toEqual([]);
    expect(findDuplicates([steam("a", "Mega Man", 1), steam("b", "Mega Man X", 2)])).toEqual([]);
  });
  it("skips launchers, Minecraft, soundtracks and extras", () => {
    const library = [
      steam("a", "Game", 1), steam("b", "Game", 2, { contentType: "soundtrack" }), steam("c", "Game", 3, { contentType: "extra" }),
      game("l", "Game", "/bin/l", { kind: "launcher" }), game("minecraft", "Game", "/bin/m"), game("m2", "Game", "mc-instance://prism/x"),
    ];
    expect(findDuplicates(library)).toEqual([]);
  });
  it("skips games without a launch target and the empty placeholder", () => {
    expect(findDuplicates([game("a", "Same", ""), game("b", "Same", "/bin/b")])).toEqual([]);
    expect(findDuplicates([game("__empty", "Same", "/a"), game("b", "Same", "/b")])).toEqual([]);
  });
  it("honours dismissed pairs, in either order", () => {
    const library = [steam("a", "Celeste", 1), heroic("b", "Celeste", "x", "legendary")];
    expect(findDuplicates(library, new Set(["a|b"]))).toEqual([]);
    expect(findDuplicates(library, dismissPairs(new Set(), ["b", "a"]))).toEqual([]);
    expect(findDuplicates(library, new Set(["a|zzz"]))).toHaveLength(1);
  });
  it("finds three copies as one group and ignores unmerged singles", () => {
    const groups = findDuplicates([steam("a", "Celeste", 1), heroic("b", "celeste", "x", "legendary"), game("c", "Celeste", "flatpak://io.celeste", { sourceId: "flatpak" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });
  it("sees a merged game's absorbed store ids", () => {
    const merged = mergeGame([steam("a", "Celeste", 1), heroic("b", "Celeste Classic", "x", "legendary")], "a", ["b"]);
    expect(findDuplicates([...merged, heroic("c", "Other name", "x", "legendary")])).toHaveLength(1);
  });
});

describe("mergeGame / unmergeGame", () => {
  const library = () => [steam("a", "Celeste", 1, { favorite: true, tags: ["indie"], igdbId: 5 }), game("z", "Unrelated", "/bin/z"), heroic("b", "Celeste", "x", "legendary", { tags: ["epic"], collectionIds: ["c1"] }), game("c", "Celeste", "flatpak://io.c", { sourceId: "flatpak", installPath: "/flat" })];
  it("keeps the primary, folds the rest in as sources and archives full copies", () => {
    const before = library();
    const out = mergeGame(before, "a", ["b", "c"]);
    expect(out.map((piko) => piko.id)).toEqual(["a", "z"]);
    const merged = out[0];
    expect(merged.launchSources?.map((source) => source.id)).toEqual(["a", "b", "c"]);
    expect(merged.launchSources?.map((source) => source.label)).toEqual(["Steam", "Heroic", "Flatpak"]);
    expect(merged.preferredSource).toBe("a");
    expect(merged.mergedFrom).toEqual([before[2], before[3]]);
    expect(merged.tags).toEqual(["indie"]);
    expect(mergedIds(merged)).toEqual(["b", "c"]);
  });
  it("round-trips exactly", () => {
    const before = library();
    const restored = unmergeGame(mergeGame(before, "a", ["b", "c"]), "a");
    const byId = (list: Piko[]) => [...list].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(restored)).toEqual(byId(before));
    expect(Object.keys(restored.find((piko) => piko.id === "a")!)).toEqual(Object.keys(before[0]));
  });
  it("unmerges one source at a time and keeps the rest merged", () => {
    const step = unmergeGame(mergeGame(library(), "a", ["b", "c"]), "a", "b");
    const primary = step.find((piko) => piko.id === "a")!;
    expect(primary.launchSources?.map((source) => source.id)).toEqual(["a", "c"]);
    expect(primary.mergedFrom?.map((piko) => piko.id)).toEqual(["c"]);
    expect(step.find((piko) => piko.id === "b")).toEqual(library()[2]);
  });
  it("resets the preferred source when it is unmerged", () => {
    const merged = mergeGame(library(), "a", ["b", "c"]);
    const prefers = merged.map((piko) => (piko.id === "a" ? { ...piko, preferredSource: "b" } : piko));
    expect(unmergeGame(prefers, "a", "b").find((piko) => piko.id === "a")!.preferredSource).toBe("a");
  });
  it("handles a game that was already merged (nested) and restores it whole", () => {
    const first = mergeGame(library(), "b", ["c"]);
    const second = mergeGame(first, "a", ["b"]);
    const top = second.find((piko) => piko.id === "a")!;
    expect(top.launchSources?.map((source) => source.id)).toEqual(["a", "b", "c"]);
    expect(mergedIds(top)).toEqual(["b", "c"]);
    const back = unmergeGame(second, "a");
    expect(back.find((piko) => piko.id === "b")).toEqual(first.find((piko) => piko.id === "b"));
    expect(back.find((piko) => piko.id === "a")!.launchSources).toBeUndefined();
  });
  it("labels repeated sources apart and is a no-op for unknown ids", () => {
    const lib = [steam("a", "G", 1), steam("b", "G", 2)];
    expect(mergeGame(lib, "a", ["b"])[0].launchSources?.map((source) => source.label)).toEqual(["Steam", "Steam (2)"]);
    expect(mergeGame(lib, "nope", ["b"])).toBe(lib);
    expect(mergeGame(lib, "a", ["a"])).toBe(lib);
    expect(unmergeGame(lib, "a")).toBe(lib);
  });
  it("pickPrimary prefers the entry with metadata", () => {
    expect(pickPrimary([game("a", "X", "/a"), game("b", "X", "/b", { igdbId: 1 })]).id).toBe("b");
    expect(pickPrimary([game("a", "X", "/a"), game("b", "X", "/b")]).id).toBe("a");
  });
});

describe("launch source selection", () => {
  const merged = mergeGame([steam("a", "Celeste", 1), heroic("b", "Celeste", "x", "legendary", { installPath: "/heroic/celeste" })], "a", ["b"])[0];
  it("uses the first source by default and the preferred one when set", () => {
    expect(launchTargetFor(merged)).toBe("steam://rungameid/1");
    const via = { ...merged, preferredSource: "b" };
    expect(activeSource(via)?.label).toBe("Heroic");
    expect(launchTargetFor(via)).toBe("heroic://launch?appName=x&runner=legendary");
    expect(sourceInstallPathFor(via)).toBe("/heroic/celeste");
    expect(sourceInstallPathFor(merged)).toBe("/steam/1");
  });
  it("falls back to the first source for a removed preference and to the Piko target for ordinary games", () => {
    expect(launchTargetFor({ ...merged, preferredSource: "gone" })).toBe("steam://rungameid/1");
    expect(launchTargetFor({ executablePath: "/bin/g", installPath: "/x" })).toBe("/bin/g");
    expect(sourceInstallPathFor({ executablePath: "/bin/g", installPath: "/x" })).toBe("/x");
  });
  it("a Tofu's own target still wins", () => { expect(launchTargetFor({ ...merged, preferredSource: "b" }, { launchTarget: "mc-instance://p/x" })).toBe("mc-instance://p/x"); });
});

describe("playtime aliasing", () => {
  const merged = mergeGame([steam("a", "Celeste", 1), heroic("b", "Celeste", "x", "legendary"), game("c", "Celeste", "/c")], "a", ["b", "c"]);
  it("counts the playtime of merged pikos for the primary", () => {
    const out = foldLegacyPlaytime([{ gameId: "a", seconds: 100, lastPlayed: 5 }, { gameId: "b", seconds: 50, lastPlayed: 9 }, { gameId: "c", seconds: 1, lastPlayed: 2 }, { gameId: "other", seconds: 7, lastPlayed: 1 }], merged);
    expect(out).toEqual([{ gameId: "a", seconds: 151, lastPlayed: 9 }, { gameId: "other", seconds: 7, lastPlayed: 1 }]);
  });
  it("stops aliasing after unmerge", () => {
    const entries = [{ gameId: "a", seconds: 100, lastPlayed: 5 }, { gameId: "b", seconds: 50, lastPlayed: 9 }];
    expect(foldLegacyPlaytime(entries, unmergeGame(merged, "a"))).toBe(entries);
  });
});

describe("storeKey for Legendary and Nile", () => {
  it("matches the keys Heroic produces for the same store ids", async () => {
    const { storeKey } = await import("./duplicates");
    expect(storeKey("legendary://launch/Sugar")).toBe(storeKey("heroic://launch?appName=Sugar&runner=legendary"));
    expect(storeKey("nile://launch/abc-1")).toBe(storeKey("heroic://launch?appName=abc-1&runner=nile"));
    expect(storeKey("legendary://launch/")).toBeNull();
  });
});
