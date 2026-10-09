import { describe, expect, it, vi } from "vitest";
import { MAX_DEPENDENCIES, pickDependencyFile, planNeedsConfirmation, resolveDependencies, installOrder, type InstalledRecord } from "./dependencies";
import type { ModDependency, ModFile, ModItem, ModSource, ResolvedDownload } from "./types";

type Spec = { name?: string; files?: Partial<ModFile>[]; deps?: Record<string, string[]>; resolved?: Partial<ResolvedDownload>; incompatibles?: string[]; fail?: "item" | "files" };
const dep = (id: string): ModDependency => ({ id, url: `https://site/${id}`, required: true });
const itemOf = (id: string, name = `Mod ${id}`): ModItem => ({ source: "modrinth", id, name, summary: "", pageUrl: `https://site/${id}`, native: {} });
const fileOf = (id: string, over: Partial<ModFile> = {}): ModFile => ({ id, name: `v${id}`, fileName: `${id}.jar`, version: id, gameVersions: ["1.20.1"], loaders: ["fabric"], date: "2025-01-01T00:00:00Z", native: {}, ...over });

/** A fake site: `specs[modId]` says what the mod's files, dependencies and download look like. `deps[fileId]` lists dependency mod ids. */
function fake(specs: Record<string, Spec>, extra: Partial<ModSource> = {}) {
  const calls = { items: [] as string[], files: [] as string[], active: 0, peak: 0 };
  const tick = async () => { calls.active += 1; calls.peak = Math.max(calls.peak, calls.active); await new Promise((resolve) => setTimeout(resolve, 2)); calls.active -= 1; };
  const source = {
    id: "modrinth", label: "Modrinth", siteUrl: "", sorts: [], defaultSort: "", searchesServerSide: true,
    categories: async () => [], search: async () => ({ items: [], total: 0, nextOffset: 0, hasMore: false }), details: async () => ({ body: null, facts: [] }),
    async dependencyItem(dependency: ModDependency) {
      calls.items.push(dependency.id); await tick();
      const spec = specs[dependency.id];
      if (!spec || spec.fail === "item") throw new Error("Not found");
      return itemOf(dependency.id, spec.name);
    },
    async files(item: ModItem) {
      calls.files.push(item.id); await tick();
      const spec = specs[item.id];
      if (spec?.fail === "files") throw new Error("Files down");
      return (spec?.files ?? [{}]).map((over, index) => fileOf(over.id ?? `${item.id}-f${index}`, { dependencies: (spec?.deps?.[over.id ?? `${item.id}-f${index}`] ?? spec?.deps?.["*"] ?? []).map(dep), incompatibles: (spec?.incompatibles ?? []).map(dep), ...over }));
    },
    async resolveDownload(item: ModItem, file: ModFile): Promise<ResolvedDownload> { return { url: `https://cdn/${file.id}`, fileName: file.fileName, pageUrl: item.pageUrl, ...(specs[item.id]?.resolved ?? {}) }; },
    ...extra,
  } as ModSource;
  return { source, calls };
}
const root = (deps: string[] = [], incompatibles: string[] = []) => ({ item: itemOf("root", "Root"), file: fileOf("root-f", { dependencies: deps.map(dep), incompatibles: incompatibles.map(dep) }) });
const base = { filter: { gameVersion: "1.20.1", loader: "fabric" }, target: { gameVersion: "1.20.1", loader: "fabric" as const }, records: [] as InstalledRecord[] };

