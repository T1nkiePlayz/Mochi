import { describe, expect, it, vi } from "vitest";
import { createChangelogLoader, createLimiter, linkChangelog } from "./updateChangelog";
import type { ModUpdateItem } from "./updates";

const item = (source: ModUpdateItem["source"], fileId: string, over: Partial<ModUpdateItem> = {}): ModUpdateItem => ({
  path: `/m/${fileId}.jar`, filename: `${fileId}.jar`, title: fileId, source, enabled: true, currentVersion: "1", newVersion: "2",
  record: { source, projectId: "p", fileId }, apply: { kind: "download", provider: source, url: "https://x/y.jar", filename: "y.jar" }, ...over,
});

describe("createLimiter", () => {
  it("never runs more than the limit at once", async () => {
    const run = createLimiter(3);
    let active = 0; let peak = 0;
    const task = () => run(async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; });
    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBe(3);
  });
  it("keeps going after a failing task", async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(run(async () => 5)).resolves.toBe(5);
  });
});

describe("changelog loader", () => {
  it("fetches each Modrinth file once and limits concurrency to 3", async () => {
    let active = 0; let peak = 0;
    const fetcher = vi.fn(async (id: string) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return `notes ${id}`; });
    const loader = createChangelogLoader(fetcher);
    const items = Array.from({ length: 8 }, (_, index) => item("modrinth", `v${index}`));
    const first = await Promise.all(items.map((entry) => loader.load(entry)));
    await Promise.all(items.map((entry) => loader.load(entry)));
    expect(first[0]).toEqual({ kind: "markdown", text: "notes v0" });
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("does not remember failures", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("ok");
    const loader = createChangelogLoader(fetcher);
    await expect(loader.load(item("modrinth", "a"))).rejects.toThrow("down");
    await expect(loader.load(item("modrinth", "a"))).resolves.toEqual({ kind: "markdown", text: "ok" });
  });
  it("falls back to the page link for an empty Modrinth changelog", async () => {
    const loader = createChangelogLoader(async () => "  ");
    expect(await loader.load(item("modrinth", "a", { pageUrl: "https://modrinth.com/project/p" }))).toEqual({ kind: "link", url: "https://modrinth.com/project/p", label: "Changelog on Modrinth" });
  });
  it("CurseForge and Nexus only link and never fetch or persist anything", async () => {
    const fetcher = vi.fn();
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const loader = createChangelogLoader(fetcher);
    expect(await loader.load(item("curseforge", "c"))).toEqual({ kind: "link", url: "https://www.curseforge.com/projects/p", label: "Changelog on CurseForge" });
    expect(await loader.load(item("nexus", "n", { pageUrl: "https://www.nexusmods.com/g/mods/1" }))).toMatchObject({ kind: "link", label: "Changelog on Nexus Mods" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(loader.size()).toBe(0);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
  it("has nothing to show for a Nexus update without a page", () => { expect(linkChangelog(item("nexus", "n"))).toEqual({ kind: "none" }); });
});
