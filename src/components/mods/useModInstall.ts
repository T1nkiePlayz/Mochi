import { useCallback, useState } from "react";
import { installBest, installFile, NoCompatibleFileError, type InstallOutcome } from "../../lib/mods/install";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource } from "../../lib/mods/types";

export type InstallNotice = { tone: "ok" | "info" | "error"; message: string; pageUrl?: string; pageLabel?: string; /** Installs the newest file regardless of game version and loader. */ force?: () => void };

const siteName = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" } as const;
const pageLabel = (item: ModItem, reason: "restricted" | "premium") => reason === "premium" ? "Download on Nexus" : `Open on ${siteName[item.source]}`;

/** One place that turns "download this into that Tofu" into a notice the UI can show (success, error, or a manual-download fallback). */
export function useModInstall() {
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<InstallNotice | null>(null);

  const apply = useCallback((item: ModItem, outcome: InstallOutcome) => {
    if (outcome.kind === "queued") { setNotice({ tone: "ok", message: outcome.message }); return; }
    setNotice({ tone: "info", message: outcome.message, pageUrl: outcome.pageUrl, pageLabel: pageLabel(item, outcome.reason) });
  }, []);

  const run = useCallback(async (item: ModItem, job: () => Promise<InstallOutcome>, onNoMatch?: () => void) => {
    setBusyId(item.id);
    setNotice(null);
    try { apply(item, await job()); }
    catch (error) {
      if (error instanceof NoCompatibleFileError && onNoMatch) setNotice({ tone: "info", message: `${error.message} You can still install the newest file; it may not work with this Tofu.`, force: onNoMatch });
      else setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to queue this download." });
    }
    finally { setBusyId(""); }
  }, [apply]);

  const best = useCallback((source: ModSource, item: ModItem, tofu: Tofu, filter?: { gameVersion?: string; loader?: string }, force = false) => {
    const forced = () => void run(item, () => installBest(source, item, tofu, filter, undefined, true));
    return run(item, () => installBest(source, item, tofu, filter, undefined, force), force ? undefined : forced);
  }, [run]);
  const file = useCallback((source: ModSource, item: ModItem, modFile: ModFile, tofu: Tofu) => run(item, () => installFile(source, item, modFile, tofu)), [run]);
  return { busyId, notice, setNotice, installBest: best, installFile: file };
}
