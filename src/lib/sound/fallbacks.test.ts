import { describe, expect, it } from "vitest";
import { buildSoundChain, resolveSoundPackChain } from "./resolve";
import { normalizeSoundSettings, normalizeSoundFallbacks } from "./settings";
import { fallbackNoticeOnce, resetFallbackNotice } from "./fallbackNotice";
import type { SoundPackInfo } from "./packs";

const info = (id: string): SoundPackInfo => ({ id, name: id, version: "1", author: "", description: "", events: ["select"], volume: 1, sizeBytes: 1 });
const installed = [info("a"), info("b")];

describe("resolveSoundPackChain", () => {
  const has = (...ids: string[]) => (id: string) => ids.includes(id);
  it("keeps available candidates in order and ends with the app default", () => {
    expect(resolveSoundPackChain(["a", "b"], has("a", "b"))).toEqual({ chain: ["a", "b", "mochi"], skipped: [] });
  });
  it("skips a missing pack and reports it", () => {
    expect(resolveSoundPackChain(["gone", "b"], has("b"))).toEqual({ chain: ["b", "mochi"], skipped: ["gone"] });
  });
  it("falls back to the app default when every pack fails", () => {
    expect(resolveSoundPackChain(["a", "b"], () => false)).toEqual({ chain: ["mochi"], skipped: ["a", "b"] });
    expect(resolveSoundPackChain([], () => false).chain).toEqual(["mochi"]);
  });
  it("dedupes and ignores empty ids", () => {
    expect(resolveSoundPackChain(["a", undefined, "a", "", "b", "a"], has("a", "b")).chain).toEqual(["a", "b", "mochi"]);
  });
  it("does not play anything after the default, which has every sound", () => {
    expect(resolveSoundPackChain(["mochi", "a"], has("a")).chain).toEqual(["mochi"]);
  });
});

describe("buildSoundChain", () => {
  it("orders theme pack, theme fallbacks, then the user's fallbacks", () => {
    const { chain } = buildSoundChain({ choice: "theme", themePack: "a", themeFallbacks: ["glass"], userFallbacks: ["b"], installed });
    expect(chain.map((pack) => pack.id)).toEqual(["a", "glass", "b", "mochi"]);
    expect(chain[0].installed?.id).toBe("a");
  });
  it("lets an explicit user choice win, and falls back through the theme", () => {
    expect(buildSoundChain({ choice: "b", themePack: "chiptune", installed }).chain.map((pack) => pack.id)).toEqual(["b", "chiptune", "mochi"]);
  });
  it("a theme naming a missing pack still resolves, reporting it skipped", () => {
    const result = buildSoundChain({ choice: "theme", themePack: "missing", themeFallbacks: ["nope", "a"], installed });
    expect(result.chain.map((pack) => pack.id)).toEqual(["a", "mochi"]);
    expect(result.skipped).toEqual(["missing", "nope"]);
  });
  it("skips packs known to fail", () => {
    const result = buildSoundChain({ choice: "theme", themePack: "a", userFallbacks: ["b"], installed, failed: new Set(["a"]) });
    expect(result.chain.map((pack) => pack.id)).toEqual(["b", "mochi"]);
  });
  it("caps theme fallbacks and ignores bad ids", () => {
    const { chain } = buildSoundChain({ choice: "theme", themeFallbacks: ["../x", "chiptune", "chiptune", "glass"], installed });
    expect(chain.map((pack) => pack.id)).toEqual(["chiptune", "glass", "mochi"]);
  });
});

describe("fallback settings and notice", () => {
  it("normalises the user's fallback list", () => {
    expect(normalizeSoundFallbacks(["a", "a", "theme", "../x", 3, "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(normalizeSoundSettings({ fallbacks: "nope" }).fallbacks).toEqual([]);
    expect(normalizeSoundSettings({ fallbacks: ["a", "b"] }).fallbacks).toEqual(["a", "b"]);
  });
  it("announces a fallback once per session", () => {
    resetFallbackNotice();
    expect(fallbackNoticeOnce([], "Mochi")).toBeNull();
    expect(fallbackNoticeOnce(["Clicks"], "Mochi")).toContain("“Clicks”");
    expect(fallbackNoticeOnce(["Other"], "Mochi")).toBeNull();
  });
});
