import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tofu } from "../../models";
import type { DependencyEntry } from "./dependencies";
import type { ModFile, ModItem, ModSource } from "./types";

const startModDownload = vi.fn(async (..._args: unknown[]) => "d");
vi.mock("../downloads", () => ({ startModDownload: (...args: unknown[]) => startModDownload(...args) }));
const { installWithDependencies, bundleNotice } = await import("./dependencyInstall");

const tofu = { id: "t1", name: "T", version: "1.20.1", runtime: "Native", mods: 0, status: "Ready", path: "/store", gameDir: "/store" } as Tofu;
const item = (id: string, kind = "Mods"): ModItem => ({ source: "modrinth", id, name: `Mod ${id}`, summary: "", pageUrl: `https://site/${id}`, kind, native: {} });
const file = (id: string): ModFile => ({ id, name: id, fileName: `${id}.jar`, native: {} });
const entry = (id: string, depth: number): DependencyEntry => ({ key: `modrinth:${id}`, status: "install", name: `Mod ${id}`, pageUrl: "", item: item(id), file: file(`f${id}`), requiredBy: "Root", depth });
const source = (resolve: (item: ModItem) => object): ModSource => ({ id: "modrinth", resolveDownload: async (it: ModItem, f: ModFile) => ({ fileName: f.fileName, pageUrl: it.pageUrl, ...resolve(it) }) } as unknown as ModSource);
const ok = (it: ModItem) => ({ url: `https://cdn/${it.id}`, sha1: "ab".repeat(20) });

beforeEach(() => startModDownload.mockClear());

describe("installWithDependencies", () => {
  it("queues the deepest dependency first and the mod last, each with its own record", async () => {
    const result = await installWithDependencies(source(ok), item("root"), file("fr"), tofu, [entry("a", 1), entry("b", 2)]);
    const calls = startModDownload.mock.calls.map((call) => call[0] as { itemName: string; sha1: string; record: { projectId: string } });
    expect(calls.map((call) => call.record.projectId)).toEqual(["b", "a", "root"]);
    expect(calls.every((call) => call.sha1 === "ab".repeat(20))).toBe(true);
    expect(result.queued).toEqual(["Mod b", "Mod a", "Mod root"]);
    expect(bundleNotice(result, item("root"), tofu)).toMatchObject({ tone: "ok", message: "Queued Mod root and 2 dependencies for T." });
  });

  it("reports a failing or manual dependency, still installs the rest and the mod", async () => {
    const result = await installWithDependencies(source((it) => it.id === "a" ? { restricted: true, reason: "no" } : it.id === "b" ? { url: undefined } : ok(it)), item("root"), file("fr"), tofu, [entry("a", 1), entry("b", 1), entry("c", 1)]);
    startModDownload.mockClear();
    expect(result.manual.map((entry) => entry.name).sort()).toEqual(["Mod a", "Mod b"]);
    expect(result.queued).toEqual(["Mod c", "Mod root"]);
    const notice = bundleNotice(result, item("root"), tofu);
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Download by hand: Mod a, Mod b");
    expect(notice.pageUrl).toBe("https://site/a");
  });

  it("surfaces a thrown error as a failed dependency, never silently", async () => {
    const throwing = { id: "modrinth", resolveDownload: async (it: ModItem) => { if (it.id === "a") throw new Error("boom"); return { url: "https://cdn/x", fileName: "x.jar", pageUrl: "" }; } } as unknown as ModSource;
    const result = await installWithDependencies(throwing, item("root"), file("fr"), tofu, [entry("a", 1)]);
    expect(result.failed).toEqual([{ name: "Mod a", message: "boom" }]);
    expect(bundleNotice(result, item("root"), tofu)).toMatchObject({ tone: "error" });
    expect(bundleNotice(result, item("root"), tofu).message).toContain("Failed: Mod a (boom)");
  });

  it("says so when the mod itself could not be queued", async () => {
    const result = await installWithDependencies(source((it) => it.id === "root" ? { restricted: true, reason: "Author disabled downloads" } : ok(it)), item("root"), file("fr"), tofu, [entry("a", 1)]);
    const notice = bundleNotice(result, item("root"), tofu);
    expect(notice.message).toContain("Mod root: Author disabled downloads 1 dependency was queued.");
    expect(notice.tone).toBe("info");
  });
});
