import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { ImportedGame } from "./sources";
import { excludeLibraryImports, isImportedGameInLibrary } from "./importFiltering";

const game = (overrides: Partial<ImportedGame> = {}): ImportedGame => ({
  id: "steam-440",
  name: "Team Fortress 2",
  source: "steam",
  launchTarget: "steam://rungameid/440",
  kind: "game",
  ...overrides,
});

const piko = (overrides: Partial<Piko> = {}): Piko => ({
  id: "piko-1", name: "Team Fortress 2", description: "", accent: "#000", artwork: "",
  source: "custom", sourceId: "steam", importKey: "steam-440", executablePath: "steam://rungameid/440",
  tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
  ...overrides,
});

describe("library-aware game importing", () => {
  it("filters an imported game by its stable source and import identity", () => {
    expect(isImportedGameInLibrary(game(), [piko()])).toBe(true);
    expect(excludeLibraryImports([game(), game({ id: "steam-570", name: "Dota 2", launchTarget: "steam://rungameid/570" })], [piko()])).toHaveLength(1);
  });

  it("recognizes an entry already represented as an alternate launch source", () => {
    const folded = piko({ sourceId: undefined, importKey: undefined, launchSources: [{
      id: "piko-other", label: "Steam", sourceId: "steam", importKey: "steam-440", executablePath: "steam://rungameid/440",
    }] });
    expect(isImportedGameInLibrary(game(), [folded])).toBe(true);
  });

  it("recognizes Minecraft instances stored as Tofus under the shared Minecraft Piko", () => {
    const instance = game({ id: "abc", source: "prism", launchTarget: "mc-instance://prism/abc" });
    const minecraft = piko({ id: "minecraft", sourceId: undefined, importKey: undefined, executablePath: undefined,
      tofus: [{ id: "abc", name: "My World", version: "1.21", runtime: "Prism", mods: 0, status: "Ready", launchTarget: "mc-instance://prism/abc" }] });
    expect(isImportedGameInLibrary(instance, [minecraft])).toBe(true);
  });

  it("does not hide different games that share only a display name", () => {
    expect(isImportedGameInLibrary(game({ id: "steam-570", launchTarget: "steam://rungameid/570" }), [piko()])).toBe(false);
  });

  it("does not treat a launcher shortcut as an already-added game just because paths match", () => {
    const gameEntry = game({ source: "apps", id: "example-game", launchTarget: "/usr/bin/example" });
    const launcherEntry = piko({ kind: "launcher", sourceId: "apps", importKey: "example-launcher", executablePath: "/usr/bin/example" });
    expect(isImportedGameInLibrary(gameEntry, [launcherEntry])).toBe(false);
  });

  it("normalizes path separators for equivalent executable paths", () => {
    const pathGame = game({ id: "foo", source: "apps", launchTarget: "C:\\Games\\Example\\game.exe" });
    const pathPiko = piko({ sourceId: "apps", importKey: "different", executablePath: "c:/Games/Example/game.exe" });
    expect(isImportedGameInLibrary(pathGame, [pathPiko])).toBe(true);
  });
});
