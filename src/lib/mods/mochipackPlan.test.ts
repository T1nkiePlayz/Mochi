import { describe, expect, it } from "vitest";
import type { PackMod } from "./mochipack";
import { availabilityFromResolved, buildReport, compatibilityNotes, downloadable, gameMismatch, planImport, queueDownloads, splitInstalled, summarizePlan } from "./mochipackPlan";
import type { ResolvedDownload } from "./types";

const mod = (n: number, extra: Partial<PackMod> = {}): PackMod => ({ provider: "modrinth", projectId: `P${n}`, fileId: `F${n}`, fileName: `m${n}.jar`, folder: "mods", enabled: true, ...extra });
const sha = (c: string) => c.repeat(40);

describe("availabilityFromResolved", () => {
  it("is ready with a url and uses the provider's file name", () => {
    expect(availabilityFromResolved(mod(1), { url: "https://cdn.modrinth.com/x", fileName: "real.jar", sha1: sha("a"), pageUrl: "p" })).toEqual({ status: "ready", url: "https://cdn.modrinth.com/x", fileName: "real.jar", sha1: sha("a") });
  });
  it("maps CurseForge allowModDistribution false / null downloadUrl (restricted) to manual with the page link", () => {
    const resolved: ResolvedDownload = { fileName: "a.jar", restricted: true, reason: "Only on CurseForge", pageUrl: "https://www.curseforge.com/minecraft/mc-mods/x" };
    expect(availabilityFromResolved(mod(1, { provider: "curseforge" }), resolved)).toEqual({ status: "manual", reason: "Only on CurseForge", pageUrl: resolved.pageUrl });
  });
  it("maps Nexus without Premium or without a url to manual", () => {
    expect(availabilityFromResolved(mod(1, { provider: "nexus" }), { fileName: "a", needsPremium: true, pageUrl: "https://nexusmods.com/x" }).status).toBe("manual");
    expect(availabilityFromResolved(mod(1), { fileName: "a", pageUrl: "p" }).status).toBe("manual");
  });
  it("refuses a file whose SHA-1 differs from the pack's, accepts a match (any case) or a missing hash", () => {
    const resolved = { url: "https://x", fileName: "a.jar", sha1: sha("b"), pageUrl: "p" };
    expect(availabilityFromResolved(mod(1, { sha1: sha("a") }), resolved).status).toBe("changed");
    expect(availabilityFromResolved(mod(1, { sha1: sha("b") }), { ...resolved, sha1: sha("B") }).status).toBe("ready");
    expect(availabilityFromResolved(mod(1), resolved)).toMatchObject({ status: "ready", sha1: sha("b") });
    expect(availabilityFromResolved(mod(1, { sha1: sha("a") }), { ...resolved, sha1: undefined })).toMatchObject({ status: "ready", sha1: sha("a") });
  });
});

describe("planImport", () => {
  const ok: ResolvedDownload = { url: "https://cdn.modrinth.com/x", fileName: "x.jar", pageUrl: "p" };
  it("keeps the pack order, turns missing files and lookup errors into unavailable, and never throws", async () => {
    const items = await planImport([mod(1), mod(2), mod(3), mod(4)], async (m) => { if (m.projectId === "P2") return null; if (m.projectId === "P3") throw new Error("offline"); return ok; }, { concurrency: 2 });
    expect(items.map((item) => item.mod.projectId)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(items.map((item) => item.availability.status)).toEqual(["ready", "unavailable", "unavailable", "ready"]);
    expect(items[2].availability).toMatchObject({ reason: "offline" });
  });
  it("bounds concurrency and reports progress", async () => {
    let running = 0; let peak = 0; const seen: number[] = [];
    await planImport(Array.from({ length: 12 }, (_, i) => mod(i)), async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 2)); running -= 1; return ok; }, { concurrency: 3, onProgress: (done) => seen.push(done) });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.at(-1)).toBe(12);
  });
  it("stops when aborted", async () => {
    const signal = { aborted: false };
    let calls = 0;
    await planImport(Array.from({ length: 20 }, (_, i) => mod(i)), async () => { calls += 1; if (calls === 3) signal.aborted = true; return ok; }, { concurrency: 1, signal });
    expect(calls).toBe(3);
  });
  it("handles an empty pack", async () => expect(await planImport([], async () => ok)).toEqual([]));
});

