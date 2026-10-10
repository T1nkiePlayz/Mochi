import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { ImportedGame } from "./sources";
import { describeWatch, diffLibrary, unseen } from "./libraryWatch";

const piko = (id: string, extra: Partial<Piko> = {}): Piko => ({ id, name: id, description: "", accent: "#000", artwork: "", tofus: [], ...extra });
const game = (id: string, extra: Partial<ImportedGame> = {}): ImportedGame => ({ id, name: id, source: "steam", launchTarget: `steam://rungameid/${id}`, ...extra });

describe("library watch", () => {
  it("finds new games and ignores launchers, extras and games already in the library", () => {
    const library = [piko("a", { importKey: "1", sourceId: "steam", executablePath: "steam://rungameid/1" })];
    const scans = new Map([["steam", [game("1"), game("2"), game("3", { kind: "launcher" }), game("4", { contentType: "soundtrack" })]]]);
    expect(diffLibrary(library, scans).added.map((g) => g.id)).toEqual(["2"]);
  });
  it("reports games missing from a source, but never when the scan is empty", () => {
    const library = [piko("a", { importKey: "1", sourceId: "steam" }), piko("b", { importKey: "2", sourceId: "steam" })];
    expect(diffLibrary(library, new Map([["steam", [game("1")]]])).missing.map((p) => p.id)).toEqual(["b"]);
    expect(diffLibrary(library, new Map([["steam", []]])).missing).toEqual([]);
  });
  it("does not flood on the first check and describes changes", () => {
    expect(unseen(["x"], null)).toEqual([]);
    expect(unseen(["x", "y"], new Set(["x"]))).toEqual(["y"]);
    expect(describeWatch(0, 0)).toBeNull();
    expect(describeWatch(2, 1)?.message).toBe("2 new games found (Add game > Import) and 1 game no longer found in their launcher.");
  });
});
