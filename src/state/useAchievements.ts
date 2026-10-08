import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { buildFacts, countCollections, evaluate, newlyMet, achievements, type AchievementFlags } from "../lib/achievements";
import { getPlaytimeHistory } from "../lib/stats";
import { readJson, storageKeys, writeJson } from "../lib/storage";

const KEY = "mochi:achievements";
const CHANGED = "mochi-achievements-changed";

export type StoredAchievements = { unlocked: Record<string, number>; flags: AchievementFlags; seeded: boolean };

const emptyStored = (): StoredAchievements => ({ unlocked: {}, flags: { themes: [], usedDiscover: false, installedMod: false }, seeded: false });

export function readAchievements(): StoredAchievements {
  const raw = readJson<Partial<StoredAchievements>>(KEY, {});
  const base = emptyStored();
  return {
    unlocked: raw.unlocked && typeof raw.unlocked === "object" ? raw.unlocked : base.unlocked,
    flags: { ...base.flags, ...(raw.flags ?? {}), themes: Array.isArray(raw.flags?.themes) ? raw.flags!.themes : [] },
    seeded: Boolean(raw.seeded),
  };
}

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
  const { lib, themeEngine, activeNav, playtime, notifications } = useApp();
  const { notify } = notifications;
  const [tick, setTick] = useState(0);
  const recompute = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const stored = readAchievements();
      const flags = { ...stored.flags, themes: [...stored.flags.themes] };
      if (themeEngine.theme && !flags.themes.includes(themeEngine.theme)) flags.themes.push(themeEngine.theme);
      if (activeNav === "Discover") flags.usedDiscover = true;
      if (lib.library.some((piko) => piko.tofus.some((tofu) => tofu.mods > 0))) flags.installedMod = true;
      let records;
      try { records = await getPlaytimeHistory(); } catch { records = []; }
      if (cancelled) return;
      const collections = readJson<unknown>(storageKeys.collections, []);
      const progress = evaluate(buildFacts(records, lib.library, flags, countCollections(collections, lib.library)));
      const fresh = newlyMet(progress, stored.unlocked);
      const unlocked = { ...stored.unlocked };
      const at = Date.now();
      fresh.forEach((def) => { unlocked[def.id] = at; });
      const changed = fresh.length > 0 || !stored.seeded || JSON.stringify(flags) !== JSON.stringify(stored.flags);
      if (!changed) return;
      writeJson(KEY, { unlocked, flags, seeded: true });
      window.dispatchEvent(new Event(CHANGED));
      if (stored.seeded) fresh.forEach((def) => notify("Achievement unlocked", `${def.title}: ${def.description}`));
    }, 800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [tick, lib.library, themeEngine.theme, activeNav, playtime, notify]);

  return { recompute, total: achievements.length };
}
