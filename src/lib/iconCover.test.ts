import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const providerCalls: Array<Record<string, unknown>> = [];
vi.mock("./functions", () => ({
  invokeProviderFunction: (_client: unknown, body: Record<string, unknown>) => {
    providerCalls.push(body);
    return Promise.resolve(body.slug === "valve" ? { company: { name: "Valve", logoUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/abc123.png" } } : { company: null });
  },
}));

const { applyIconCovers, applyLauncherLogos, companyLogoUrl, LAUNCHER_COMPANIES } = await import("./iconCover");
const { LAUNCHERS } = await import("./launchers");

beforeEach(() => { invoke.mockReset(); providerCalls.length = 0; });

describe("company logos", () => {
  it("accepts only IGDB image URLs", () => {
    expect(companyLogoUrl({ company: { logoUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/x1.png" } })).toContain("x1.png");
    expect(companyLogoUrl({ company: { logoUrlLarge: "https://images.igdb.com/igdb/image/upload/t_original/x2.png" } })).toContain("x2.png");
    expect(companyLogoUrl({ company: { logoUrl: "https://evil.example/x.png" } })).toBeNull();
    expect(companyLogoUrl({ company: null })).toBeNull();
    expect(companyLogoUrl(null)).toBeNull();
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
    // Slugs are tried in order until one has a logo, once per launcher.
    expect(providerCalls).toEqual([{ action: "igdb-company", slug: "steam", name: "Valve" }, { action: "igdb-company", slug: "valve", name: "Valve" }]);
    expect(invoke).toHaveBeenCalledWith("cache_icon_cover", { cacheKey: "ka", source: "https://images.igdb.com/igdb/image/upload/t_logo_med/abc123.png", replace: true });
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
