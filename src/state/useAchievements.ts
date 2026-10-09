import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { achievements, buildFacts, countCollections, emptyFlags, evaluate, newlyMet, type AchievementFlags } from "../lib/achievements";
import { getSteamAchievementTotals, STEAM_ACHIEVEMENTS_CHANGED, summariseTotals } from "../lib/steamAchievements";
import { useControllerState } from "../controller/manager";
import { useBigPictureActive } from "../bigpicture/mode";
import { getPlaytimeHistory, type SessionRecord } from "../lib/stats";
import { readJson, writeJson } from "../lib/storage";
import { librarySignature, playtimeSignature } from "../lib/achievementSignature";
import { collectionsKeyFor } from "./useCollections";

const KEY = "mochi:achievements";
/** Fired on window whenever the stored achievements change (watcher, cloud merge, clear). */
export const ACHIEVEMENTS_CHANGED = "mochi-achievements-changed";
const CHANGED = ACHIEVEMENTS_CHANGED;

/** Bump when achievements are added: ones already earned are then unlocked silently once, not announced as a flood. */
const CATALOG_VERSION = 2;
/** More new unlocks than this in one go are announced as a single summary. */
const MAX_TOASTS = 3;
/** Evaluations triggered only by playtime refreshes run at most this often. */
const PLAYTIME_THROTTLE_MS = 30_000;

export type StoredAchievements = { unlocked: Record<string, number>; flags: AchievementFlags; seeded: boolean; catalog: number };

const emptyStored = (): StoredAchievements => ({ unlocked: {}, flags: emptyFlags(), seeded: false, catalog: CATALOG_VERSION });

export function readAchievements(): StoredAchievements {
  const raw = readJson<Partial<StoredAchievements>>(KEY, {});
  const base = emptyStored();
  return {
    unlocked: raw.unlocked && typeof raw.unlocked === "object" ? raw.unlocked : base.unlocked,
    flags: {
      ...base.flags, ...(raw.flags ?? {}),
      themes: Array.isArray(raw.flags?.themes) ? raw.flags!.themes : [],
      views: Array.isArray(raw.flags?.views) ? raw.flags!.views : [],
      steam: raw.flags?.steam && typeof raw.flags.steam === "object" && raw.flags.steam.known ? raw.flags.steam : undefined,
    },
    seeded: Boolean(raw.seeded),
    catalog: typeof raw.catalog === "number" ? raw.catalog : 0,
  };
}

export function writeAchievements(stored: StoredAchievements) {
  writeJson(KEY, stored);
  window.dispatchEvent(new Event(CHANGED));
}

/** Forgets every unlock and recorded flag. Achievements still earned unlock again quietly on the next check. */
export function clearLocalAchievements() {
  writeAchievements(emptyStored());
  window.dispatchEvent(new Event(CLEARED));
}
const CLEARED = "mochi-achievements-cleared";

/** Stored unlocks, refreshed whenever the watcher records a change. */
export function useStoredAchievements() {
  const [stored, setStored] = useState(readAchievements);
  useEffect(() => {
    const onChange = () => setStored(readAchievements());
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);
  return stored;
}

/**
 * App-wide: tracks local facts, unlocks achievements and announces NEW ones.
 * The first run unlocks everything already earned silently so an existing library does not flood with toasts.
 */
export function useAchievementWatcher() {
  const { lib, themeEngine, activeNav, playtime, notifications, storage } = useApp();
  const { notify } = notifications;
  const controller = useControllerState();
  const bigPicture = useBigPictureActive();
  const controllerSeen = controller.pads.length > 0 || controller.device === "controller";
  const [tick, setTick] = useState(0);
  const recompute = useCallback(() => setTick((value) => value + 1), []);
  // Loading Steam achievements for any game refreshes the Steam-based totals.
  useEffect(() => {
    window.addEventListener(STEAM_ACHIEVEMENTS_CHANGED, recompute);
    window.addEventListener(CLEARED, recompute);
    return () => { window.removeEventListener(STEAM_ACHIEVEMENTS_CHANGED, recompute); window.removeEventListener(CLEARED, recompute); };
  }, [recompute]);

  // Re-evaluate on these derived values rather than on the library/playtime objects, which change on unrelated edits.
  const libSig = useMemo(() => librarySignature(lib.library), [lib.library]);
  const playSig = useMemo(() => playtimeSignature(playtime), [playtime]);
  const latest = useRef({ lib, themeEngine, activeNav, storage });
  latest.current = { lib, themeEngine, activeNav, storage };
  const done = useRef({ key: "", tick: -1, at: 0, skipped: false });
  const structKey = `${libSig}|${themeEngine.theme}|${activeNav}|${storage.ownerKey}|${controllerSeen}|${bigPicture}`;
  // Evaluation is skipped while hidden; one run catches up when the window is visible again.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden && done.current.skipped) { done.current.skipped = false; recompute(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recompute]);

  useEffect(() => {
    let cancelled = false;
    // Only a playtime change since the last run is throttled; anything else keeps the short debounce.
    const immediate = structKey !== done.current.key || tick !== done.current.tick;
    const delay = immediate ? 800 : Math.max(800, done.current.at + PLAYTIME_THROTTLE_MS - Date.now());
    const timer = window.setTimeout(async () => {
      if (document.hidden) { done.current.skipped = true; return; }
      const { lib, themeEngine, activeNav, storage } = latest.current;
      const stored = readAchievements();
      const flags = { ...stored.flags, themes: [...stored.flags.themes] };
      if (themeEngine.theme && !flags.themes.includes(themeEngine.theme)) flags.themes.push(themeEngine.theme);
      if (activeNav === "Discover") flags.usedDiscover = true;
      if (!flags.views.includes(activeNav)) flags.views = [...flags.views, activeNav];
      if (controllerSeen) flags.controllerUsed = true;
      if (bigPicture) flags.bigPictureUsed = true;
      if (lib.library.some((piko) => piko.tofus.some((tofu) => tofu.mods > 0))) flags.installedMod = true;
      let records: SessionRecord[];
      try { records = await getPlaytimeHistory(); } catch { records = []; }
      const steam = summariseTotals(await getSteamAchievementTotals());
      if (cancelled) return;
      done.current = { key: structKey, tick, at: Date.now(), skipped: false };
      if (steam.known) flags.steam = steam;
      const collections = readJson<unknown>(collectionsKeyFor(storage.ownerKey), []);
      const progress = evaluate(buildFacts(records, lib.library, flags, countCollections(collections, lib.library)));
      const fresh = newlyMet(progress, stored.unlocked);
      const unlocked = { ...stored.unlocked };
      const at = Date.now();
      fresh.forEach((def) => { unlocked[def.id] = at; });
      const changed = fresh.length > 0 || !stored.seeded || stored.catalog !== CATALOG_VERSION || JSON.stringify(flags) !== JSON.stringify(stored.flags);
      if (!changed) return;
      writeAchievements({ unlocked, flags, seeded: true, catalog: CATALOG_VERSION });
      if (stored.seeded && stored.catalog === CATALOG_VERSION) {
        if (fresh.length > MAX_TOASTS) notify("Achievements unlocked", `${fresh.length} new achievements, including ${fresh[0].title}.`);
        else fresh.forEach((def) => notify("Achievement unlocked", `${def.title}: ${def.description}`));
      }
    }, delay);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [tick, structKey, playSig, notify, controllerSeen, bigPicture]);

  return { recompute, total: achievements.length };
}
