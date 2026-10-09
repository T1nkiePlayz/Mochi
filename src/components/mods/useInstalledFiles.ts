import { useCallback, useEffect, useRef, useState } from "react";
import { listInstanceMods, type InstanceMod } from "../../lib/mods/instances";
import type { ContentFolder } from "../../lib/mods/targets";
import type { Tofu } from "../../models";
import { useApp } from "../../state/AppContext";

/**
 * The files in one folder of a Tofu, kept current: re-read when the folder changes and whenever a download for this Tofu finishes.
 * `error` is a readable message when the folder cannot be read.
 */
export function useInstalledFiles(tofu: Pick<Tofu, "id">, folder: ContentFolder | undefined) {
  const { downloads } = useApp();
  const [files, setFiles] = useState<InstanceMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ folder, tofuId: tofu.id });
  latest.current = { folder, tofuId: tofu.id };

  const refresh = useCallback(async () => {
    const wanted = latest.current.folder;
    if (!wanted) { setFiles([]); return; }
    setLoading(true);
    try {
      const next = await listInstanceMods(latest.current.tofuId, wanted.path, wanted.subdir);
      if (latest.current.folder === wanted) { setFiles(next); setError(""); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unable to read the Tofu folder."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [folder?.path, folder?.subdir, tofu.id, refresh]);

  const finished = downloads.filter((download) => download.tofuId === tofu.id && download.status === "completed").length;
  const finishedBefore = useRef(finished);
  useEffect(() => { if (finished !== finishedBefore.current) { finishedBefore.current = finished; void refresh(); } }, [finished, refresh]);
  const pending = downloads.filter((download) => download.tofuId === tofu.id && download.status === "downloading").length;

  return { files, loading, error, refresh, pending };
}
