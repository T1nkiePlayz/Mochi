// Pure: is a listed mod already in a Tofu, being downloaded, or out of date? No runtime imports.
import type { ModUpdateItem } from "./updates";

export type InstallState =
  | { kind: "none" }
  | { kind: "downloading"; /** 0..1 when the size is known. */ progress?: number }
  | { kind: "installed"; version?: string; enabled: boolean }
  | { kind: "update"; update: ModUpdateItem; version?: string };

type RecordLike = { source: string; projectId: string; version?: string; enabled?: boolean };
type DownloadLike = { tofuId: string; projectId?: string; provider: string; status: string; downloaded: number; total?: number; createdAt: number };

export type InstallIndex = { records: Map<string, RecordLike>; downloads: Map<string, DownloadLike>; updates: Map<string, ModUpdateItem> };

const key = (source: string, id: string) => `${source}:${id}`;

/** One lookup table per render: records of the Tofu, its downloads (newest per mod), its known updates. */
export function buildInstallIndex(tofuId: string, records: readonly RecordLike[], downloads: readonly DownloadLike[], updates: readonly ModUpdateItem[]): InstallIndex {
  const index: InstallIndex = { records: new Map(), downloads: new Map(), updates: new Map() };
  for (const record of records) if (record.projectId && record.source !== "manual") index.records.set(key(record.source, record.projectId), record);
  for (const download of downloads) {
    if (download.tofuId !== tofuId || !download.projectId) continue;
    const id = key(download.provider, download.projectId);
    const previous = index.downloads.get(id);
    if (!previous || previous.createdAt <= download.createdAt) index.downloads.set(id, download);
  }
  for (const update of updates) index.updates.set(key(update.record.source, update.record.projectId), update);
  return index;
}

/** Downloading wins (it is happening now), then an update, then installed; a finished download counts as installed until records catch up. */
export function installStateOf(index: InstallIndex, item: { source: string; id: string }): InstallState {
  const id = key(item.source, item.id);
  const download = index.downloads.get(id);
  if (download?.status === "downloading") return { kind: "downloading", progress: download.total ? Math.min(1, download.downloaded / download.total) : undefined };
  const record = index.records.get(id);
  const update = index.updates.get(id);
  if (update) return { kind: "update", update, version: record?.version };
  if (record) return { kind: "installed", version: record.version, enabled: record.enabled !== false };
  if (download?.status === "completed") return { kind: "installed", enabled: true };
  return { kind: "none" };
}
