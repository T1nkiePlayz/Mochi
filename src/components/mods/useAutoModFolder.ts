import { useEffect, useState } from "react";
import { applyLocation, autoPick } from "../../lib/mods/folders";
import { detectModLocations, type ModLocation } from "../../lib/mods/instances";
import { isMinecraftJava } from "../../lib/mods/gameSupport";
import type { Piko, Tofu } from "../../models";

/** Tofus already looked at this session, so opening a game page never repeats the scan. */
const scanned = new Set<string>();

export type AutoFolder = { tofuId?: string; state: "idle" | "scanning" | "applied" | "choose" | "missing"; applied?: ModLocation; candidates: ModLocation[] };

/**
 * A Tofu with no folder yet: find where the game loads mods. Exactly one existing folder is used right away (the Tofu then works on it
 * directly, like the launcher shows it); several are offered to pick from; none leaves the user to choose a folder.
 */
export function useAutoModFolder(piko: Piko, tofu: Tofu, onUpdate: (patch: Partial<Tofu>) => void): AutoFolder {
  const [result, setResult] = useState<AutoFolder>({ state: "idle", candidates: [] });
  const needs = !tofu.path && !tofu.gameDir;
  useEffect(() => {
    if (!needs || scanned.has(tofu.id)) return;
    scanned.add(tofu.id);
    let live = true;
    setResult({ tofuId: tofu.id, state: "scanning", candidates: [] });
    void (async () => {
      try {
        const found = await detectModLocations({ name: piko.name, installPath: piko.installPath, executablePath: piko.executablePath, minecraft: isMinecraftJava(piko) });
        if (!live) return;
        const existing = found.filter((location) => location.exists);
        const only = autoPick(found);
        if (only) {
          // Reported before the Tofu changes: applying the folder re-runs this effect's cleanup.
          setResult({ tofuId: tofu.id, state: "applied", applied: only, candidates: found });
          onUpdate(applyLocation(tofu, only));
        } else setResult({ tofuId: tofu.id, state: existing.length ? "choose" : "missing", candidates: existing });
      } catch { if (live) setResult({ tofuId: tofu.id, state: "missing", candidates: [] }); }
    })();
    return () => { live = false; scanned.delete(tofu.id); };
  }, [needs, tofu.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return result.tofuId === tofu.id ? result : { state: "idle", candidates: [] };
}
