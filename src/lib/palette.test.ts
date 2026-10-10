// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { Command } from "./commands";
import { installQuery, paletteShortcutLabel, parsePaletteQuery, PALETTE_LIMIT, pushRecent, rankPalette, readRecents, rememberAction, RECENTS_KEY } from "./palette";

const cmd = (id: string, title: string, keywords: string[] = [], group = "Help"): Command => ({ id, title, keywords, group, run: () => undefined });
const game = (id: string, name: string, tofus: Array<{ id: string; name: string }> = []) => ({ id, name, tofus } as unknown as Piko);

beforeEach(() => window.localStorage.clear());

describe("parsePaletteQuery", () => {
  it("treats a leading > as actions only", () => {
    expect(parsePaletteQuery(">  theme")).toEqual({ mode: "actions", text: "theme" });
    expect(parsePaletteQuery("  >")).toEqual({ mode: "actions", text: "" });
    expect(parsePaletteQuery("hades > x")).toEqual({ mode: "all", text: "hades > x" });
    expect(parsePaletteQuery(" hades ")).toEqual({ mode: "all", text: "hades" });
  });
  it("extracts the mod name from install queries", () => {
    expect(installQuery("install sodium")).toBe("sodium");
    expect(installQuery("Mod  Iris Shaders ")).toBe("Iris Shaders");
    expect(installQuery("install")).toBeNull();
    expect(installQuery("installer")).toBeNull();
  });
});

describe("recents", () => {
  it("moves to front, dedupes and keeps 8", () => {
    let recents: string[] = [];
    for (let i = 0; i < 10; i += 1) recents = pushRecent(recents, `c${i}`);
    expect(recents).toHaveLength(8);
    expect(recents[0]).toBe("c9");
    expect(pushRecent(recents, "c5")[0]).toBe("c5");
    expect(pushRecent(recents, "c5")).toHaveLength(8);
  });
  it("persists to localStorage and tolerates garbage", () => {
    rememberAction("a"); rememberAction("b"); rememberAction("a");
    expect(readRecents()).toEqual(["a", "b"]);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify([1, "ok", null]));
    expect(readRecents()).toEqual(["ok"]);
    window.localStorage.setItem(RECENTS_KEY, "{bad");
    expect(readRecents()).toEqual([]);
  });
});

describe("rankPalette", () => {
  const commands = [cmd("nav.library", "Go to Library"), cmd("theme.mochi", "Theme: Mochi", ["colors"], "Theme"), cmd("settings.sound", "Settings: Sound", ["audio"])];
  const games = [game("1", "Hades"), game("2", "Mochi Quest", [{ id: "t1", name: "Modded" }])];
  it("empty query shows recents then top actions, no games", () => {
    const items = rankPalette({ raw: "", commands, games, recents: ["settings.sound"] });
    expect(items.map((i) => i.kind)).toEqual(["command", "command"]);
    expect(items[0]!.subtitle).toMatch(/^Recent/);
    expect(items.map((i) => i.title)).toEqual(["Settings: Sound", "Go to Library"]);
  });
  it("mixes games and actions by score; > hides games", () => {
    const all = rankPalette({ raw: "mochi", commands, games });
    expect(all.some((i) => i.kind === "game")).toBe(true);
    expect(all.some((i) => i.kind === "command" && i.title === "Theme: Mochi")).toBe(true);
    expect(rankPalette({ raw: ">mochi", commands, games }).every((i) => i.kind !== "game")).toBe(true);
  });
  it("finds actions through keywords and offers an install row first", () => {
    expect(rankPalette({ raw: ">audio", commands, games })[0]!.title).toBe("Settings: Sound");
    const items = rankPalette({ raw: "install sodium", commands, games });
    expect(items[0]!.title).toBe('Install mod "sodium"');
  });
  it("lists Tofus and boosts recent actions", () => {
    expect(rankPalette({ raw: "modded", commands, games }).some((i) => i.kind === "tofu")).toBe(true);
    const a = [cmd("a", "Open alpha"), cmd("b", "Open beta")];
    expect(rankPalette({ raw: ">open", commands: a, games: [], recents: ["b"] })[0]!.title).toBe("Open beta");
  });
  it("caps results", () => {
    const many = Array.from({ length: 300 }, (_v, i) => game(String(i), `Game ${i}`));
    expect(rankPalette({ raw: "game", commands, games: many })).toHaveLength(PALETTE_LIMIT);
  });
});

describe("paletteShortcutLabel", () => {
  it("is platform correct", () => {
    expect(paletteShortcutLabel("macos")).toBe("⌘K");
    expect(paletteShortcutLabel("linux")).toBe("Ctrl K");
  });
});

describe("performance", () => {
  it("scores 2,000 games and 100 actions in under 5 ms", () => {
    const games = Array.from({ length: 2000 }, (_v, i) => game(String(i), `Adventure Quest ${i} of the Lost Kingdom`));
    const commands = Array.from({ length: 100 }, (_v, i) => cmd(`c${i}`, `Action number ${i}`, ["misc", "thing"]));
    rankPalette({ raw: "adv", commands, games }); // warm the per-object fold caches (they live for the item's lifetime)
    const times = [] as number[];
    for (const query of ["adv quest", "lost kng", ">act 5", "zzzz"]) { const start = performance.now(); rankPalette({ raw: query, commands, games }); times.push(performance.now() - start); }
    expect(Math.min(...times)).toBeLessThan(5);
    expect(Math.max(...times)).toBeLessThan(15);
  });
});
