import { useEffect, useState } from "react";
import { applyLocation } from "../../lib/mods/folders";
import { detectBestLocation } from "../../lib/mods/autoFolder";
import type { ModLocation } from "../../lib/mods/instances";
import type { Piko, Tofu } from "../../models";

/** Tofus already looked at this session, so opening a game page never repeats the scan. */
const scanned = new Set<string>();

export type AutoFolder = { tofuId?: string; state: "idle" | "scanning" | "applied" | "missing"; applied?: ModLocation; /** Other existing places mods could go. */ others: number };

/**
 * A Tofu with no folder yet: find where the game loads mods and use the best one right away (saved on the Tofu, which then works
 * on it directly). Several candidates are ranked (`bestPick`); the user can change the choice in "Mod folders". Nothing found
 * leaves the user to choose a folder.
 */
export function useAutoModFolder(piko: Piko, tofu: Tofu, onUpdate: (patch: Partial<Tofu>) => void): AutoFolder {
  const [result, setResult] = useState<AutoFolder>({ state: "idle", others: 0 });
  const needs = !tofu.path && !tofu.gameDir;
  useEffect(() => {
    if (!needs || scanned.has(tofu.id)) return;
    scanned.add(tofu.id);
    let live = true;
    setResult({ tofuId: tofu.id, state: "scanning", others: 0 });
    void (async () => {
      try {
        const { best, existing } = await detectBestLocation(piko);
        if (!live) return;
        if (best) {
          // Reported before the Tofu changes: applying the folder re-runs this effect's cleanup.
          setResult({ tofuId: tofu.id, state: "applied", applied: best, others: existing.length - 1 });
          onUpdate(applyLocation(tofu, best));
        } else setResult({ tofuId: tofu.id, state: "missing", others: 0 });
      } catch { if (live) setResult({ tofuId: tofu.id, state: "missing", others: 0 }); }
    })();
    return () => { live = false; scanned.delete(tofu.id); };
  }, [needs, tofu.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return result.tofuId === tofu.id ? result : { state: "idle", others: 0 };
}