describe("summaries and selection", () => {
  it("counts by status and skips mods that were off in the pack unless asked", async () => {
    const ok: ResolvedDownload = { url: "https://x", fileName: "x.jar", pageUrl: "p" };
    const items = await planImport([mod(1), mod(2, { enabled: false }), mod(3), mod(4)], async (m) => (m.projectId === "P3" ? { fileName: "a", restricted: true, pageUrl: "p" } : m.projectId === "P4" ? null : ok));
    expect(summarizePlan(items, false)).toEqual({ ready: 1, manual: 1, unavailable: 1, changed: 0, skippedDisabled: 1 });
    expect(summarizePlan(items, true)).toMatchObject({ ready: 2, skippedDisabled: 0 });
    expect(downloadable(items, false).map((item) => item.mod.projectId)).toEqual(["P1"]);
    expect(downloadable(items, true)).toHaveLength(2);
    const report = buildReport(items, 1, [], 3);
    expect(report).toMatchObject({ queued: 1, unknownFiles: 3 });
    expect(report.manual).toHaveLength(1);
    expect(report.unavailable).toHaveLength(1);
  });
});

describe("splitInstalled", () => {
  it("separates mods the Tofu already has by provider, project and file", () => {
    const { todo, installed } = splitInstalled([mod(1), mod(2), mod(3, { provider: "curseforge", projectId: "1", fileId: "2" })], [{ source: "modrinth", projectId: "P1", fileId: "F1" }, { source: "modrinth", projectId: "P2", fileId: "OLD" }, { source: "curseforge", projectId: "1", fileId: "2" }]);
    expect(installed.map((m) => m.projectId)).toEqual(["P1", "1"]);
    expect(todo.map((m) => m.projectId)).toEqual(["P2"]);
  });
});

describe("queueDownloads", () => {
  it("collects failures without stopping the others", async () => {
    const items = await planImport([mod(1), mod(2), mod(3)], async () => ({ url: "https://x", fileName: "x.jar", pageUrl: "p" }));
    const started: string[] = [];
    const result = await queueDownloads(items, async (item) => { if (item.mod.projectId === "P2") throw new Error("no folder"); started.push(item.mod.projectId); }, 2);
    expect(result.queued).toBe(2);
    expect(result.failed).toEqual([{ item: items[1], error: "no folder" }]);
    expect(started.sort()).toEqual(["P1", "P3"]);
  });
});

describe("gameMismatch and compatibilityNotes", () => {
  const mc = { name: "Minecraft", igdbId: 121 };
  const skyrim = { name: "Skyrim", modLinks: { nexus: { domain: "skyrim", name: "Skyrim" }, source: "user" as const } };
  it("keeps Minecraft packs on Minecraft: Java", () => {
    expect(gameMismatch({ game: { name: "Minecraft", minecraft: true } }, mc)).toBeNull();
    expect(gameMismatch({ game: { name: "Minecraft", minecraft: true } }, skyrim)).toMatch(/not Minecraft/);
    expect(gameMismatch({ game: { name: "Skyrim", minecraft: false } }, mc)).toMatch(/not Minecraft/);
  });
  it("matches other games by linked Nexus domain or CurseForge game id", () => {
    expect(gameMismatch({ game: { name: "Skyrim", nexusDomain: "skyrim" } }, skyrim)).toBeNull();
    expect(gameMismatch({ game: { name: "Fallout", nexusDomain: "fallout4" } }, skyrim)).toMatch(/different Nexus/);
    expect(gameMismatch({ game: { name: "X", cfGameId: 5 } }, { name: "Y", modLinks: { curseforge: { gameId: 6, slug: "y", name: "Y" }, source: "user" } })).toMatch(/different CurseForge/);
  });
  it("warns about loader and version differences for Minecraft only", () => {
    expect(compatibilityNotes({ loader: "fabric", gameVersion: "1.21.1" }, { loader: "forge", version: "1.20.1" }, true)).toHaveLength(2);
    expect(compatibilityNotes({ loader: "fabric", gameVersion: "1.21.1" }, { loader: "fabric", version: "1.21.1" }, true)).toEqual([]);
    expect(compatibilityNotes({ loader: "fabric", gameVersion: "1.21.1" }, { loader: "forge", version: "1.20.1" }, false)).toEqual([]);
  });
});
