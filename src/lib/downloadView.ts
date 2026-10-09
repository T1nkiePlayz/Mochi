import type { DownloadEntry } from "./modrinth";
import { formatBytes } from "./format";

export const providerLabels: Record<DownloadEntry["provider"], string> = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" };

const kindLabels: Record<string, string> = { resourcepacks: "Resource pack", shaderpacks: "Shader" };
/** "Mod", "Resource pack" or "Shader", from where the file lands. */
export const downloadKind = (entry: Pick<DownloadEntry, "subdir">) => (entry.subdir && kindLabels[entry.subdir]) || "Mod";

export type DownloadRow = {
  /** 0-100, or null while the size is unknown. */
  percent: number | null;
  state: "active" | "done" | "failed" | "cancelled";
  detail: string;
  canCancel: boolean;
};

/** Everything the Downloads list shows for one entry, so the view only lays it out. */
export function describeDownload(entry: DownloadEntry): DownloadRow {
  const percent = entry.total ? Math.min(100, Math.round((entry.downloaded / entry.total) * 100)) : null;
  switch (entry.status) {
    case "failed": return { percent, state: "failed", detail: entry.error || "Failed", canCancel: false };
    case "cancelled": return { percent, state: "cancelled", detail: "Cancelled", canCancel: false };
    case "completed": return { percent: 100, state: "done", detail: `${entry.total ? `Completed · ${formatBytes(entry.total)}` : "Completed"} · added to ${entry.tofuName}`, canCancel: false };
    default: return {
      percent, state: "active", canCancel: true,
      detail: entry.total ? `${percent}% · ${formatBytes(entry.downloaded)} of ${formatBytes(entry.total)}` : `${formatBytes(entry.downloaded)} downloaded`,
    };
  }
}

export type DownloadGroup = { tofuId: string; tofuName: string; items: DownloadEntry[] };

/** Groups by Tofu, newest group first; within a group running downloads come first, then newest. */
export function groupDownloads(entries: readonly DownloadEntry[]): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.tofuId) ?? { tofuId: entry.tofuId, tofuName: entry.tofuName, items: [] };
    group.items.push(entry);
    groups.set(entry.tofuId, group);
  }
  const newest = (group: DownloadGroup) => Math.max(...group.items.map((item) => item.createdAt));
  for (const group of groups.values()) group.items.sort((a, b) => Number(b.status === "downloading") - Number(a.status === "downloading") || b.createdAt - a.createdAt);
  return [...groups.values()].sort((a, b) => newest(b) - newest(a));
}

export const hasFinished = (entries: readonly DownloadEntry[]) => entries.some((entry) => entry.status !== "downloading");
