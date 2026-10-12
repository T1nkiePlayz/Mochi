import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { steamPlaytimeTargets } from "./steamPlaytime";

const game = (id: string, name: string, executablePath: string, extra: Partial<Piko> = {}): Piko => ({
  id, name, description: "", accent: "#fff", artwork: "", executablePath, source: "custom",
  tofus: [{ id: "default", name: "Default", version: "Imported", runtime: "steam", mods: 0, status: "Ready" }], ...extra,
});

describe("steamPlaytimeTargets", () => {
  it("maps imported Steam games to their app ids, one entry per app", () => {
    const library = [
      game("steam:220", "Half-Life 2", "steam://rungameid/220", { sourceId: "steam" }),
      // A duplicate of the same Steam game (a merged copy) must not become a second target.
      game("steam:220-copy", "Half-Life 2", "steam://rungameid/220", { sourceId: "steam" }),
      game("custom-1", "My own game", "/games/mygame"),
      game("launcher:steam", "Steam", "steam://open/main", { sourceId: "steam", kind: "launcher" }),
    ];
    expect(steamPlaytimeTargets(library)).toEqual([{ appid: 220, gameId: "steam:220", name: "Half-Life 2" }]);
  });

  it("maps a game launched through Steam by its rungameid target alone", () => {
    const library = [game("gog-1", "The Witcher 3", "steam://rungameid/292030")];
    expect(steamPlaytimeTargets(library)).toEqual([{ appid: 292030, gameId: "gog-1", name: "The Witcher 3" }]);
  });

  it("returns nothing for a library without Steam games", () => {
    expect(steamPlaytimeTargets([])).toEqual([]);
    expect(steamPlaytimeTargets([game("heroic-1", "Hades", "heroic://launch?appName=hades")])).toEqual([]);
  });
});
