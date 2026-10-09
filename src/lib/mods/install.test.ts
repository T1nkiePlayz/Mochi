import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tofu } from "../../models";
import type { ModFile, ModItem, ModSource, ResolvedDownload } from "./types";

const startModDownload = vi.fn(async (..._args: unknown[]) => "download-1");
vi.mock("../downloads", () => ({ startModDownload: (...args: unknown[]) => startModDownload(...args) }));

const { installBest, installFile, NoCompatibleFileError } = await import("./install");

const tofu = (over: Partial<Tofu> = {}): Tofu => ({ id: "t1", name: "T", version: "1.20.1", runtime: "Native", mods: 0, status: "Ready", path: "/store", gameDir: "/game/mods", contentRoot: "/game", ...over });
const item = (over: Partial<ModItem> = {}): ModItem => ({ source: "curseforge", id: "42", name: "Cool Mod", summary: "", pageUrl: "https://www.curseforge.com/minecraft/mc-mods/cool", native: {}, ...over });
const file: ModFile = { id: "7", name: "Cool 1.0", fileName: "cool-1.0.jar", version: "1.0", date: "2025-01-01T00:00:00Z", native: {} };
const sourceFor = (resolved: ResolvedDownload, files: ModFile[] = [file]): ModSource => ({
  id: "curseforge", label: "CurseForge", siteUrl: "", sorts: [], defaultSort: "", searchesServerSide: true,
  categories: async () => [], search: async () => ({ items: [], total: 0, nextOffset: 0, hasMore: false }), details: async () => ({ body: null, facts: [] }),
  files: async () => files, resolveDownload: async () => resolved,
});

beforeEach(() => startModDownload.mockClear());

describe("installFile", () => {
  it("never downloads a CurseForge file the author restricted, or one without a download URL", async () => {
    const restricted = await installFile(sourceFor({ fileName: "a.jar", pageUrl: "https://cf/page", restricted: true, reason: "no" }), item(), file, tofu());
    expect(restricted).toMatchObject({ kind: "manual", reason: "restricted", pageUrl: "https://cf/page" });
    const noUrl = await installFile(sourceFor({ fileName: "a.jar", pageUrl: "https://cf/page" }), item(), file, tofu());
    expect(noUrl).toMatchObject({ kind: "manual", pageUrl: "https://cf/page" });
    expect(startModDownload).not.toHaveBeenCalled();
  });

  it("hands a verified download to the native side with its record and the right folder", async () => {
    await installFile(sourceFor({ fileName: "cool-1.0.jar", url: "https://edge.forgecdn.net/a.jar", sha1: "ab".repeat(20), pageUrl: "" }), item(), file, tofu());
    expect(startModDownload).toHaveBeenCalledTimes(1);
    expect(startModDownload.mock.calls[0][0]).toMatchObject({
      provider: "curseforge", url: "https://edge.forgecdn.net/a.jar", path: "/store", filename: "cool-1.0.jar", sha1: "ab".repeat(20), tofuId: "t1",
      record: { source: "curseforge", projectId: "42", fileId: "7", fileDate: "2025-01-01T00:00:00Z" },
    });
    expect((startModDownload.mock.calls[0][0] as { subdir?: string }).subdir).toBeUndefined();
  });

  it("puts resource packs and shaders in their folder and never asks to extract them", async () => {
    const resolved = { fileName: "pack.zip", url: "https://edge.forgecdn.net/p.zip", pageUrl: "" };
    await installFile(sourceFor(resolved), item({ kind: "Resource Packs" }), file, tofu({ extractArchives: true, gameDir: "/game/mods", path: "/game/mods" }));
    await installFile(sourceFor(resolved), item({ kind: "Shaders" }), file, tofu({ extractArchives: true }));
    await installFile(sourceFor(resolved), item({ kind: "Mods" }), file, tofu({ extractArchives: true }));
    const [pack, shader, mod] = startModDownload.mock.calls.map((call) => call[0] as { path: string; subdir?: string; extract?: boolean });
    expect(pack).toMatchObject({ path: "/game", subdir: "resourcepacks", extract: false });
    expect(shader).toMatchObject({ path: "/store", subdir: "shaderpacks", extract: false });
    expect(mod).toMatchObject({ path: "/store", extract: true });
  });

  it("asks for the site when a free Nexus account cannot download directly", async () => {
    const outcome = await installFile(sourceFor({ fileName: "a.zip", pageUrl: "https://www.nexusmods.com/skyrim/mods/9?tab=files", needsPremium: true }), item({ source: "nexus", id: "9" }), file, tofu());
    expect(outcome).toMatchObject({ kind: "manual", reason: "premium" });
    expect(startModDownload).not.toHaveBeenCalled();
  });
});

describe("installBest", () => {
  it("explains when no file fits and does not download", async () => {
    await expect(installBest(sourceFor({ fileName: "a.jar", pageUrl: "" }, []), item(), tofu(), { gameVersion: "1.21", loader: "fabric" })).rejects.toBeInstanceOf(NoCompatibleFileError);
    await expect(installBest(sourceFor({ fileName: "a.jar", pageUrl: "" }, []), item(), tofu())).rejects.toThrow(/No file was found/);
    expect(startModDownload).not.toHaveBeenCalled();
  });
});
