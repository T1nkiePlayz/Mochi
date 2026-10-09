import { describe, expect, it } from "vitest";
import { createMixedSource } from "./mixedSource";
import type { ModSource, ModSourceId } from "./types";

function fake(id: ModSourceId, count: number, fail = false): ModSource {
  return {
    id, label: id, siteUrl: "", sorts: [], defaultSort: "x", searchesServerSide: true, categories: async () => [],
    async search({ offset, limit }) {
      if (fail) throw new Error("down");
      const items = Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, index) => ({ source: id, id: String(offset + index), name: `${id}${offset + index}`, summary: "", pageUrl: "", native: null }));
      return { items, total: count, nextOffset: offset + items.length, hasMore: offset + items.length < count };
    },
    details: async () => ({ body: null, facts: [{ label: id, value: "" }] }), files: async () => [], resolveDownload: async () => ({ fileName: "", pageUrl: "" }),
  };
}

describe("createMixedSource (Discover > All)", () => {
  it("takes mods from every game in turn and labels them", async () => {
    const source = createMixedSource([
      { game: "Minecraft", source: fake("modrinth", 100), ecosystem: { source: "modrinth" } },
      { game: "Terraria", source: fake("curseforge", 1), ecosystem: { source: "curseforge", gameId: 431 } },
      { game: "Balatro", source: fake("nexus", 50), ecosystem: { source: "nexus", domain: "balatro" } },
    ]);
    const page = await source.search({ query: "", offset: 0, limit: 30, sort: "popular" });
    expect(page.items.slice(0, 3).map((item) => item.game)).toEqual(["Minecraft", "Terraria", "Balatro"]);
    expect(new Set(page.items.map((item) => item.game)).size).toBe(3);
    expect(page.hasMore).toBe(true);
    const next = await source.search({ query: "", offset: page.nextOffset, limit: 30, sort: "popular" });
    expect(next.items.some((item) => item.game === "Terraria")).toBe(false);
    expect(next.items.length).toBeGreaterThan(0);
  });
  it("skips a failing game but fails when all fail", async () => {
    const ok = createMixedSource([{ game: "A", source: fake("curseforge", 5, true), ecosystem: { source: "curseforge", gameId: 1 } }, { game: "B", source: fake("curseforge", 5), ecosystem: { source: "curseforge", gameId: 2 } }]);
    expect((await ok.search({ query: "", offset: 0, limit: 30, sort: "popular" })).items.every((item) => item.game === "B")).toBe(true);
    const bad = createMixedSource([{ game: "A", source: fake("curseforge", 5, true), ecosystem: { source: "curseforge", gameId: 1 } }]);
    await expect(bad.search({ query: "", offset: 0, limit: 30, sort: "popular" })).rejects.toThrow();
  });
  it("routes details to the owning game", async () => {
    const source = createMixedSource([{ game: "A", source: fake("curseforge", 1), ecosystem: { source: "curseforge", gameId: 1 } }, { game: "B", source: fake("nexus", 1), ecosystem: { source: "nexus", domain: "b" } }]);
    expect((await source.details({ source: "nexus", id: "1", name: "x", summary: "", pageUrl: "", native: null, game: "B" })).facts[0].label).toBe("nexus");
  });
});
