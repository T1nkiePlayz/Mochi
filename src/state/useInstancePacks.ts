import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";
import { isOnline } from "../lib/offline";
import { getModrinthProjectInfo } from "../lib/modrinth";
import { releaseOf } from "../lib/mods/gameVersion";
import { packApi } from "../lib/mods/packApi";
import { matchInstancePack, type PackSources } from "../lib/mods/packMatch";
import { linkPack, markChecked, packArtKey, patchInstance, tofusNeedingPackArt, tofusToMatch, withPackArt } from "../lib/mods/packLink";
import type { MinecraftPackHint } from "../lib/sources";
import { cacheArtworkUrl } from "./useMetadata";

type Params = { ready: boolean; library: Piko[]; setLibrary: (update: (current: Piko[]) => Piko[]) => void; sources: PackSources };

/**
 * Background modpack matching for Minecraft instances: once per instance, one at a time (the API calls are also limited to two at
 * once), only when online. Linked Modrinth packs lend their icon as the instance cover. Does nothing for hidden or already-checked instances.
 */
export function useInstancePacks({ ready, library, setLibrary, sources }: Params) {
  const busy = useRef(false);
  const tried = useRef(new Set<string>());
  const artTried = useRef(new Set<string>());
  const signature = library.find((piko) => piko.id === "minecraft")?.tofus.map((tofu) => `${tofu.id}:${tofu.pack?.projectId ?? ""}:${tofu.packCheckedAt ?? ""}:${tofu.artworkCacheKey ?? ""}`).join("|") ?? "";
  const latest = useRef(library);
  latest.current = library;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!ready || busy.current || !isOnline() || (!sources.modrinth && !sources.curseforge)) return;
    if (!tofusToMatch(library, tried.current).length && !tofusNeedingPackArt(library, artTried.current).length) return;
    busy.current = true;
    void (async () => {
      // Re-reads the newest library each round: the effect does not restart while this runs.
      for (let next = tofusToMatch(latest.current, tried.current)[0]; next && mounted.current; next = tofusToMatch(latest.current, tried.current)[0]) {
        const tofu = next;
        let hint: MinecraftPackHint | null = null;
        try { hint = await invoke<MinecraftPackHint | null>("read_minecraft_pack", { launchTarget: tofu.launchTarget }); } catch { /* the folder may be gone: match by name only */ }
        const { pack, failed } = await matchInstancePack(packApi, { name: tofu.name, gameVersion: releaseOf(tofu), loader: tofu.loader }, hint, sources);
        if (pack) setLibrary((current) => patchInstance(current, tofu.id, linkPack(pack)));
        else if (!failed) setLibrary((current) => patchInstance(current, tofu.id, markChecked(Date.now())));
        else tried.current.add(tofu.id); // a source was unreachable: try again next start, not in a loop now
      }
      for (let next = tofusNeedingPackArt(latest.current, artTried.current)[0]; next && mounted.current; next = tofusNeedingPackArt(latest.current, artTried.current)[0]) {
        const tofu = next;
        artTried.current.add(tofu.id);
        try {
          const project = await getModrinthProjectInfo(tofu.pack!.projectId);
          const key = packArtKey(tofu.id);
          if (project.icon_url && await cacheArtworkUrl(project.icon_url, key)) setLibrary((current) => patchInstance(current, tofu.id, withPackArt(project.icon_url!, key)));
        } catch { /* no icon this time */ }
      }
    })().finally(() => { busy.current = false; });
  }, [ready, signature, sources.modrinth, sources.curseforge]); // eslint-disable-line react-hooks/exhaustive-deps
}
