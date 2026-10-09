import type { Piko, Tofu } from "../../models";
import { applyLocation, bestPick } from "./folders";
import { isMinecraftJava } from "./gameSupport";
import { detectModLocations, type ModLocation } from "./instances";

export type Detection = { best?: ModLocation; existing: ModLocation[] };

/** Where `piko` loads mods from, and the location Mochi would pick by itself (see `bestPick`). Never writes anything. */
export async function detectBestLocation(piko: Piko): Promise<Detection> {
  const minecraft = isMinecraftJava(piko);
  const found = await detectModLocations({ name: piko.name, installPath: piko.installPath, executablePath: piko.executablePath, minecraft });
  return { best: bestPick(found, minecraft), existing: found.filter((location) => location.exists) };
}

/**
 * The Tofu with a mod folder: as it is when it has one; otherwise the detected best location is applied (and saved through
 * `save`) so a download never has to ask. Resolves to null only when nothing was detected and the caller must ask the user.
 */
export async function ensureTofuFolder(piko: Piko, tofu: Tofu, save: (patch: Partial<Tofu>) => void): Promise<Tofu | null> {
  if (tofu.path) return tofu;
  try {
    const { best } = await detectBestLocation(piko);
    if (!best) return null;
    const patch = applyLocation(tofu, best);
    save(patch);
    return { ...tofu, ...patch };
  } catch { return null; }
}
