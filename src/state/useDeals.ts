import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Piko } from "../models";
import { useOnline } from "../lib/offline";
import { CHECK_INTERVAL_MS, RETRY_MS, activeStores, detectStores, fetchDeals, fetchEpicFreeGames, getPriceInfo, readDealsState, readStoreChoices, runDealsCheck, watchQuery, watchedItems, writeDealsState, writeStoreChoices, type Deal, type EpicFreeGame, type StoreChoices, type StoreId } from "../lib/deals";
import { historyKey, observationsFromPrices, recordObservations } from "../lib/gameSearch";
import { readWishlist, updateWishlistItem } from "../lib/wishlist";

type Notify = (title: string, message: string, opts?: { group?: string; item?: string }) => void;
export type DealsStatus = "idle" | "checking" | "ok" | "offline" | "error";
export type DealsController = {
  enabled: boolean; status: DealsStatus; message: string; checkedAt: number;
  epic: EpicFreeGame[]; deals: Deal[]; stores: StoreId[]; detected: StoreId[];
  setStore: (store: StoreId, on: boolean) => void; refresh: () => void;
};

/**
 * Deal alerts (experimental). Checks at most every 6 hours while enabled and online (the check itself is throttled
 * natively), once shortly after start-up when the last check is older than that. Nothing runs when disabled.
 */
export function useDeals(enabled: boolean, library: Piko[], notify: Notify): DealsController {
  const online = useOnline();
  const detectedKey = useMemo(() => detectStores(library).join(","), [library]);
  const detected = useMemo(() => (detectedKey ? detectedKey.split(",") : []) as StoreId[], [detectedKey]);
  const [choices, setChoices] = useState<StoreChoices>(readStoreChoices);
  const stores = useMemo(() => activeStores(detected, choices), [detected, choices]);
  const [state, setState] = useState({ status: "idle" as DealsStatus, message: "", checkedAt: readDealsState().checkedAt, epic: [] as EpicFreeGame[], deals: [] as Deal[] });
  const live = useRef({ enabled, online, notify, stores });
  live.current = { enabled, online, notify, stores };
  const running = useRef(false);

  /** Resolves true when the check completed (so the next one can wait the full interval). */
  const check = useCallback(async (): Promise<boolean> => {
    const { stores: wanted } = live.current;
    if (running.current || !live.current.enabled || !live.current.online) return false;
    running.current = true;
    setState((current) => ({ ...current, status: "checking", message: "" }));
    try {
      const now = Date.now();
      const stored = readDealsState();
      const result = await runDealsCheck({
        stores: wanted, now, seen: stored.seen, epic: fetchEpicFreeGames, deals: fetchDeals, watches: watchedItems(readWishlist()),
        price: async (item) => {
          const info = await getPriceInfo(watchQuery(item));
          // Watched games feed the local price history shown by game search.
          if (info) recordObservations(historyKey({ name: item.name, steamAppId: item.source === "steam" ? Number(item.externalId) : null }), observationsFromPrices({ steam: null, shark: info }, now));
          return info?.cheapestNow ?? null;
        },
        shouldStop: () => !live.current.enabled || !live.current.online,
      });
      for (const update of result.watchUpdates) updateWishlistItem(update.id, { priceWatch: update.priceWatch });
      // A failed check keeps its old timestamp so it is retried at the next opportunity.
      const failed = result.offline || Boolean(result.error);
      writeDealsState({ checkedAt: failed ? stored.checkedAt : now, seen: result.seen });
      for (const alert of [...result.alerts, ...result.watchAlerts]) live.current.notify(alert.title, alert.message, { group: "deals", item: alert.item });
      setState({ status: result.offline ? "offline" : result.error ? "error" : "ok", message: result.error ?? "", checkedAt: failed ? stored.checkedAt : now, epic: result.epic, deals: result.deals });
      return !failed;
    } finally { running.current = false; }
  }, []);

  useEffect(() => {
    if (!enabled || !online) return;
    let timer: ReturnType<typeof setTimeout>;
    // First look 8 s after start-up when due, otherwise wait out the rest of the interval; a failed check retries in 30 minutes.
    const schedule = (delay: number) => { timer = setTimeout(() => { void check().then((ok) => schedule(ok ? CHECK_INTERVAL_MS : RETRY_MS)); }, delay); };
    const due = readDealsState().checkedAt + CHECK_INTERVAL_MS - Date.now();
    schedule(due <= 0 ? 8000 : due);
    return () => clearTimeout(timer);
  }, [enabled, online, check]);

  const setStore = useCallback((store: StoreId, on: boolean) => setChoices((current) => { const next = { ...current, [store]: on }; writeStoreChoices(next); return next; }), []);
  const refresh = useCallback(() => { void check(); }, [check]);
  return { enabled, ...state, stores, detected, setStore, refresh };
}
