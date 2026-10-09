import { describe, expect, it, vi } from "vitest";
import { createExtendedSource, type ExtendInfo } from "./extendedSource";
import type { ModItem, ModSource, ModSourceId } from "./types";

const item = (source: ModSourceId, n: number, name = `${source} ${n}`, author = source): ModItem => ({ source, id: String(n), name, summary: "", author, pageUrl: "", native: null });
function fake(id: ModSourceId, count: number, fail = false): ModSource & { calls: number[] } {
  const calls: number[] = [];
  return {
    id, label: id, siteUrl: "", sorts: [{ value: "a", label: "A" }], defaultSort: "a", searchesServerSide: id !== "nexus", calls,
    categories: async () => [],
    async search(options) {
      calls.push(options.offset);
      if (fail) throw new Error("down");
      const items = Array.from({ length: Math.max(0, Math.min(options.limit, count - options.offset)) }, (_, index) => item(id, options.offset + index));
      return { items, total: count, nextOffset: options.offset + items.length, hasMore: options.offset + items.length < count };
    },
    details: async () => ({ body: null, facts: [{ label: id, value: "" }] }),
    files: async () => [], resolveDownload: async () => ({ fileName: id, pageUrl: "" }),
  };
}
const q = { query: "", sort: "a", limit: 30 };

describe("createExtendedSource", () => {
  it("adds the other site when the primary has too few mods (Terraria case)", async () => {
    const info = vi.fn<(value: ExtendInfo) => void>();
    const cf = fake("curseforge", 1); const nx = fake("nexus", 40);
    const source = createExtendedSource(cf, [nx], 15, info);
    const page = await source.search({ ...q, offset: 0 });
    expect(page.items.map((entry) => entry.source)).toContain("nexus");
    expect(page.items.filter((entry) => entry.source === "curseforge")).toHaveLength(1);
    expect(page.total).toBe(41);
    expect(page.hasMore).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ extended: true, primaryTotal: 1 }));
    expect(source.mixed).toBe(true);
    const next = await source.search({ ...q, offset: page.nextOffset });
    expect(next.items.every((entry) => entry.source === "nexus")).toBe(true);
    expect(cf.calls).toEqual([0]);
  });
  it("leaves a big primary alone and never refetches the decision", async () => {
    const cf = fake("curseforge", 100); const nx = fake("nexus", 40);
    const source = createExtendedSource(cf, [nx], 15);
    const page = await source.search({ ...q, offset: 0 });
    expect(page.items.every((entry) => entry.source === "curseforge")).toBe(true);
    await source.search({ ...q, offset: 30 });
    expect(nx.calls).toEqual([]);
    expect(source.mixed).toBe(false);
  });
  it("threshold 0 never extends", async () => {
    const nx = fake("nexus", 40);
    const page = await createExtendedSource(fake("curseforge", 1), [nx], 0).search({ ...q, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect(nx.calls).toEqual([]);
  });
  it("drops duplicates by name and author and survives a failing extra site", async () => {
    const cf = fake("curseforge", 1);
    const dup = { ...fake("nexus", 2), search: async () => ({ items: [item("nexus", 1, "CURSEFORGE 0", "curseforge"), item("nexus", 2)], total: 2, nextOffset: 2, hasMore: false }) } as ModSource;
    const page = await createExtendedSource(cf, [dup], 15).search({ ...q, offset: 0 });
    expect(page.items.map((entry) => entry.id)).toEqual(["0", "2"]);
    const info = vi.fn();
    const broken = createExtendedSource(fake("curseforge", 1), [fake("nexus", 5, true)], 15, info);
    const only = await broken.search({ ...q, offset: 0 });
    expect(only.items).toHaveLength(1);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({ failed: ["nexus"] }));
  });
  it("routes details to the site the item came from", async () => {
    const source = createExtendedSource(fake("curseforge", 1), [fake("nexus", 5)], 15);
    expect((await source.details(item("nexus", 1))).facts[0].label).toBe("nexus");
    expect((await source.details(item("curseforge", 1))).facts[0].label).toBe("curseforge");
  });
});
