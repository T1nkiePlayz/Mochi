import { useCallback, useEffect, useRef, useState } from "react";
import type { ModItem, ModSearchOptions, ModSource } from "../../lib/mods/types";

const PAGE_SIZE = 30;
/** Hard ceiling so a long session cannot grow the DOM without bound. */
const MAX_ITEMS = 600;

export type ModFeedQuery = Omit<ModSearchOptions, "offset" | "limit">;

export type ModFeed = {
  items: ModItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  /** The failure looks like a connectivity problem. */
  offline: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

type State = Pick<ModFeed, "items" | "total" | "loading" | "loadingMore" | "error" | "offline">;
const initial: State = { items: [], total: 0, loading: true, loadingMore: false, error: "", offline: false };
const looksOffline = (error: unknown) => (error as { kind?: string })?.kind === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false);

/**
 * Paged, de-duplicated feed over any `ModSource`. Results live only in React state (CurseForge data must not
 * be persisted). Changing the source or query discards in-flight responses.
 */
export function useModFeed(source: ModSource | null, query: ModFeedQuery, enabled = true): ModFeed {
  const [state, setState] = useState<State>(initial);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const seen = useRef(new Set<string>());
  const cursor = useRef({ items: [] as ModItem[], offset: 0, done: false });
  const [reload, setReload] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const key = JSON.stringify([source?.id, source?.siteUrl, query.query, query.sort, query.categoryId ?? "", query.gameVersion ?? "", query.loader ?? ""]);

  const fetchPage = useCallback(async (gen: number) => {
    const active = sourceRef.current;
    if (!active || inFlight.current) return;
    inFlight.current = true;
    try {
      const page = await active.search({ ...queryRef.current, offset: cursor.current.offset, limit: PAGE_SIZE });
      if (gen !== generation.current) return;
      const fresh = page.items.filter((item) => !seen.current.has(`${item.source}:${item.id}`));
      fresh.forEach((item) => seen.current.add(`${item.source}:${item.id}`));
      const items = [...cursor.current.items, ...fresh];
      const done = !page.hasMore || items.length >= MAX_ITEMS;
      cursor.current = { items, offset: page.nextOffset, done };
      setState({ items, total: page.total, loading: false, loadingMore: false, error: "", offline: false });
    } catch (error) {
      if (gen === generation.current) setState((previous) => ({ ...previous, loading: false, loadingMore: false, offline: looksOffline(error), error: error instanceof Error ? error.message : "Unable to load mods." }));
    } finally { if (gen === generation.current) inFlight.current = false; }
  }, []);

  useEffect(() => {
    generation.current += 1;
    if (!enabled || !source) return;
    const gen = generation.current;
    inFlight.current = false;
    seen.current = new Set();
    cursor.current = { items: [], offset: 0, done: false };
    setState(initial);
    const timer = window.setTimeout(() => void fetchPage(gen), 250);
    return () => window.clearTimeout(timer);
  }, [key, enabled, reload, fetchPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (cursor.current.done || inFlight.current) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    void fetchPage(generation.current);
  }, [fetchPage]);
  const retry = useCallback(() => {
    if (cursor.current.items.length > 0 && !cursor.current.done) { setState((previous) => ({ ...previous, error: "", loadingMore: true })); void fetchPage(generation.current); }
    else setReload((value) => value + 1);
  }, [fetchPage]);
  return { ...state, hasMore: !cursor.current.done && !state.error && state.items.length > 0, loadMore, retry };
}
