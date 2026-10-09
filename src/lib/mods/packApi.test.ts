import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => { throw new Error("no native in tests"); }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../supabase", () => ({ supabase: null }));
vi.mock("../curseforge", async (original) => ({
  ...(await original<typeof import("../curseforge")>()),
  cfMod: vi.fn(async () => ({ id: 715572, name: "All the Mods 9", summary: "Kitchen sink", slug: "all-the-mods-9", logo: { thumbnailUrl: "https://media.forgecdn.net/logo.png" }, links: { websiteUrl: "https://www.curseforge.com/minecraft/modpacks/all-the-mods-9" } })),
  cfFiles: vi.fn(async () => ({ data: [
    { id: 1, modId: 715572, displayName: "ATM9 1.0", fileName: "a.zip", releaseType: 1, fileDate: "2025-01-01T00:00:00Z" },
    { id: 2, modId: 715572, displayName: "ATM9 2.0", fileName: "b.zip", releaseType: 1, fileDate: "2025-02-01T00:00:00Z" },
  ], pagination: { index: 0, pageSize: 2, resultCount: 2, totalCount: 2 } })),
}));

import { loadLinkedPack } from "./packApi";

afterEach(() => { vi.unstubAllGlobals(); });

describe("CurseForge pack data is never persisted", () => {
  it("shows the name, icon and update live but writes nothing to storage or disk caches", async () => {
    const set = vi.fn();
    vi.stubGlobal("localStorage", { setItem: set, getItem: vi.fn(() => null), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
    const tofu = { name: "ATM9", version: "1.21.1", runtime: "prism", loader: "neoforge" as const };
    const info = await loadLinkedPack(tofu, { source: "curseforge", projectId: "715572", versionId: "1", matchedBy: "managed" });
    expect(info).toMatchObject({ name: "All the Mods 9", iconUrl: "https://media.forgecdn.net/logo.png", update: { versionId: "2" } });
    expect(set).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled(); // no get_public_api / artwork cache command for CurseForge
  });
});
