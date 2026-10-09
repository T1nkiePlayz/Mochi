// Pure: turning a `.mochi/tofus.json` found in a game folder back into Tofus. No runtime imports.
import type { ModLoader, Tofu } from "../../models";
import type { ManifestMod, TofuManifest } from "./instances";

const LOADERS: readonly ModLoader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export type RestorePlan = { tofus: Tofu[]; records: Array<{ tofuId: string; mods: ManifestMod[] }>; activeTofuId?: string };

/**
 * The game's Tofus after restoring `manifest` onto `base` (the Tofu whose folder holds the file). A manifest Tofu with the
 * same id as an existing one updates it; the first other one takes over `base` (keeping its launch settings); the rest are
 * added. All restored Tofus work directly on the game folder: a separate store from another device is not here.
 * `takenIds` are Tofu ids used anywhere in the library, so a restored id never collides with another game's Tofu.
 */
export function planRestore(existing: readonly Tofu[], base: Tofu, manifest: TofuManifest, takenIds: ReadonlySet<string>, newId: () => string): RestorePlan {
  const tofus = existing.map((tofu) => ({ ...tofu }));
  const records: RestorePlan["records"] = [];
  const folders = { path: base.gameDir ?? base.path, gameDir: base.gameDir ?? base.path, contentRoot: base.contentRoot };
  let baseUsed = false;
  const baseInManifest = manifest.tofus.some((saved) => saved.id === base.id);
  let activeTofuId: string | undefined;
  for (const saved of manifest.tofus) {
    const loader = LOADERS.includes(saved.loader as ModLoader) ? (saved.loader as ModLoader) : undefined;
    const details = { name: saved.name || "Tofu", ...(saved.version ? { version: saved.version } : {}), ...(loader ? { loader } : {}) };
    let target = tofus.find((tofu) => tofu.id === saved.id);
    if (target) Object.assign(target, details, folders);
    else if (!baseUsed && !baseInManifest) {
      target = tofus.find((tofu) => tofu.id === base.id);
      if (target) Object.assign(target, details, folders);
    }
    if (target?.id === base.id) baseUsed = true;
    if (!target) {
      const id = takenIds.has(saved.id) ? newId() : saved.id;
      target = { id, version: "Local", runtime: "Native", mods: 0, status: "Ready", ...details, ...folders };
      tofus.push(target);
    }
    target.mods = saved.mods.filter((mod) => !mod.subdir).length;
    records.push({ tofuId: target.id, mods: saved.mods });
    if (saved.id === manifest.activeTofuId) activeTofuId = target.id;
  }
  return { tofus, records, activeTofuId };
}
