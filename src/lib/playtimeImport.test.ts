import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { playtimeTargets } from "./playtimeImport";

const game = (id: string, name: string, executablePath: string, extra: Partial<Piko> = {}): Piko => ({
  id, name, description: "", accent: "#fff", artwork: "", executablePath, source: "custom",
  tofus: [{ id: "default", name: "Default", version: "Imported", runtime: "native", mods: 0, status: "Ready" }], ...extra,
});

describe("playtimeTargets", () => {
  it("maps Heroic, Lutris and GOG games to their store identities", () => {
    const library = [
      game("heroic:legendary:Fortnite", "Fortnite", "heroic://launch?appName=Fortnite&runner=legendary", { sourceId: "heroic" }),
      game("heroic:gog:1207658924", "Witcher", "heroic://launch?appName=1207658924&runner=gog", { sourceId: "heroic" }),
      game("lutris:3", "Hades", "lutris:rungameid/3", { sourceId: "lutris" }),
      game("gog:55", "Gwent", "/Applications/Gwent.app", { sourceId: "gog" }),
      game("custom-1", "Mine", "/games/mine"),
      game("launcher:heroic", "Heroic", "heroic://launch?appName=x", { sourceId: "heroic", kind: "launcher" }),
    ];
    expect(playtimeTargets(library)).toEqual([
      { keys: ["heroic:Fortnite"], gameId: "heroic:legendary:Fortnite", name: "Fortnite" },
      { keys: ["heroic:1207658924", "gog:1207658924"], gameId: "heroic:gog:1207658924", name: "Witcher" },
      { keys: ["lutris:3"], gameId: "lutris:3", name: "Hades" },
      { keys: ["gog:55"], gameId: "gog:55", name: "Gwent" },
    ]);
  });

  it("returns nothing for a library without those stores", () => {
    expect(playtimeTargets([])).toEqual([]);
    expect(playtimeTargets([game("steam:1", "S", "steam://rungameid/1", { sourceId: "steam" })])).toEqual([]);
  });
});
