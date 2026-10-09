import { startModDownload } from "../downloads";
import { pickBestFile } from "./helpers";
import { contentFolder, contentKindOf, type ContentKind } from "./targets";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource, ResolvedDownload } from "./types";

export type InstallOutcome =
  | { kind: "queued"; message: string }
  /** Mochi may not (author or membership) or cannot download; the user can open `pageUrl` instead. */
  | { kind: "manual"; message: string; pageUrl: string; reason: "restricted" | "premium" };

const errorText = (error: unknown) => error instanceof Error ? error.message : typeof error === "string" ? error : "Unable to queue this download.";

/** No file of the mod fits the filter (game version / loader). The user may still install the newest file anyway. */
export class NoCompatibleFileError extends Error {
  constructor(message: string) { super(message); this.name = "NoCompatibleFileError"; }
}

/** Newest stable file, else newest of anything. */
export function defaultFile(files: ModFile[]): ModFile | undefined {
  const ranked = files.map((file) => ({ file, releaseType: file.channel === "release" || !file.channel ? 1 : file.channel === "beta" ? 2 : 3, fileDate: file.date }));
  return pickBestFile(ranked)?.file;
}

/** Resolve one file and hand it to the native downloader for `tofu`. Throws a readable Error on failure. */
export async function installFile(source: ModSource, item: ModItem, file: ModFile, tofu: Tofu, kind: ContentKind = contentKindOf(item.kind)): Promise<InstallOutcome> {
  const folder = contentFolder(tofu, kind);
  if (!folder) throw new Error("This Tofu does not have a folder yet.");
  let resolved: ResolvedDownload;
  try { resolved = await source.resolveDownload(item, file); } catch (error) { throw new Error(errorText(error)); }
  if (resolved.restricted) return { kind: "manual", reason: "restricted", message: resolved.reason ?? "The author disabled downloads outside this site.", pageUrl: resolved.pageUrl };
  if (resolved.needsPremium || !resolved.url) return { kind: "manual", reason: "premium", message: resolved.reason ?? "This file has to be downloaded on the site.", pageUrl: resolved.pageUrl };
  await startModDownload({
    provider: item.source, url: resolved.url, path: folder.path, subdir: folder.subdir, tofuId: tofu.id, tofuName: tofu.name, itemName: item.name,
    filename: resolved.fileName, sha1: resolved.sha1, extract: tofu.extractArchives === true,
    record: { source: source.id, projectId: item.id, fileId: file.id, version: file.version ?? file.name, title: item.name, iconUrl: item.iconUrl, fileDate: file.date },
  });
  return { kind: "queued", message: `Queued ${item.name} for ${tofu.name}.` };
}

/** Download the best file of a mod without asking which one (card buttons). */
export async function installBest(source: ModSource, item: ModItem, tofu: Tofu, filter?: { gameVersion?: string; loader?: string }, kind?: ContentKind, force = false): Promise<InstallOutcome> {
  // "Force install": ignore the game version and loader and take the newest file; never refused.
  const files = await source.files(item, force ? undefined : filter);
  const file = defaultFile(files);
  if (!file) {
    const filtered = !force && Boolean(filter?.gameVersion || filter?.loader);
    if (filtered) throw new NoCompatibleFileError(`No file of ${item.name} matches ${[filter?.loader, filter?.gameVersion].filter(Boolean).join(" ")}.`);
    throw new Error(`No file was found for ${item.name}.`);
  }
  return installFile(source, item, file, tofu, kind);
}
