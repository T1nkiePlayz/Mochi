import { interleave } from "./autoExtend";
import type { EcosystemRef } from "./gameSupport";
import type { ModItem, ModPage, ModSearchOptions, ModSource } from "./types";

export type MixedChild = { game: string; source: ModSource; ecosystem: EcosystemRef };

type Cursor = { key: string; offsets: number[]; done: boolean[]; totals: number[] };

/**
 * One list across several games (Discover > All): every child contributes a few mods per page, taken in turn, so no game
 * crowds the others out and each item says which game and site it is from. A child that fails (offline, Nexus not connected)
 * is skipped; only when every child fails does the list fail. Details, files and downloads go to the item's own child.
 */
export function createMixedSource(children: MixedChild[]): ModSource {
  let cursor: Cursor | null = null;
  const childOf = (item: ModItem) => children.find((child) => child.game === item.game && child.source.id === item.source) ?? children.find((child) => child.source.id === item.source) ?? children[0];
  return {
    id: children[0]?.source.id ?? "curseforge", label: "all your games", siteUrl: "", sorts: [{ value: "popular", label: "Popular" }], defaultSort: "popular", searchesServerSide: true, mixed: true,
    async categories() { return []; },
    async search(options: ModSearchOptions): Promise<ModPage> {
      const key = JSON.stringify([options.query]);
      if (!cursor || cursor.key !== key || options.offset === 0) cursor = { key, offsets: children.map(() => 0), done: children.map(() => false), totals: children.map(() => 0) };
      const state = cursor;
      const perChild = Math.max(3, Math.ceil(options.limit / Math.max(1, children.length)));
      let failures = 0;
      let asked = 0;
      const pages = await Promise.all(children.map(async (child, index) => {
        if (state.done[index]) return null;
        asked += 1;
        try {
          return await child.source.search({ query: options.query, offset: state.offsets[index], limit: perChild, sort: child.source.defaultSort });
        } catch { failures += 1; state.done[index] = true; return null; }
      }));
      if (asked > 0 && failures === asked && state.offsets.every((offset) => offset === 0)) throw new Error("None of the mod sites could be reached.");
      pages.forEach((page, index) => {
        if (!page) return;
        state.offsets[index] = page.nextOffset; state.done[index] = !page.hasMore; state.totals[index] = page.total;
      });
      const lists = pages.map((page, index) => (page?.items ?? []).map((item) => ({ ...item, game: children[index].game, ecosystem: children[index].ecosystem })));
      const items = interleave(lists);
      return { items, total: state.totals.reduce((sum, value) => sum + value, 0), nextOffset: options.offset + Math.max(1, items.length), hasMore: state.done.some((done) => !done) };
    },
    details: (item) => childOf(item).source.details(item),
    files: (item, filter) => childOf(item).source.files(item, filter),
    resolveDownload: (item, file) => childOf(item).source.resolveDownload(item, file),
  };
}
