import { describe, expect, it } from "vitest";
import { applyMetadata, cssUrl, planProviders, steamImportTargets, withSteam } from "./merge";
import { MAX_ENTRIES, ProviderCache } from "./cache";

describe("cssUrl", () => {
  it("cannot be ended early by quotes, parentheses or whitespace", () => {
    const out = cssUrl(`https://a/b'); background:red; x:url('c d`);
    expect(out.startsWith("url('")).toBe(true);
    expect(out.slice(5, -2)).not.toMatch(/['"() ]/);
  });
  it("is used for applied artwork", () => {
    const next = applyMetadata({ id: "a", name: "A", description: "", accent: "", artwork: "", tofus: [] }, { art: { source: "igdb", url: "https://x/y.jpg')" } });
    expect(next.artwork).not.toContain("')\"");
    expect(next.artworkUrl).toBe("https://x/y.jpg')");
  });
});

describe("ProviderCache", () => {
  it("is bounded so it cannot fill local storage", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } };
    const cache = new ProviderCache("igdb", "u");
    for (let i = 0; i < MAX_ENTRIES + 50; i++) cache.set(`k${i}`, {}, Date.now() + i);
    cache.flush();
    const saved = JSON.parse([...store.values()][0]!) as Record<string, unknown>;
    expect(Object.keys(saved)).toHaveLength(MAX_ENTRIES);
    expect(saved["k0"]).toBeUndefined();
    delete (globalThis as { window?: unknown }).window;
  });
});

describe("planProviders", () => {
  const none = { igdb: false, steamgriddb: false };
  it("keyless Steam works signed out, for Steam games only", () => {
    expect(planProviders("auto", none, 440)).toEqual({ text: ["steam"], art: ["steam"] });
    expect(planProviders("auto", none, null)).toEqual({ text: [], art: [] });
  });
  it("a single provider never needs another one", () => {
    expect(planProviders("steam", { igdb: true, steamgriddb: true }, 440)).toEqual({ text: ["steam"], art: ["steam"] });
    expect(planProviders("steam", none, null)).toEqual({ text: [], art: [] });
    expect(planProviders("igdb", none, 440)).toEqual({ text: [], art: [] });
    expect(planProviders("steamgriddb", { igdb: false, steamgriddb: true }, null)).toEqual({ text: [], art: ["steamgriddb"] });
  });
});

describe("withSteam", () => {
  it("adds Steam to explicit-provider plans for Steam games only", () => {
    expect(withSteam({ text: [], art: [] }, 440)).toEqual({ text: ["steam"], art: ["steam"] });
    expect(withSteam({ text: ["igdb"], art: ["igdb"] }, 440)).toEqual({ text: ["igdb", "steam"], art: ["igdb", "steam"] });
    expect(withSteam({ text: ["steam"], art: ["steam"] }, 440)).toEqual({ text: ["steam"], art: ["steam"] });
    expect(withSteam({ text: [], art: [] }, null)).toEqual({ text: [], art: [] });
  });
});

describe("steamImportTargets", () => {
  const base = { description: "", accent: "", artwork: "", tofus: [] };
  it("selects fresh Steam games, skipping launchers, non-Steam games and ones with metadata", () => {
    const fresh = { ...base, id: "imported-steam-steam-440-1", name: "TF2", sourceId: "steam", executablePath: "steam://rungameid/440" };
    const launcher = { ...fresh, id: "l", kind: "launcher" as const };
    const other = { ...base, id: "x", name: "X", executablePath: "/bin/x" };
    const done = { ...fresh, id: "d", artworkSource: "steam" as const };
    const shots = { ...fresh, id: "s", screenshots: ["a"] };
    expect(steamImportTargets([fresh, launcher, other, done, shots]).map((p) => p.id)).toEqual([fresh.id]);
  });
});

describe("content type from the Steam Store", () => {
  const piko = { id: "a", name: "A", description: "", accent: "", artwork: "", tofus: [] };
  it("is applied, but never over the user's own choice", () => {
    expect(applyMetadata(piko, { text: { contentType: "soundtrack" } }).contentType).toBe("soundtrack");
    expect(applyMetadata({ ...piko, contentType: "game", contentTypeLocked: true }, { text: { contentType: "soundtrack" } }).contentType).toBe("game");
    expect(applyMetadata({ ...piko, contentType: "soundtrack" }, { text: { description: "x" } }).contentType).toBe("soundtrack");
  });
});
