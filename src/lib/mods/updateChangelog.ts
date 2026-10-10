// Lazy, memory-only changelog lookup for the Updates tab. Nothing here is written to disk (CurseForge terms).
import type { ModUpdateItem } from "./updates";
import { getModrinthVersion } from "../modrinth";

export type Changelog = { kind: "markdown"; text: string } | { kind: "link"; url: string; label: string } | { kind: "none" };

export const CHANGELOG_CONCURRENCY = 3;

/** Runs tasks at most `max` at a time, in the order they were queued. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => { while (active < max && queue.length) { active += 1; queue.shift()!(); } };
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    queue.push(() => { task().then(resolve, reject).finally(() => { active -= 1; pump(); }); });
    pump();
  });
}

const siteName = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" } as const;

/** The no-network answer for sources without a keyless changelog (CurseForge has no proxy route for it, Nexus none without a key). */
export function linkChangelog(item: Pick<ModUpdateItem, "source" | "pageUrl" | "record">): Changelog {
  const url = item.pageUrl || (item.source === "curseforge" ? `https://www.curseforge.com/projects/${item.record.projectId}` : "");
  return url ? { kind: "link", url, label: `Changelog on ${siteName[item.source]}` } : { kind: "none" };
}

const keyOf = (item: Pick<ModUpdateItem, "source" | "record">) => `${item.source}:${item.record.projectId}:${item.record.fileId}`;

/**
 * Memoised changelog loader: one request per file however often it is asked for, `limit` at a time, failures are not
 * remembered (so reopening retries). `fetchModrinth` returns the version's markdown changelog.
 */
export function createChangelogLoader(fetchModrinth: (versionId: string) => Promise<string | null | undefined>, limit = CHANGELOG_CONCURRENCY) {
  const run = createLimiter(limit);
  const memo = new Map<string, Promise<Changelog>>();
  return {
    load(item: ModUpdateItem): Promise<Changelog> {
      if (item.source !== "modrinth") return Promise.resolve(linkChangelog(item));
      const key = keyOf(item);
      let hit = memo.get(key);
      if (!hit) {
        hit = run(() => fetchModrinth(item.record.fileId)).then((text): Changelog => text?.trim() ? { kind: "markdown", text } : linkChangelog(item));
        hit.catch(() => memo.delete(key));
        memo.set(key, hit);
      }
      return hit;
    },
    size: () => memo.size,
  };
}

let shared: ReturnType<typeof createChangelogLoader> | undefined;
/** The app-wide loader (created on first use; the Modrinth client loads on demand). */
export const loadChangelog = (item: ModUpdateItem) => (shared ??= createChangelogLoader(async (id) => getModrinthVersion(id).then((version) => version.changelog))).load(item);
