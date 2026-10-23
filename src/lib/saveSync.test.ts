import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import type { Piko } from "../models";
import { syncGames } from "./saveSync";

const piko = (over: Partial<Piko>): Piko => ({ id: "g", name: "Game", description: "", accent: "#000", artwork: "", tofus: [], ...over });

describe("save sync games", () => {
  it("lists only games that can have saves, with their hints", () => {
    const games = syncGames([piko({ id: "none" }), piko({ id: "steam:480", sourceId: "steam", saveBackup: { folders: ["/a"] } })]);
    expect(games.map((game) => game.pikoId)).toEqual(["steam:480"]);
    expect(games[0].hints.folders).toEqual(["/a"]);
    expect(games[0].hints.steamAppId).toBe(480);
  });
});
