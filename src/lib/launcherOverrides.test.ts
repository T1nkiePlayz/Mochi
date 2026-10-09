// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Piko } from "../models";
import type { ImportedGame } from "./sources";
import { applyKindOverride, applyPikoKindOverride, overrideKeyForImport, overrideKeyForPiko, readOverrides, resetOverridesCache, sanitizeOverrides, setOverride } from "./launcherOverrides";
import { classifyLauncherEntry, sanitizeLibrary } from "./library";
import { importedGameToPiko } from "./importMapping";

const item = (over: Partial<ImportedGame> = {}): ImportedGame => ({ id: "flatpak:org.vinegarhq.Sober", name: "Sober", source: "flatpak", launchTarget: "flatpak://org.vinegarhq.Sober", installPath: null, kind: "launcher", launcherId: "sober", iconPath: null, ...over });
const piko = (over: Partial<Piko> = {}): Piko => ({ id: "p", name: "Sober", description: "", accent: "#fff", artwork: "", sourceId: "flatpak", executablePath: "flatpak://org.vinegarhq.Sober", tofus: [], ...over });

describe("stored overrides", () => {
  beforeEach(() => { window.localStorage.clear(); resetOverridesCache(); });
  it("round-trips and clears", () => {
    setOverride("a", "game"); setOverride("b", "launcher");
    expect(readOverrides()).toEqual({ a: "game", b: "launcher" });
    resetOverridesCache();
    expect(readOverrides()).toEqual({ a: "game", b: "launcher" });
    setOverride("a", null);
    expect(readOverrides()).toEqual({ b: "launcher" });
  });
  it("drops junk on read", () => {
    expect(sanitizeOverrides({ a: "game", b: "x", c: 1 })).toEqual({ a: "game" });
    expect(sanitizeOverrides([1])).toEqual({});
    expect(sanitizeOverrides(null)).toEqual({});
  });
});

describe("keys", () => {
  it("a piko imported from an item gets the item's key", () => {
    const game = item();
    expect(overrideKeyForPiko(importedGameToPiko(game, 1))).toBe(overrideKeyForImport(game));
  });
  it("falls back to source + target for older entries", () => {
    expect(overrideKeyForPiko(piko())).toBe("flatpak:flatpak://org.vinegarhq.Sober");
  });
});

describe("applyKindOverride", () => {
  it("moves a launcher to games and back", () => {
    const game = applyKindOverride(item(), { [item().id]: "game" });
    expect(game).toMatchObject({ kind: "game", launcherId: null });
    expect(applyKindOverride(game, { [item().id]: "launcher" })).toMatchObject({ kind: "launcher" });
  });
  it("leaves unrelated or already-matching items alone", () => {
    const a = item();
    expect(applyKindOverride(a, {})).toBe(a);
    expect(applyKindOverride(a, { [a.id]: "launcher" })).toBe(a);
  });
});

describe("applyPikoKindOverride", () => {
  it("makes a game a launcher", () => {
    const p = piko({ name: "Thing", executablePath: "x", kind: "game", platformCategory: "Flatpak", categories: ["Minecraft"] });
    const out = applyPikoKindOverride(p, { [overrideKeyForPiko(p)]: "launcher" });
    expect(out).toMatchObject({ kind: "launcher", platformCategory: "Launchers", categories: ["Minecraft", "Launcher"] });
  });
  it("makes a launcher a game and restores the source label", () => {
    const p = piko({ kind: "launcher", launcherId: "sober", platformCategory: "Launchers", categories: ["Launcher"] });
    const out = applyPikoKindOverride(p, { [overrideKeyForPiko(p)]: "game" });
    expect(out).toMatchObject({ kind: "game", platformCategory: "Flatpak", categories: [] });
    expect(out.launcherId).toBeUndefined();
  });
  it("is a no-op without an override", () => {
    const p = piko();
    expect(applyPikoKindOverride(p, {})).toBe(p);
  });
});

describe("override wins over automatic classification", () => {
  it("keeps a known launcher a game", () => {
    const p = piko();
    expect(classifyLauncherEntry(p).kind).toBe("launcher");
    expect(classifyLauncherEntry(p, { [overrideKeyForPiko(p)]: "game" }).kind).toBe("game");
  });
  it("keeps an unknown program a launcher", () => {
    const p = piko({ name: "My Tool", executablePath: "/opt/tool", kind: "game" });
    expect(classifyLauncherEntry(p).kind).toBe("game");
    expect(classifyLauncherEntry(p, { [overrideKeyForPiko(p)]: "launcher" }).kind).toBe("launcher");
  });
  it("applies on library load", () => {
    const p = piko();
    const out = sanitizeLibrary([p], { [overrideKeyForPiko(p)]: "game" });
    expect(out[0]!.kind).toBe("game");
  });
});
