// The impure side of the conflict check: reads the Tofu's file list (local disk and mods.json only, no network),
// and carries out the fix buttons. Network is used only when the user clicks "Install missing dependency".
import type { Piko, Tofu } from "../../models";
import { tofuTarget } from "./compat";
import { checkTofu, modPageUrl, sortIssues, type CheckEntry, type Issue, type IssueAction } from "./conflicts";
import { installBest } from "./install";
import { listInstanceMods, setInstanceModsEnabled } from "./instances";
import { createModrinthSource } from "./modrinthSource";
import { openExternalUrl } from "../platform";

/** The check must never delay a launch noticeably: after this the game starts without it. */
export const PRE_LAUNCH_CHECK_TIMEOUT_MS = 1500;

const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout")), ms);
  work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

/** Checks one Tofu from what is on disk. Resolves to no issues when there is nothing to read; never throws. */
export async function checkTofuMods(piko: Pick<Piko, "tofus">, tofu: Tofu, timeoutMs = PRE_LAUNCH_CHECK_TIMEOUT_MS): Promise<Issue[]> {
  if (!tofu.path) return [];
  try {
    const siblings = piko.tofus.length > 1 ? piko.tofus.map((other) => other.id) : undefined;
    const files: CheckEntry[] = await withTimeout(listInstanceMods(tofu.id, tofu.path, undefined, siblings), timeoutMs);
    return sortIssues(checkTofu(files, tofu));
  } catch { return []; }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.");

/** Runs one fix button. Returns a short message for the user; failures are returned, not thrown. */
export async function applyIssueAction(action: IssueAction, tofu: Tofu): Promise<string> {
  try {
    switch (action.kind) {
      case "disable":
      case "enable": {
        const result = await setInstanceModsEnabled(tofu.id, action.paths, action.kind === "enable");
        return result.failed.length ? `Could not change ${result.failed.length} file${result.failed.length === 1 ? "" : "s"}.` : action.kind === "enable" ? "Switched on." : "Switched off.";
      }
      case "open-page": {
        const url = modPageUrl(action.source, action.projectId);
        if (url) await openExternalUrl(url);
        return url ? "Opened the mod page." : "This mod has no page Mochi can open.";
      }
      case "install-dependency": {
        if (action.source !== "modrinth") {
          const url = modPageUrl(action.source, action.projectId);
          if (url) await openExternalUrl(url);
          return url ? "Opened the mod page; install it from there." : "Search for this mod in Discover to install it.";
        }
        const source = createModrinthSource("mod");
        const item = await source.dependencyItem!({ id: action.projectId, url: "", required: true });
        if (!item) return "That mod could not be found on Modrinth.";
        const target = tofuTarget(tofu);
        const outcome = await installBest(source, item, tofu, { gameVersion: target.gameVersion, loader: target.loader });
        return outcome.message;
      }
    }
  } catch (error) { return errorText(error); }
}
