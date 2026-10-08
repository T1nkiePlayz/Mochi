import { startModDownload } from "../downloads";
import { pickBestFile } from "./helpers";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource, ResolvedDownload } from "./types";

export type InstallOutcome =
  | { kind: "queued"; message: string }
  /** Mochi may not (author or membership) or cannot download; the user can open `pageUrl` instead. */
  | { kind: "manual"; message: string; pageUrl: string; reason: "restricted" | "premium" };

const errorText = (error: unknown) => error instanceof Error ? error.message : typeof error === "string" ? error : "Unable to queue this download.";

/** Newest stable file, else newest of anything. */
export function defaultFile(files: ModFile[]): ModFile | undefined {
  const ranked = files.map((file) => ({ file, releaseType: file.channel === "release" || !file.channel ? 1 : file.channel === "beta" ? 2 : 3, fileDate: file.date }));
  return pickBestFile(ranked)?.file;
}

/** Resolve one file and hand it to the native downloader for `tofu`. Throws a readable Error on failure. */
export async function installFile(source: ModSource, item: ModItem, file: ModFile, tofu: Tofu): Promise<InstallOutcome> {
  if (!tofu.path) throw new Error("This Tofu does not have a folder yet.");
  let resolved: ResolvedDownload;
  try { resolved = await source.resolveDownload(item, file); } catch (error) { throw new Error(errorText(error)); }
  if (resolved.restricted) return { kind: "manual", reason: "restricted", message: resolved.reason ?? "The author disabled downloads outside this site.", pageUrl: resolved.pageUrl };
  if (resolved.needsPremium || !resolved.url) return { kind: "manual", reason: "premium", message: resolved.reason ?? "This file has to be downloaded on the site.", pageUrl: resolved.pageUrl };
  await startModDownload({
    provider: source.id, url: resolved.url, path: tofu.path, tofuId: tofu.id, tofuName: tofu.name, itemName: item.name,
    filename: resolved.fileName, sha1: resolved.sha1, extract: tofu.extractArchives === true,
  });
  return { kind: "queued", message: `Queued ${item.name} for ${tofu.name}.` };
}

/** Download the best file of a mod without asking which one (card buttons). */
export async function installBest(source: ModSource, item: ModItem, tofu: Tofu, filter?: { gameVersion?: string; loader?: string }): Promise<InstallOutcome> {
  const files = await source.files(item, filter);
  const file = defaultFile(files);
  if (!file) throw new Error(`No ${filter?.gameVersion ? "compatible " : ""}file was found for ${item.name}.`);
  return installFile(source, item, file, tofu);
}
