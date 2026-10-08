import { useEffect, useState } from "react";
import { getModrinthGameVersionTags } from "../../lib/modrinth";
import { normalizeVersions, type GameVersion } from "../../lib/gameVersions";

/** Minecraft versions from Modrinth's tag list (disk-cached by the backend, so it also works offline). */
export function useGameVersions(): { versions: GameVersion[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ versions: GameVersion[]; loading: boolean; failed: boolean }>({ versions: [], loading: true, failed: false });
  useEffect(() => {
    let live = true;
    getModrinthGameVersionTags()
      .then((result) => { if (live) setState({ versions: normalizeVersions(result.data), loading: false, failed: false }); })
      .catch(() => { if (live) setState({ versions: [], loading: false, failed: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
