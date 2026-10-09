import { describe, expect, it } from "vitest";
import type { CfGame } from "../curseforge";
import { createPreviewSource, pickOtherGames, planSections } from "./allSections";
import { createLimiter } from "./limit";
import type { ModSource } from "./types";

const game = (id: number, name: string): CfGame => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-") });

describe("planSections", () => {
  const games = [
    { key: "cf:1", name: "A", cfId: 1, primary: "curseforge" as const, needsNexusKey: false },
    { key: "nx:b", name: "B", nexusDomain: "b", primary: "nexus" as const, needsNexusKey: false },
    { key: "nx:c", name: "C", nexusDomain: "c", primary: null, needsNexusKey: true },
  ];
  it("lists Minecraft first, then games in order, and counts Nexus-only games without a key", () => {
    const { sections, skipped } = planSections({ modrinth: true, curseforge: true, games });
    expect(sections.map((section) => section.key)).toEqual(["minecraft", "cf:1", "nx:b"]);
    expect(sections[0].site).toBe("modrinth");
    expect(skipped).toBe(1);
  });
  it("falls back to CurseForge for Minecraft and omits it when both are off", () => {
    expect(planSections({ modrinth: false, curseforge: true, games: [] }).sections[0]).toMatchObject({ site: "curseforge", cfId: 432 });
    expect(planSections({ modrinth: false, curseforge: false, games: [] }).sections).toEqual([]);
  });
});

describe("pickOtherGames", () => {
  const all = [game(432, "Minecraft"), game(1, "Some Game"), game(2, "Starfield"), game(3, "The Sims 4"), game(4, "Other"), game(5, "Third")];
  it("prefers curated names, skips Minecraft and added games, then fills in order", () => {
    expect(pickOtherGames(all, new Set([3]), 3).map((entry) => entry.id)).toEqual([2, 1, 4]);
    expect(pickOtherGames(all, new Set(), 2).map((entry) => entry.id)).toEqual([3, 2]);
  });
  it("handles a missing list", () => { expect(pickOtherGames(null, new Set())).toEqual([]); });
});

describe("createPreviewSource", () => {
  it("asks for ten, caches by key and retries after a failure", async () => {
    let calls = 0, fail = true;
    const base = { id: "curseforge", label: "", siteUrl: "", sorts: [], defaultSort: "pop", searchesServerSide: true, categories: async () => [], details: async () => ({ body: null, facts: [] }), files: async () => [], resolveDownload: async () => ({ fileName: "", pageUrl: "" }),
      async search(options: { limit: number; sort: string }) { calls += 1; if (fail) throw new Error("x"); expect(options).toMatchObject({ limit: 10, sort: "pop" }); return { items: [], total: 0, nextOffset: 0, hasMore: true }; } } as unknown as ModSource;
    const source = createPreviewSource(base, "test-key", 10, createLimiter(3));
    const opts = { query: "", offset: 30, limit: 30, sort: "x" };
    await expect(source.search(opts)).rejects.toThrow();
    fail = false;
    expect((await source.search(opts)).hasMore).toBe(false);
    await source.search(opts);
    expect(calls).toBe(2);
  });
});
