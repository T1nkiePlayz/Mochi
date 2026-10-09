import { useCallback, useState } from "react";
import { defaultFile, installBest, installFile, NoCompatibleFileError, type InstallOutcome } from "../../lib/mods/install";
import { parseLoader } from "../../lib/mods/compat";
import { planNeedsConfirmation, resolveDependencies, type DependencyEntry, type DependencyPlan } from "../../lib/mods/dependencies";
import { bundleNotice, installWithDependencies } from "../../lib/mods/dependencyInstall";
import { listInstanceRecords } from "../../lib/mods/instances";
import { useApp } from "../../state/AppContext";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource } from "../../lib/mods/types";

type Filter = { gameVersion?: string; loader?: string };
/** The dependency sheet waiting for an answer: the chosen entries, an empty list for "without dependencies", or null for Cancel. */
export type DependencyPrompt = { item: ModItem; file: ModFile; tofu: Tofu; plan: DependencyPlan; answer: (entries: DependencyEntry[] | null) => void };

export type InstallNotice = { tone: "ok" | "info" | "error"; message: string; pageUrl?: string; pageLabel?: string; /** Installs the newest file regardless of game version and loader. */ force?: () => void; /** A free Nexus account: explain "Mod Manager Download" (nxm://). */ nexusManager?: boolean };

const siteName = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" } as const;
const pageLabel = (item: ModItem, reason: "restricted" | "premium") => reason === "premium" ? "Download on Nexus" : `Open on ${siteName[item.source]}`;

/** One place that turns "download this into that Tofu" into a notice the UI can show (success, error, or a manual-download fallback). */
export function useModInstall() {
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState<InstallNotice | null>(null);
  const [prompt, setPrompt] = useState<DependencyPrompt | null>(null);
  const { downloads } = useApp();

  const apply = useCallback((item: ModItem, outcome: InstallOutcome) => {
    if (outcome.kind === "queued") { setNotice({ tone: "ok", message: outcome.message }); return; }
    setNotice({ tone: "info", message: outcome.message, pageUrl: outcome.pageUrl, pageLabel: pageLabel(item, outcome.reason), nexusManager: item.source === "nexus" && outcome.reason === "premium" });
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

  /** The dependency flow: look up what the file needs, ask when there is anything to say, install the chosen ones first, then the mod. */
  const withDependencies = useCallback(async (source: ModSource, item: ModItem, modFile: ModFile | undefined, tofu: Tofu, filter?: Filter) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      const chosen = modFile ?? defaultFile(await source.files(item, filter));
      // No file fits: installBest throws the usual "no compatible file" error with its "Install anyway" action.
      if (!chosen) { apply(item, await installBest(source, item, tofu, filter)); return; }
      const pending = new Set(downloads.filter((entry) => entry.tofuId === tofu.id && entry.status === "downloading" && entry.projectId).map((entry) => `${entry.provider}:${entry.projectId}`));
      const narrowed = Boolean(filter?.gameVersion || filter?.loader);
      let plan: DependencyPlan;
      try {
        const records = await listInstanceRecords(tofu.id);
        plan = await resolveDependencies({ source, item, file: chosen, records, pending, filter, target: narrowed ? { gameVersion: filter?.gameVersion, loader: parseLoader(filter?.loader) } : undefined });
      } catch (error) { plan = { entries: [], warnings: [], notes: [`Could not check dependencies: ${error instanceof Error ? error.message : "lookup failed"}.`], truncated: false }; }
      let chosenDeps: DependencyEntry[] | null = [];
      if (planNeedsConfirmation(plan)) {
        setBusyId("");
        chosenDeps = await new Promise<DependencyEntry[] | null>((resolve) => setPrompt({ item, file: chosen, tofu, plan, answer: (entries) => { setPrompt(null); resolve(entries); } }));
        if (chosenDeps === null) return;
        setBusyId(item.id);
      }
      if (chosenDeps.length === 0) { apply(item, await installFile(source, item, chosen, tofu)); return; }
      const result = await installWithDependencies(source, item, chosen, tofu, chosenDeps);
      setNotice(bundleNotice(result, item, tofu));
    } catch (error) {
      if (error instanceof NoCompatibleFileError) setNotice({ tone: "info", message: `${error.message} You can still install the newest file; it may not work with this Tofu.`, force: () => void run(item, () => installBest(source, item, tofu, filter, undefined, true)) });
      else setNotice({ tone: "error", message: error instanceof Error ? error.message : "Unable to queue this download." });
    } finally { setBusyId(""); }
  }, [apply, run, downloads]);

  const best = useCallback((source: ModSource, item: ModItem, tofu: Tofu, filter?: Filter, force = false) => {
    // "Install anyway" skips the game-version filter and the dependency check: the user chose to override.
    if (force) return run(item, () => installBest(source, item, tofu, filter, undefined, true));
    return withDependencies(source, item, undefined, tofu, filter);
  }, [run, withDependencies]);
  const file = useCallback((source: ModSource, item: ModItem, modFile: ModFile, tofu: Tofu, filter?: Filter, force = false) =>
    force ? run(item, () => installFile(source, item, modFile, tofu)) : withDependencies(source, item, modFile, tofu, filter), [run, withDependencies]);
  return { busyId, notice, setNotice, prompt, installBest: best, installFile: file };
}
