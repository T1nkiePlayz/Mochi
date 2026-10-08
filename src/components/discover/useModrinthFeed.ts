import { useCallback, useEffect, useRef, useState } from "react";
import { searchDiscover, type DiscoverQuery, type ModrinthProject } from "../../lib/modrinth";

const PAGE_SIZE = 30;
/** The first view is filled to roughly this many projects (a page at a time), then only scrolling loads more. */
const DEFAULT_TARGET = 90;
/** Hard ceiling so a very long session cannot grow the list without bound. */
const MAX_ITEMS = 600;

export type Feed = {
  items: ModrinthProject[];
  total: number;
  /** First page in flight (or filters just changed). */
  loading: boolean;
  loadingMore: boolean;
  error: string;
  /** Results came from the offline cache. */
  offline: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

type State = Pick<Feed, "items" | "total" | "loading" | "loadingMore" | "error" | "offline">;
const initial: State = { items: [], total: 0, loading: true, loadingMore: false, error: "", offline: false };

/**
 * Paged, de-duplicated Modrinth feed. Changing `query` discards in-flight responses;
 * the list refills to ~90 results page by page, then grows only through `loadMore`.
 */
export function useModrinthFeed(query: DiscoverQuery, enabled = true, fillTarget = DEFAULT_TARGET): Feed {
  const pageSize = Math.min(PAGE_SIZE, fillTarget);
  const [state, setState] = useState<State>(initial);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const seen = useRef(new Set<string>());
  const current = useRef({ items: [] as ModrinthProject[], total: 0, offset: 0, done: false });
  const [reloadToken, setReloadToken] = useState(0);
  const key = JSON.stringify([fillTarget, query.projectType, query.gameVersion ?? "", query.loader ?? "", query.query ?? "", query.sort ?? "downloads"]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const fetchPage = useCallback(async (gen: number, fill: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // Fills sequentially: one request at a time, never a burst.
      for (;;) {
        const offset = current.current.offset;
        const page = await searchDiscover({ ...queryRef.current, offset, limit: pageSize });
        if (gen !== generation.current) return;
        const fresh = page.hits.filter((hit) => !seen.current.has(hit.project_id));
        fresh.forEach((hit) => seen.current.add(hit.project_id));
        const items = [...current.current.items, ...fresh];
        const consumed = offset + page.hits.length;
        const done = page.hits.length === 0 || consumed >= page.total || items.length >= MAX_ITEMS;
        current.current = { items, total: page.total, offset: consumed, done };
        setState((previous) => ({ ...previous, items, total: page.total, loading: false, loadingMore: !done && fill && items.length < fillTarget, error: "", offline: page.stale }));
        if (!fill || done || items.length >= fillTarget) return;
      }
    } catch (error) {
      if (gen === generation.current) setState((previous) => ({ ...previous, loading: false, loadingMore: false, error: error instanceof Error ? error.message : "Unable to load Modrinth projects." }));
    } finally {
      inFlight.current = false;
      if (gen === generation.current) setState((previous) => previous.loadingMore ? { ...previous, loadingMore: false } : previous);
    }
  }, [pageSize, fillTarget]);

  useEffect(() => {
    if (!enabled) return;
    generation.current += 1;
    const gen = generation.current;
    inFlight.current = false;
    seen.current = new Set();
    current.current = { items: [], total: 0, offset: 0, done: false };
    setState(initial);
    // Debounce so typing or flicking through filters issues one request.
    const timer = window.setTimeout(() => void fetchPage(gen, true), 250);
    return () => window.clearTimeout(timer);
  }, [key, enabled, reloadToken, fetchPage]);

  const loadMore = useCallback(() => {
    if (current.current.done || inFlight.current) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    void fetchPage(generation.current, false);
  }, [fetchPage]);

  const retry = useCallback(() => {
    if (current.current.items.length > 0 && !current.current.done) {
      setState((previous) => ({ ...previous, error: "", loadingMore: true }));
      void fetchPage(generation.current, false);
    } else setReloadToken((value) => value + 1);
  }, [fetchPage]);
  const hasMore = !current.current.done && state.items.length < Math.max(state.total, 1) && !state.error;
  return { ...state, hasMore, loadMore, retry };
}
