import { describe, expect, it } from "vitest";
import { checkTofu, modPageUrl, sortIssues, summarizeIssues, type CheckEntry, type CheckRecord } from "./conflicts";

const tofu = { name: "Pack", version: "1.20.1", runtime: "Native", loader: "fabric" as const };
const mod = (file: string, record: Partial<CheckRecord> = {}, over: Partial<CheckEntry> = {}): CheckEntry => ({
  filename: file, path: `/mods/${file}`, enabled: !file.endsWith(".disabled"),
  record: { file: file.replace(/\.disabled$/, ""), source: "modrinth", projectId: `p-${file}`, title: file, installedAt: 1, ...record }, ...over,
});
const kinds = (issues: ReturnType<typeof checkTofu>) => issues.map((issue) => issue.kind);

describe("checkTofu", () => {
  it("is quiet for a healthy Tofu, empty lists and unknown files", () => {
    expect(checkTofu([], tofu)).toEqual([]);
    expect(checkTofu([mod("a.jar", { gameVersions: ["1.20.1"], loaders: ["fabric"] }), { filename: "x.jar", enabled: true }], tofu)).toEqual([]);
  });

  it("flags the same file with and without .disabled, case-insensitively", () => {
    const issues = checkTofu([mod("Sodium.jar"), { filename: "sodium.jar.disabled", enabled: false, path: "/mods/sodium.jar.disabled" }], tofu);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-file", severity: "info", files: ["Sodium.jar", "sodium.jar.disabled"] });
  });

  it("flags two enabled files of one project, keeps the newest and offers to disable the older", () => {
    const a = mod("m-1.jar", { projectId: "P", fileDate: "2024-01-01", title: "M" });
    const b = mod("m-2.jar", { projectId: "P", fileDate: "2025-01-01", title: "M" });
    const issues = checkTofu([a, b], tofu);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-project", severity: "warning", files: ["m-2.jar", "m-1.jar"] });
    expect(issues[0].actions[0]).toEqual({ kind: "disable", label: "Disable duplicate", paths: ["/mods/m-1.jar"] });
    expect(checkTofu([b, a], tofu)[0].actions[0]).toEqual(issues[0].actions[0]);
  });

  it("does not flag a disabled copy, other sources with the same id, manual records or another Tofu's files", () => {
    const base = { projectId: "P", title: "M" };
    expect(checkTofu([mod("m-1.jar", base), mod("m-2.jar.disabled", base)], tofu)).toEqual([]);
    expect(checkTofu([mod("m-1.jar", base), mod("m-2.jar", { ...base, source: "curseforge", title: "Other" })], tofu)).toEqual([]);
    expect(checkTofu([mod("a.jar", { source: "manual", projectId: "P" }), mod("b.jar", { source: "manual", projectId: "P" })], tofu)).toEqual([]);
    expect(checkTofu([mod("m-1.jar", base), mod("m-2.jar", base, { foreign: true })], tofu)).toEqual([]);
    expect(checkTofu([mod("m-1.jar", base), mod("m-2.jar", { ...base, extracted: true })], tofu)).toEqual([]);
  });

  it("flags the same mod title from two sites", () => {
    const issues = checkTofu([mod("a.jar", { title: "Iris Shaders", projectId: "1" }), mod("b.jar", { title: "iris-shaders", source: "curseforge", projectId: "99" })], tofu);
    expect(kinds(issues)).toEqual(["duplicate-project"]);
    expect(checkTofu([mod("a.jar", { title: "Iris" }), mod("b.jar", { title: "Iris" })], tofu)).toEqual([]);
  });

  it("flags a wrong loader and a wrong game version from stored metadata, not mere uncertainty", () => {
    const wrongLoader = checkTofu([mod("f.jar", { loaders: ["forge"], gameVersions: ["1.20.1"], title: "Forgey" })], tofu);
    expect(wrongLoader).toHaveLength(1);
    expect(wrongLoader[0]).toMatchObject({ kind: "wrong-loader", title: "Forgey is for a different loader" });
    expect(wrongLoader[0].detail).toMatch(/Forge/);
    const wrongVersion = checkTofu([mod("v.jar", { loaders: ["fabric"], gameVersions: ["1.19.2", "1.19.4"] })], tofu);
    expect(kinds(wrongVersion)).toEqual(["wrong-version"]);
    expect(kinds(checkTofu([mod("w.jar", { loaders: ["forge"], gameVersions: ["1.19.2"] })], tofu)).sort()).toEqual(["wrong-loader", "wrong-version"]);
    // Same release series and Quilt running Fabric mods are "maybe": no warning.
    expect(checkTofu([mod("s.jar", { gameVersions: ["1.20.4"], loaders: ["fabric"] })], tofu)).toEqual([]);
    expect(checkTofu([mod("q.jar", { gameVersions: ["1.20.1"], loaders: ["fabric"] })], { ...tofu, loader: "quilt" })).toEqual([]);
  });

  it("skips version and loader checks without a target, without stored facts, for disabled mods and resource packs", () => {
    const bad = { loaders: ["forge"], gameVersions: ["1.8"] };
    expect(checkTofu([mod("a.jar", bad)], { name: "Pack", version: "", runtime: "Native" })).toEqual([]);
    expect(checkTofu([mod("a.jar")], tofu)).toEqual([]);
    expect(checkTofu([mod("a.jar.disabled", bad)], tofu)).toEqual([]);
    expect(checkTofu([mod("pack.zip", { ...bad, subdir: "resourcepacks" })], tofu)).toEqual([]);
    expect(kinds(checkTofu([mod("a.jar", bad)], { name: "Pack", version: "", runtime: "Native" }, { target: { loader: "fabric", gameVersion: "1.20.1" } }))).toEqual(["wrong-loader", "wrong-version"]);
  });

  it("flags a missing required dependency once, naming everything that needs it", () => {
    const issues = checkTofu([mod("a.jar", { requires: ["API"], title: "A" }), mod("b.jar", { requires: ["API", "OTHER"], title: "B" }), mod("api.jar", { projectId: "OTHER" })], tofu);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "missing-dependency", id: "missing-dependency:modrinth:API", files: ["A", "B"] });
    expect(issues[0].detail).toContain("A, B need");
    expect(issues[0].actions.map((action) => action.kind)).toEqual(["install-dependency", "open-page"]);
    expect(issues[0].actions[0]).toMatchObject({ source: "modrinth", projectId: "API" });
  });

  it("is satisfied by an enabled dependency; a switched-off one is offered to be enabled", () => {
    const needs = mod("a.jar", { requires: ["API"], title: "A" });
    expect(checkTofu([needs, mod("api.jar", { projectId: "API" })], tofu)).toEqual([]);
    const issues = checkTofu([needs, mod("api.jar.disabled", { projectId: "API", title: "Fabric API" })], tofu);
    expect(issues[0]).toMatchObject({ kind: "missing-dependency", title: "Fabric API is switched off" });
    expect(issues[0].actions).toEqual([{ kind: "enable", label: "Enable Fabric API", paths: ["/mods/api.jar.disabled"] }]);
  });

  it("ignores dependencies of disabled mods, self references and dependency ids of other sources", () => {
    expect(checkTofu([mod("a.jar.disabled", { requires: ["API"] })], tofu)).toEqual([]);
    expect(checkTofu([mod("a.jar", { projectId: "A", requires: ["A"] })], tofu)).toEqual([]);
    const issues = checkTofu([mod("a.jar", { requires: ["API"] }), mod("api.jar", { projectId: "API", source: "curseforge" })], tofu);
    expect(kinds(issues)).toEqual(["missing-dependency"]);
  });

  it("has no open-page action for sources whose page needs more than the project id", () => {
    const issues = checkTofu([mod("a.jar", { source: "nexus", requires: ["7"] })], tofu);
    expect(issues[0].actions.map((action) => action.kind)).toEqual(["install-dependency"]);
  });

  it("flags installed mods the author marked incompatible, once per pair, with a disable choice for each", () => {
    const a = mod("a.jar", { projectId: "A", title: "Alpha", incompatible: ["B"] });
    const b = mod("b.jar", { projectId: "B", title: "Beta", incompatible: ["A"] });
    const issues = checkTofu([a, b], tofu);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "incompatible", title: "Alpha does not work with Beta" });
    expect(issues[0].actions.filter((action) => action.kind === "disable").map((action) => action.label)).toEqual(["Disable Alpha", "Disable Beta"]);
    expect(checkTofu([a, mod("b.jar.disabled", { projectId: "B" })], tofu)).toEqual([]);
    expect(checkTofu([a], tofu)).toEqual([]);
  });

  it("omits disable actions when a path is unknown and tolerates sparse records", () => {
    const a = mod("m-1.jar", { projectId: "P", fileDate: "2024" }, { path: undefined });
    const b = mod("m-2.jar", { projectId: "P", fileDate: "2025" }, { path: undefined });
    expect(checkTofu([a, b], tofu)[0].actions).toEqual([{ kind: "open-page", label: "Open mod page", source: "modrinth", projectId: "P" }]);
    expect(() => checkTofu([{ filename: "x.jar", enabled: true, record: { file: "x.jar", source: "modrinth", projectId: "" } }], tofu)).not.toThrow();
  });

  it("gives every issue a unique, stable id", () => {
    const entries = [mod("a.jar", { projectId: "P", requires: ["X", "Y"] }), mod("b.jar", { projectId: "P" }), mod("c.jar", { loaders: ["forge"] })];
    const ids = checkTofu(entries, tofu).map((issue) => issue.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(checkTofu([...entries].reverse(), tofu).map((issue) => issue.id).sort()).toEqual([...ids].sort());
  });

  it("checks 300 mods in well under 50 ms", () => {
    const entries: CheckEntry[] = Array.from({ length: 300 }, (_, index) => mod(`mod-${index}.jar`, {
      projectId: `P${index % 280}`, title: `Mod ${index}`, gameVersions: ["1.20.1", "1.20.2"], loaders: ["fabric"], requires: [`P${(index + 1) % 300}`, "API", "P1"], incompatible: [`P${(index + 7) % 300}`],
    }));
    checkTofu(entries, tofu);
    const start = performance.now();
    const issues = checkTofu(entries, tofu);
    const elapsed = performance.now() - start;
    expect(issues.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("helpers", () => {
  it("sorts warnings before notes and summarises", () => {
    const issues = checkTofu([mod("a.jar"), mod("a.jar.disabled"), mod("b.jar", { requires: ["Z"] })], tofu);
    expect(sortIssues(issues).map((issue) => issue.severity)).toEqual(["warning", "info"]);
    expect(summarizeIssues([])).toBe("No problems found.");
    expect(summarizeIssues(issues.slice(0, 1))).toBe("1 possible problem found.");
    expect(summarizeIssues(issues)).toBe("2 possible problems found.");
  });
  it("builds page links only where the project id is enough", () => {
    expect(modPageUrl("modrinth", "AANobbMI")).toBe("https://modrinth.com/project/AANobbMI");
    expect(modPageUrl("curseforge", "12")).toBe("https://www.curseforge.com/projects/12");
    expect(modPageUrl("nexus", "12")).toBeUndefined();
    expect(modPageUrl("manual", "x")).toBeUndefined();
  });
});
