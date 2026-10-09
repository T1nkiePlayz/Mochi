import { useCallback, useEffect, useState } from "react";
import { listSoundPacks, SOUND_PACKS_CHANGED, type SoundPackInfo } from "./packs";

/** Installed sound packs; refreshed whenever a pack is imported or removed anywhere in the app. */
export function useSoundPacks(): { packs: SoundPackInfo[]; loaded: boolean; refresh: () => void } {
  const [packs, setPacks] = useState<SoundPackInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    void listSoundPacks().then((list) => setPacks(Array.isArray(list) ? list : [])).catch(() => setPacks([])).finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(SOUND_PACKS_CHANGED, refresh);
    return () => window.removeEventListener(SOUND_PACKS_CHANGED, refresh);
  }, [refresh]);
  return { packs, loaded, refresh };
}
