import { describe, expect, it } from "vitest";
import { filterItems } from "./filterItems";
import type { ImportedGame } from "../../lib/sources";

const game = { id: "g", name: "Game", source: "steam" } as ImportedGame;
const launcher = { id: "l", name: "Sober", source: "flatpak", kind: "launcher" } as ImportedGame;

describe("filterItems", () => {
  it("keeps everything by default", () => expect(filterItems([game, launcher])).toEqual([game, launcher]));
  it("keeps only launchers in launchers mode", () => expect(filterItems([game, launcher], "launchers")).toEqual([launcher]));
});
