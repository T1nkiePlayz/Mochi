import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { ImportedGame } from "./sources";
import { applyLocated, applyNewPaths, collectPaths, findMissing, isLocalPath, matchMissingGames } from "./pathRemap";
import { cloudExecutablePath, mergeCloudLibrary } from "./cloud";

const piko = (over: Partial<Piko> & { id: string; name: string }): Piko => ({
  description: "", accent: "#fff", artwork: "", tofus: [{ id: "default", name: "Default", version: "1", runtime: "Native", mods: 0, status: "Ready" }], ...over,
});
const scan = (over: Partial<ImportedGame> & { id: string; name: string; source: ImportedGame["source"]; launchTarget: string }): ImportedGame => ({ kind: "game", installPath: null, ...over });

describe("collectPaths", () => {
  it("collects local paths and ignores launcher URIs and relative text", () => {
    const library = [
      piko({ id: "a", name: "A", executablePath: "/games/a/run.sh", installPath: "/games/a", launchOptions: { env: [], args: [], workingDir: "/games/a/bin" } }),
      piko({ id: "b", name: "B", executablePath: "steam://rungameid/620", installPath: "/steam/b" }),
      piko({ id: "c", name: "C", executablePath: "heroic://launch?appName=x&runner=gog" }),
      piko({ id: "d", name: "D", executablePath: "flatpak://org.x.App" }),
      piko({ id: "e", name: "E", executablePath: "game.exe", tofus: [{ id: "t", name: "T", version: "1", runtime: "Native", mods: 0, status: "Ready", path: "/mods/e", launchTarget: "mc-instance://prism/x" }] }),
    ];
    expect(collectPaths(library).map((slot) => `${slot.gameId}:${slot.field}:${slot.path}`)).toEqual([
      "a:executablePath:/games/a/run.sh", "a:installPath:/games/a", "a:workingDir:/games/a/bin", "b:installPath:/steam/b", "e:tofuPath:/mods/e",
    ]);
    expect(isLocalPath("steam://rungameid/1")).toBe(false);
    expect(isLocalPath("/home/me/game")).toBe(true);
  });
});

describe("findMissing", () => {
  it("flags only slots whose path the native check reports missing", async () => {
    const library = [piko({ id: "a", name: "A", executablePath: "/there/a" }), piko({ id: "b", name: "B", executablePath: "/gone/b", installPath: "/there/b" }), piko({ id: "c", name: "C", executablePath: "steam://rungameid/1" })];
    const asked: string[][] = [];
    const missing = await findMissing(library, async (paths) => { asked.push(paths); return paths.map((path) => !path.startsWith("/gone")); });
    expect([...missing.keys()]).toEqual(["b"]);
    expect(missing.get("b")?.map((slot) => slot.field)).toEqual(["executablePath"]);
    expect(asked[0]).not.toContain("steam://rungameid/1");
  });
});

