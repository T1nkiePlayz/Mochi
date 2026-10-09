import { useEffect, useRef } from "react";
import { applyLocation } from "../../lib/mods/folders";
import { detectBestLocation } from "../../lib/mods/autoFolder";
import { modSupportOf } from "../../lib/mods/gameSupport";
import { readTofuManifest, restoreInstanceRecords, writeTofuManifest } from "../../lib/mods/instances";
import { planRestore } from "../../lib/mods/manifest";
import { scanTofuMods } from "../../lib/mods/scanService";
import { manifestRequestFor } from "../../lib/mods/targets";
import { isOnline } from "../../lib/offline";
import { supabase } from "../../lib/supabase";
import type { Piko, Tofu } from "../../models";
import { useApp } from "../../state/AppContext";

const START_DELAY_MS = 4000;
const newId = () => `tofu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A game whose default Tofu was never looked at (a fresh import, or a library from before this feature), or one whose scan ran offline. */
export function wantsScan(piko: Piko, online: boolean): boolean {
  if (modSupportOf(piko) === "none") return false;
  const scan = piko.tofus[0]?.modScan;
  return !scan || (!scan.identified && online);
}

/**
 * After a game is imported: find its mod folder and select it on the default Tofu, restore Tofus saved in the folder's
 * `.mochi/tofus.json`, or else read the mods already there into the default Tofu and identify them on Modrinth, CurseForge
 * and Nexus Mods. One game at a time, in the background, once per game (again only when it ran offline).
 */
export function useModImportScan() {
  const { lib, behavior, credentials } = useApp();
  const libraryRef = useRef(lib.library);
  libraryRef.current = lib.library;
  const settingsRef = useRef({ sources: behavior.modSources, nexusKey: credentials.status.nexus && Boolean(supabase) });
  settingsRef.current = { sources: behavior.modSources, nexusKey: credentials.status.nexus && Boolean(supabase) };
  const running = useRef(false);
  const done = useRef(new Set<string>());
  const pendingKey = lib.library.filter((piko) => wantsScan(piko, isOnline()) && !done.current.has(piko.id)).map((piko) => piko.id).join(",");

  useEffect(() => {
    if (!pendingKey || running.current) return;
    const timer = window.setTimeout(() => {
      running.current = true;
      void (async () => {
        try {
          for (const id of pendingKey.split(",")) {
            const piko = libraryRef.current.find((item) => item.id === id);
            done.current.add(id);
            if (!piko || !piko.tofus[0]) continue;
            try { await scanGame(piko); } catch (error) { console.warn("Mochi mod scan failed", piko.name, error); }
          }
        } finally { running.current = false; }
      })();
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Writes changes into the live library entry (the user may have edited the game meanwhile). */
  const patchTofus = (gameId: string, update: (tofus: Tofu[]) => Tofu[]) =>
    lib.setLibrary((current) => current.map((item) => (item.id === gameId ? { ...item, tofus: update(item.tofus) } : item)));

  const scanGame = async (piko: Piko) => {
    let base = piko.tofus[0];
    const mark = (identified: boolean) => patchTofus(piko.id, (tofus) => tofus.map((tofu, index) => (index === 0 ? { ...tofu, modScan: { at: Date.now(), identified } } : tofu)));
    if (!base.path && !base.gameDir) {
      const { best } = await detectBestLocation(piko).catch(() => ({ best: undefined }));
      if (!best) { mark(true); return; }
      const patch = applyLocation(base, best);
      base = { ...base, ...patch };
      patchTofus(piko.id, (tofus) => tofus.map((tofu) => (tofu.id === base.id ? { ...tofu, ...patch } : tofu)));
    }
    const gameDir = base.gameDir ?? base.path;
    const manifest = gameDir && !base.modScan ? await readTofuManifest(gameDir).catch(() => null) : null;
    if (manifest?.tofus.length) {
      const taken = new Set(libraryRef.current.flatMap((item) => (item.id === piko.id ? [] : item.tofus.map((tofu) => tofu.id))).concat(base.id));
      const current = libraryRef.current.find((item) => item.id === piko.id)?.tofus ?? piko.tofus;
      const plan = planRestore(current.map((tofu) => (tofu.id === base.id ? base : tofu)), base, manifest, taken, newId);
      for (const entry of plan.records) await restoreInstanceRecords(entry.tofuId, entry.mods).catch(() => 0);
      patchTofus(piko.id, () => plan.tofus.map((tofu, index) => (index === 0 ? { ...tofu, modScan: { at: Date.now(), identified: true } } : tofu)));
      return;
    }
    const { sources, nexusKey } = settingsRef.current;
    const result = await scanTofuMods({ ...piko, tofus: [base, ...piko.tofus.slice(1)] }, base, sources, nexusKey);
    patchTofus(piko.id, (tofus) => tofus.map((tofu, index) => (index === 0 ? { ...tofu, mods: result.modFiles || tofu.mods, modScan: { at: Date.now(), identified: result.online } } : tofu)));
    const request = manifestRequestFor(base, [base, ...piko.tofus.slice(1)]);
    if (request && result.files) await writeTofuManifest(request).catch(() => undefined);
  };
}
