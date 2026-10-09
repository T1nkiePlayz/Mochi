import { installFile, type InstallOutcome } from "./install";
import { installOrder, type DependencyEntry } from "./dependencies";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource } from "./types";

export type BundleResult = {
  /** Names handed to the downloader, dependencies first and the mod last. */
  queued: string[];
  /** Files the user has to download on the site (restricted by the author, or a free Nexus account). */
  manual: Array<{ name: string; pageUrl: string }>;
  failed: Array<{ name: string; message: string }>;
  /** What happened to the mod itself. */
  root: InstallOutcome | { kind: "failed"; message: string };
};

const errorText = (error: unknown) => error instanceof Error ? error.message : "Unable to queue this download.";

/**
 * Installs the chosen dependencies (deepest first, one at a time), then the mod, each through `installFile`: the same
 * folder rules, SHA-1 check and install record as a single download. A dependency that fails is reported and the rest
 * carries on; the mod is still installed so one bad dependency never loses the user's choice.
 */
export async function installWithDependencies(source: ModSource, item: ModItem, file: ModFile, tofu: Tofu, dependencies: readonly DependencyEntry[]): Promise<BundleResult> {
  const result: BundleResult = { queued: [], manual: [], failed: [], root: { kind: "failed", message: "" } };
  for (const entry of installOrder(dependencies)) {
    if (!entry.item || !entry.file) continue;
    try {
      const outcome = await installFile(source, entry.item, entry.file, tofu);
      if (outcome.kind === "queued") result.queued.push(entry.name);
      else result.manual.push({ name: entry.name, pageUrl: outcome.pageUrl });
    } catch (error) { result.failed.push({ name: entry.name, message: errorText(error) }); }
  }
  try {
    result.root = await installFile(source, item, file, tofu);
    if (result.root.kind === "queued") result.queued.push(item.name);
  } catch (error) { result.root = { kind: "failed", message: errorText(error) }; }
  return result;
}

export type BundleNotice = { tone: "ok" | "info" | "error"; message: string; pageUrl?: string; pageLabel?: string };

/** One message for the whole install: what was queued, and every dependency that was not (never silent). */
export function bundleNotice(result: BundleResult, item: ModItem, tofu: Pick<Tofu, "name">): BundleNotice {
  const deps = result.queued.filter((name) => name !== item.name).length;
  const parts: string[] = [];
  if (result.root.kind === "queued") parts.push(deps ? `Queued ${item.name} and ${deps} dependenc${deps === 1 ? "y" : "ies"} for ${tofu.name}.` : `Queued ${item.name} for ${tofu.name}.`);
  else if (result.root.kind === "manual") parts.push(`${item.name}: ${result.root.message}${deps ? ` ${deps} dependenc${deps === 1 ? "y was" : "ies were"} queued.` : ""}`);
  else parts.push(`${item.name} was not installed: ${result.root.message}${deps ? ` ${deps} dependenc${deps === 1 ? "y was" : "ies were"} queued.` : ""}`);
  if (result.failed.length) parts.push(`Failed: ${result.failed.map((entry) => `${entry.name} (${entry.message})`).join("; ")}.`);
  if (result.manual.length) parts.push(`Download by hand: ${result.manual.map((entry) => entry.name).join(", ")}.`);
  const page = result.root.kind === "manual" ? result.root.pageUrl : result.manual[0]?.pageUrl;
  const tone = result.root.kind === "failed" ? "error" : result.failed.length ? "error" : result.manual.length || result.root.kind === "manual" ? "info" : "ok";
  return { tone, message: parts.join(" "), ...(page ? { pageUrl: page, pageLabel: "Open page" } : {}) };
}
