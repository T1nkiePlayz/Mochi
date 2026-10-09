import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const providerCalls: Array<Record<string, unknown>> = [];
vi.mock("./functions", () => ({
  invokeProviderFunction: (_client: unknown, body: Record<string, unknown>) => {
    providerCalls.push(body);
    return Promise.resolve({ companies: [{ name: "Valve", slug: "valve", logo: { image_id: "abc123" } }] });
  },
}));

const { applyIconCovers, applyLauncherLogos, pickCompanyLogo, LAUNCHER_COMPANIES } = await import("./iconCover");
const { LAUNCHERS } = await import("./launchers");

beforeEach(() => { invoke.mockReset(); providerCalls.length = 0; });

describe("company logos", () => {
  it("prefers slugs in order, then names, and ignores entries without a logo", () => {
    const wanted = { slugs: ["steam", "valve"], names: ["Valve"] };
    expect(pickCompanyLogo([{ slug: "valve", logo: { image_id: "v1" } }, { slug: "steam", logo: null }], wanted)).toBe("https://images.igdb.com/igdb/image/upload/t_logo_med_2x/v1.png");
    expect(pickCompanyLogo([{ slug: "other", name: "valve", logo: { image_id: "n1" } }], wanted)).toContain("/n1.png");
    expect(pickCompanyLogo([{ slug: "steam", logo: { image_id: "../x" } }], wanted)).toBeNull();
    expect(pickCompanyLogo([], wanted)).toBeNull();
  });

  it("only names launchers Mochi knows", () => {
    const known = new Set(LAUNCHERS.map((launcher) => launcher.id));
    expect(Object.keys(LAUNCHER_COMPANIES).filter((id) => !known.has(id))).toEqual([]);
  });

  it("replaces launcher covers once per launcher and skips custom art", async () => {
    invoke.mockResolvedValue({ cover: "data:image/jpeg;base64,x" });
    const done = await applyLauncherLogos({} as never, [
      { id: "a", kind: "launcher", launcherId: "steam", artworkCacheKey: "ka" },
      { id: "b", kind: "launcher", launcherId: "steam", artworkCacheKey: "kb" },
      { id: "c", kind: "launcher", launcherId: "steam", artworkCacheKey: "kc", artworkSource: "custom" },
      { id: "d", kind: "launcher", launcherId: "lutris", artworkCacheKey: "kd" },
      { id: "e", kind: "game", launcherId: "steam", artworkCacheKey: "ke" },
    ]);
    expect([...done].sort()).toEqual(["a", "b"]);
    expect(providerCalls).toEqual([{ action: "igdb-company", slugs: LAUNCHER_COMPANIES.steam.slugs, names: LAUNCHER_COMPANIES.steam.names }]);
    expect(invoke).toHaveBeenCalledWith("cache_icon_cover", { cacheKey: "ka", source: "https://images.igdb.com/igdb/image/upload/t_logo_med_2x/abc123.png", replace: true });
  });
});

describe("icon covers", () => {
  it("caches icons for imported games without replacing existing art", async () => {
    invoke.mockImplementation((_command: string, args: { cacheKey: string }) => Promise.resolve(args.cacheKey === "bad" ? { cover: null } : { cover: "data:x" }));
    const icons = new Map([["a", "/icons/a.png"], ["b", "/icons/b.png"], ["c", "/icons/c.png"]]);
    const done = await applyIconCovers([
      { id: "a", artworkCacheKey: "ka" },
      { id: "b", artworkCacheKey: "bad" },
      { id: "c", artworkCacheKey: "kc", lockedFields: ["artwork"] },
      { id: "d", artworkCacheKey: "kd" },
    ], icons);
    expect([...done]).toEqual(["a"]);
    expect(invoke).toHaveBeenCalledWith("cache_icon_cover", { cacheKey: "ka", source: "/icons/a.png", replace: false });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("survives native errors", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect([...await applyIconCovers([{ id: "a", artworkCacheKey: "ka" }], new Map([["a", "/x.png"]]))]).toEqual([]);
  });
});
