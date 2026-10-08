import { useCallback, useState } from "react";
import { installBest, installFile, type InstallOutcome } from "../../lib/mods/install";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource } from "../../lib/mods/types";

export type InstallNotice = { tone: "ok" | "info" | "error"; message: string; pageUrl?: string; pageLabel?: string };

const pageLabel = (source: ModSource, reason: "restricted" | "premium") =>
  reason === "premium" ? "Download on Nexus" : source.id === "curseforge" ? "Open on CurseForge" : `Open on ${source.label}`;

/** One place that turns "download this into that Tofu" into a notice the UI can show (success, error, or a manual-download fallback). */
export function useModInstall() {
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<InstallNotice | null>(null);

  const apply = useCallback((source: ModSource, outcome: InstallOutcome) => {
    if (outcome.kind === "queued") { setNotice({ tone: "ok", message: outcome.message }); return; }
    setNotice({ tone: "info", message: outcome.message, pageUrl: outcome.pageUrl, pageLabel: pageLabel(source, outcome.reason) });
  }, []);

  const run = useCallback(async (item: ModItem, job: () => Promise<InstallOutcome>, source: ModSource) => {
    setBusyId(item.id);
    setNotice(null);
    try { apply(source, await job()); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to queue this download." }); }
    finally { setBusyId(""); }
  }, [apply]);

  const best = useCallback((source: ModSource, item: ModItem, tofu: Tofu, filter?: { gameVersion?: string; loader?: string }) => run(item, () => installBest(source, item, tofu, filter), source), [run]);
  const file = useCallback((source: ModSource, item: ModItem, modFile: ModFile, tofu: Tofu) => run(item, () => installFile(source, item, modFile, tofu), source), [run]);
  return { busyId, notice, setNotice, installBest: best, installFile: file };
}