describe("resolveDependencies", () => {
  it("finds nothing for a mod without dependencies", async () => {
    const { source } = fake({});
    const plan = await resolveDependencies({ source, ...root(), ...base });
    expect(plan.entries).toEqual([]);
    expect(planNeedsConfirmation(plan)).toBe(false);
  });

  it("follows required dependencies recursively and orders the deepest first for install", async () => {
    const { source } = fake({ a: { deps: { "*": ["b"] } }, b: { deps: { "*": ["c"] } }, c: {} });
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base });
    expect(plan.entries.map((entry) => [entry.item?.id, entry.depth, entry.status])).toEqual([["a", 1, "install"], ["b", 2, "install"], ["c", 3, "install"]]);
    expect(plan.entries[1].requiredBy).toBe("Mod a");
    expect(installOrder(plan.entries).map((entry) => entry.item?.id)).toEqual(["c", "b", "a"]);
    expect(planNeedsConfirmation(plan)).toBe(true);
  });

  it("ends a dependency cycle (including one through the mod itself) and lists each project once", async () => {
    const { source, calls } = fake({ a: { deps: { "*": ["b", "root"] } }, b: { deps: { "*": ["a"] } } });
    const plan = await resolveDependencies({ source, ...root(["a", "b"]), ...base });
    expect(plan.entries.map((entry) => entry.item?.id)).toEqual(["a", "b"]);
    expect(calls.items.filter((id) => id === "a")).toHaveLength(1);
  });

  it("stops at the depth cap and says so", async () => {
    const chain = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`m${index}`, { deps: { "*": [`m${index + 1}`] } }]));
    const { source } = fake({ ...chain, m12: {} });
    const plan = await resolveDependencies({ source, ...root(["m0"]), ...base, maxDepth: 4 });
    expect(plan.entries).toHaveLength(4);
    expect(plan.truncated).toBe(true);
  });

  it("stops at the dependency count cap", async () => {
    const ids = Array.from({ length: MAX_DEPENDENCIES + 10 }, (_, index) => `d${index}`);
    const { source } = fake(Object.fromEntries(ids.map((id) => [id, {}])));
    const plan = await resolveDependencies({ source, ...root(ids), ...base });
    expect(plan.entries).toHaveLength(MAX_DEPENDENCIES);
    expect(plan.truncated).toBe(true);
  });

  it("marks a dependency installed by project id without any lookup", async () => {
    const { source, calls } = fake({ a: {} });
    const records: InstalledRecord[] = [{ source: "modrinth", projectId: "a", title: "Mod A", version: "2.0" }];
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base, records });
    expect(plan.entries[0]).toMatchObject({ status: "already-installed", name: "Mod A", version: "2.0" });
    expect(calls.items).toEqual([]);
    expect(planNeedsConfirmation(plan)).toBe(true);
  });

  it("marks a dependency installed when the chosen file's hash is already in a record (even a manual one)", async () => {
    const { source } = fake({ a: { resolved: { sha1: "AB".repeat(20) } } });
    const records: InstalledRecord[] = [{ source: "manual", projectId: "", sha1: "ab".repeat(20) }];
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base, records });
    expect(plan.entries[0].status).toBe("already-installed");
  });

  it("treats a download in progress as installed", async () => {
    const { source } = fake({ a: {} });
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base, pending: new Set(["modrinth:a"]) });
    expect(plan.entries[0].status).toBe("already-installed");
  });

  it("picks a file that fits the game version and loader, and says unavailable when none does", async () => {
    const files = [
      { id: "new-forge", loaders: ["forge"], gameVersions: ["1.20.1"], date: "2025-05-01T00:00:00Z" },
      { id: "new-121", loaders: ["fabric"], gameVersions: ["1.21"], date: "2025-04-01T00:00:00Z" },
      { id: "old-ok", loaders: ["fabric"], gameVersions: ["1.20.1"], date: "2024-01-01T00:00:00Z" },
    ];
    const { source } = fake({ a: { files }, b: { files: files.slice(0, 2) } });
    const plan = await resolveDependencies({ source, ...root(["a", "b"]), ...base });
    expect(plan.entries[0]).toMatchObject({ status: "install", file: { id: "old-ok" } });
    expect(plan.entries[1]).toMatchObject({ status: "unavailable", reason: "No file fits fabric 1.20.1." });
    expect(plan.entries[1].pageUrl).toBe("https://site/b");
  });

  it("honours a pinned version", async () => {
    const { source } = fake({ a: { files: [{ id: "v2", date: "2025-02-01T00:00:00Z" }, { id: "v1", date: "2025-01-01T00:00:00Z" }] } });
    const pinned = { item: itemOf("root", "Root"), file: fileOf("r", { dependencies: [{ ...dep("a"), versionId: "v1" }] }) };
    const plan = await resolveDependencies({ source, ...pinned, ...base });
    expect(plan.entries[0].file?.id).toBe("v1");
  });

  it("makes a dependency whose distribution is disabled (or that needs a manual download) unavailable with its page", async () => {
    const { source } = fake({ a: { resolved: { restricted: true, reason: "Author disabled downloads", pageUrl: "https://cf/a" } }, b: { resolved: { url: undefined, needsPremium: true, pageUrl: "https://nexus/b" } } });
    const plan = await resolveDependencies({ source, ...root(["a", "b"]), ...base });
    expect(plan.entries[0]).toMatchObject({ status: "unavailable", reason: "Author disabled downloads", pageUrl: "https://cf/a" });
    expect(plan.entries[1]).toMatchObject({ status: "unavailable", pageUrl: "https://nexus/b" });
  });

  it("turns a failed lookup into an unavailable entry instead of failing the plan", async () => {
    const { source } = fake({ a: { fail: "item" }, b: { fail: "files" }, c: {} });
    const plan = await resolveDependencies({ source, ...root(["a", "b", "c"]), ...base });
    expect(plan.entries.map((entry) => entry.status)).toEqual(["unavailable", "unavailable", "install"]);
    expect(plan.entries[0].reason).toContain("Not found");
  });

  it("warns about an installed mod the file is incompatible with, once", async () => {
    const { source } = fake({ a: { incompatibles: ["bad"] } });
    const records: InstalledRecord[] = [{ source: "modrinth", projectId: "bad", title: "Bad Mod" }];
    const plan = await resolveDependencies({ source, ...root(["a"], ["bad", "absent"]), ...base, records });
    expect(plan.warnings.map((warning) => [warning.declaredBy, warning.installedTitle])).toEqual([["Root", "Bad Mod"], ["Mod a", "Bad Mod"]]);
    expect(planNeedsConfirmation(plan)).toBe(true);
  });

  it("asks only a few lookups at a time", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `d${index}`);
    const { source, calls } = fake(Object.fromEntries(ids.map((id) => [id, {}])));
    await resolveDependencies({ source, ...root(ids), ...base, concurrency: 3 });
    expect(calls.peak).toBeLessThanOrEqual(3);
    expect(calls.peak).toBeGreaterThan(1);
  });

  it("keeps external requirements as links and reads source-level requirements (Nexus)", async () => {
    const requirements = vi.fn(async (item: ModItem) => item.id === "root"
      ? { required: [{ id: "ext", name: "SKSE", url: "https://skse.silverlock.org", required: true, external: true }, dep("n1")] }
      : { required: [] });
    const { source } = fake({ n1: { name: "Nexus Lib" } }, { requirements });
    const plan = await resolveDependencies({ source, ...root(), ...base });
    expect(plan.entries.map((entry) => [entry.name, entry.status, entry.pageUrl])).toEqual([["SKSE", "external", "https://skse.silverlock.org"], ["Nexus Lib", "install", "https://site/n1"]]);
    expect(requirements).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
  });

  it("notes a failed requirements read instead of hiding it", async () => {
    const { source } = fake({}, { requirements: async () => { throw new Error("Nexus is down"); } });
    const plan = await resolveDependencies({ source, ...root(), ...base });
    expect(plan.notes[0]).toContain("Nexus is down");
    expect(planNeedsConfirmation(plan)).toBe(true);
  });

  it("treats every dependency as a link when the source cannot look mods up", async () => {
    const { source } = fake({}, { dependencyItem: undefined });
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base });
    expect(plan.entries[0].status).toBe("external");
  });

  it("stops looking once aborted", async () => {
    const { source, calls } = fake({ a: { deps: { "*": ["b"] } }, b: {} });
    const controller = new AbortController();
    controller.abort();
    const plan = await resolveDependencies({ source, ...root(["a"]), ...base, signal: controller.signal });
    expect(plan.entries).toEqual([]);
    expect(calls.items).toEqual([]);
  });
});

describe("pickDependencyFile", () => {
  it("prefers an exact fit to one that only may work, and releases to betas", () => {
    const files = [fileOf("maybe", { gameVersions: ["1.20.4"], date: "2025-09-01T00:00:00Z" }), fileOf("beta", { channel: "beta", date: "2025-08-01T00:00:00Z" }), fileOf("rel", { date: "2025-01-01T00:00:00Z" })];
    expect(pickDependencyFile(files, { gameVersion: "1.20.1", loader: "fabric" })?.id).toBe("rel");
    expect(pickDependencyFile([files[0]], { gameVersion: "1.20.1", loader: "fabric" })?.id).toBe("maybe");
  });
  it("takes the newest file when there is no target (games without versions)", () => {
    expect(pickDependencyFile([fileOf("old", { date: "2020-01-01T00:00:00Z" }), fileOf("new", { date: "2025-01-01T00:00:00Z" })])?.id).toBe("new");
  });
});