describe("matchMissingGames", () => {
  it("matches by store id first", () => {
    const missing = [piko({ id: "x", name: "Renamed Locally", sourceId: "gog", executablePath: "/old/gog/Game", importKey: "gog:1207" })];
    const scanned = [scan({ id: "gog:1207", name: "Some Game", source: "gog", launchTarget: "/new/gog/Game", installPath: "/new/gog/Game" })];
    expect(matchMissingGames(missing, scanned)).toEqual([{ gameId: "x", confidence: "store-id", newPaths: { executablePath: "/new/gog/Game", installPath: "/new/gog/Game" }, matched: { id: "gog:1207", name: "Some Game", source: "gog" } }]);
  });

  it("derives the identity of a synced game from its launch target (itch, Lutris, desktop entry)", () => {
    const missing = [
      piko({ id: "l", name: "Zed", sourceId: "lutris", executablePath: "/home/old/lutris-runner" }),
      piko({ id: "d", name: "Desk", sourceId: "apps", executablePath: "/home/old/.local/share/applications/desk.desktop" }),
    ];
    const scanned = [
      scan({ id: "apps:desk.desktop", name: "Something Else", source: "apps", launchTarget: "/home/new/.local/share/applications/desk.desktop" }),
    ];
    expect(matchMissingGames(missing, scanned).map((match) => [match.gameId, match.confidence])).toEqual([["d", "store-id"]]);
  });

  it("falls back to an exact normalized name as a lower confidence match", () => {
    const missing = [piko({ id: "x", name: "The Witcher® 3", sourceId: "gog", executablePath: "/old/w3" })];
    const scanned = [scan({ id: "gog:99", name: "Witcher 3", source: "gog", launchTarget: "/new/w3" })];
    expect(matchMissingGames(missing, scanned)[0]).toMatchObject({ gameId: "x", confidence: "name", newPaths: { executablePath: "/new/w3" } });
  });

  it("never matches across sources and ignores ambiguous names", () => {
    const missing = [piko({ id: "x", name: "Portal", sourceId: "gog", executablePath: "/old/p", importKey: "gog:620" })];
    const wrongSource = [scan({ id: "steam:620", name: "Portal", source: "steam", launchTarget: "steam://rungameid/620" })];
    expect(matchMissingGames(missing, wrongSource)).toEqual([]);
    const twice = [scan({ id: "gog:1", name: "Portal", source: "gog", launchTarget: "/a" }), scan({ id: "gog:2", name: "Portal", source: "gog", launchTarget: "/b" })];
    expect(matchMissingGames(missing, twice)).toEqual([]);
  });

  it("proposes the URI target for a Steam game and skips launchers", () => {
    const missing = [piko({ id: "imported-steam-620", name: "Portal 2", sourceId: "steam", importKey: "steam:620", executablePath: "/old/portal2" })];
    const scanned = [scan({ id: "steam:620", name: "Portal 2", source: "steam", launchTarget: "steam://rungameid/620", installPath: "/new/portal2" }), scan({ id: "steam:open", name: "Portal 2", source: "steam", launchTarget: "steam://open/main", kind: "launcher" })];
    expect(matchMissingGames(missing, scanned)).toHaveLength(1);
    expect(matchMissingGames(missing, scanned)[0].newPaths).toEqual({ executablePath: "steam://rungameid/620", installPath: "/new/portal2" });
  });
});

describe("device-local override", () => {
  const synced = piko({ id: "x", name: "X", executablePath: "/mac/x" });
  it("keeps the synced path for the cloud while this device launches the new one", () => {
    const fixed = { ...synced, ...applyNewPaths(synced, { executablePath: "/home/x" })! };
    expect(fixed.executablePath).toBe("/home/x");
    expect(cloudExecutablePath(fixed)).toBe("/mac/x");
    const again = { ...fixed, ...applyNewPaths(fixed, { executablePath: "/other/x" })! };
    expect(cloudExecutablePath(again)).toBe("/mac/x");
    expect(applyNewPaths(fixed, { executablePath: "/home/x" })).toBeNull();
  });

  it("survives a cloud pull that still holds the old value, and yields to a newer cloud value", () => {
    const fixed = { ...synced, ...applyNewPaths(synced, { executablePath: "/home/x" })! };
    expect(mergeCloudLibrary([fixed], [{ ...synced }])[0].executablePath).toBe("/home/x");
    const merged = mergeCloudLibrary([fixed], [{ ...synced, executablePath: "/mac/moved" }])[0];
    expect(merged.executablePath).toBe("/mac/moved");
    expect(merged.pathOverride).toBeUndefined();
  });

  it("applies a located path to the matching slot", () => {
    const game = piko({ id: "x", name: "X", executablePath: "/mac/x", tofus: [{ id: "t", name: "T", version: "1", runtime: "Native", mods: 0, status: "Ready", path: "/mac/mods" }] });
    expect(applyLocated(game, { gameId: "x", field: "executablePath", path: "/mac/x" }, "/home/x")?.executablePath).toBe("/home/x");
    expect(applyLocated(game, { gameId: "x", tofuId: "t", field: "tofuPath", path: "/mac/mods" }, "/home/mods")?.tofus?.[0].path).toBe("/home/mods");
    expect(applyLocated(game, { gameId: "x", field: "workingDir", path: "/mac/w" }, "/home/w")?.launchOptions?.workingDir).toBe("/home/w");
  });
});
