import { extendNote, interleave, modDedupeKey, shouldAutoExtend } from "./autoExtend";
import type { ModItem, ModPage, ModSearchOptions, ModSource } from "./types";

export type ExtendInfo = {
  /** Other sites were added. */
  extended: boolean;
  primaryTotal: number;
  /** Labels of the sites that were added (or tried). */
  extras: string[];
  /** Sites that failed to answer (their mods are missing from the list). */
  failed: string[];
  /** The sentence shown under the tab. */
  note: string;
};

type Cursor = { key: string; primary: number; primaryDone: boolean; extra: number[]; extraDone: boolean[]; totals: number[]; primaryTotal: number; emitted: Set<string> };

const optionsKey = (options: ModSearchOptions) => JSON.stringify([options.query, options.sort, options.categoryId ?? "", options.gameVersion ?? "", options.loader ?? ""]);

/**
 * The primary site's list, plus the other sites' mods when the primary lists fewer than `below` mods in total
 * (decided once, on the first page; scrolling never re-evaluates). Items keep their own `source` so details, files and
 * downloads go to the right site, and duplicates (same name and author) are dropped. A failing extra site never fails the list.
 */
export function createExtendedSource(primary: ModSource, extras: ModSource[], below: number, onInfo?: (info: ExtendInfo) => void): ModSource {
  const sources = new Map<string, ModSource>([[primary.id, primary], ...extras.map((source) => [source.id, source] as [string, ModSource])]);
  const pick = (item: ModItem) => sources.get(item.source) ?? primary;
  let decided: boolean | null = null;
  let cursor: Cursor | null = null;
  const failed = new Set<string>();
  let primaryTotal = 0;
  let reported = 0;
  const emit = () => onInfo?.({
    extended: decided === true, primaryTotal, extras: extras.map((source) => source.label), failed: [...failed],
    note: decided === true ? extendNote(primary.label, primaryTotal, extras.map((source) => source.label)) : "",
  });

  const extraOptions = (source: ModSource, options: ModSearchOptions, offset: number): ModSearchOptions =>
    ({ ...options, offset, sort: source.sorts.some((sort) => sort.value === options.sort) ? options.sort : source.defaultSort, categoryId: undefined, gameVersion: undefined, loader: undefined });

  return {
    id: primary.id, label: primary.label, siteUrl: primary.siteUrl, sorts: primary.sorts, defaultSort: primary.defaultSort,
    get searchesServerSide() { return decided === true ? false : primary.searchesServerSide; },
    get mixed() { return decided === true; },
    categories: () => primary.categories(),
    async search(options: ModSearchOptions): Promise<ModPage> {
      if (decided === false) return primary.search(options);
      const key = optionsKey(options);
      let first: ModPage | null = null;
      if (decided === null) {
        first = await primary.search(options);
        decided = extras.length > 0 && shouldAutoExtend(first.total, below);
        primaryTotal = first.total;
        emit();
        if (!decided) return first;
      }
      if (!cursor || cursor.key !== key || options.offset === 0) cursor = { key, primary: 0, primaryDone: false, extra: extras.map(() => 0), extraDone: extras.map(() => false), totals: extras.map(() => 0), primaryTotal: 0, emitted: new Set() };
      const state = cursor;
      const primaryTask = state.primaryDone ? Promise.resolve<ModPage | null>(null) : state.primary === 0 && first ? Promise.resolve(first) : primary.search({ ...options, offset: state.primary });
      const extraTasks = extras.map((source, index) => state.extraDone[index] ? Promise.resolve<ModPage | null>(null) : source.search(extraOptions(source, options, state.extra[index])).catch(() => { failed.add(source.label); return null; }));
      const [primaryPage, ...extraPages] = await Promise.all([primaryTask, ...extraTasks]);
      if (primaryPage) { state.primary = primaryPage.nextOffset; state.primaryDone = !primaryPage.hasMore; state.primaryTotal = primaryPage.total; }
      extraPages.forEach((page, index) => {
        if (page === null) { state.extraDone[index] = true; return; }
        state.extra[index] = page.nextOffset; state.extraDone[index] = !page.hasMore; state.totals[index] = page.total;
      });
      const lists = [primaryPage?.items ?? [], ...extraPages.map((page) => page?.items ?? [])];
      const items: ModItem[] = [];
      for (const item of interleave(lists)) { const id = modDedupeKey(item); if (!state.emitted.has(id)) { state.emitted.add(id); items.push(item); } }
      if (failed.size !== reported) { reported = failed.size; emit(); }
      const total = state.primaryTotal + state.totals.reduce((sum, value) => sum + value, 0);
      return { items, total: Math.max(total, items.length), nextOffset: options.offset + Math.max(1, items.length), hasMore: !state.primaryDone || state.extraDone.some((done) => !done) };
    },
    details: (item) => pick(item).details(item),
    files: (item, filter) => pick(item).files(item, pick(item) === primary ? filter : undefined),
    resolveDownload: (item, file) => pick(item).resolveDownload(item, file),
  };
}
