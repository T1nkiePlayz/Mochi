import { describe, expect, it } from "vitest";
import type { DependencyEntry, DependencyPlan } from "./dependencies";
import { assembleWarnings, defaultSelection, missingDependencies, selectedItems } from "./updatePlan";
import type { ModUpdateItem } from "./updates";

const item = (name: string, over: Partial<ModUpdateItem> = {}): ModUpdateItem => ({
  path: `/m/${name}.jar`, filename: `${name}.jar`, title: name, source: "modrinth", enabled: true, currentVersion: "1", newVersion: "2",
  record: { source: "modrinth", projectId: name, fileId: "v" }, apply: { kind: "download", provider: "modrinth", url: "https://x", filename: "x.jar" }, ...over,
});
const manual = (name: string) => item(name, { apply: { kind: "manual", pageUrl: "https://site/" + name, reason: "Restricted." } });
const dep = (key: string, over: Partial<DependencyEntry> = {}): DependencyEntry => ({ key, status: "install", name: key, pageUrl: "https://p/" + key, item: {} as never, file: {} as never, requiredBy: "a", depth: 1, ...over });
const plan = (over: Partial<DependencyPlan> = {}): DependencyPlan => ({ entries: [], warnings: [], notes: [], truncated: false, ...over });

describe("selection", () => {
  it("selects every installable update and skips manual ones", () => {
    const items = [item("a"), manual("b"), item("c")];
    expect([...defaultSelection(items)]).toEqual([items[0].path, items[2].path]);
    expect(selectedItems(items, new Set([items[1].path, items[2].path])).map((entry) => entry.title)).toEqual(["c"]);
  });
});

describe("missing dependencies", () => {
  it("lists each project once and only for selected mods", () => {
    const [a, b, c] = [item("a"), item("b"), item("c")];
    const plans = new Map([[a.path, plan({ entries: [dep("lib"), dep("have", { status: "already-installed" })] })], [b.path, plan({ entries: [dep("lib"), dep("api")] })], [c.path, plan({ entries: [dep("only-c")] })]]);
    expect(missingDependencies([a, b, c], new Set([a.path, b.path]), plans).map((entry) => entry.key)).toEqual(["lib", "api"]);
  });
});

describe("warnings", () => {
  it("explains manual, disabled, unavailable, incompatible and failed lookups", () => {
    const a = item("a", { enabled: false }); const b = manual("b"); const c = item("c");
    const plans = new Map([
      [a.path, plan({ entries: [dep("x", { status: "unavailable", reason: "No file fits", name: "X" })] })],
      [c.path, plan({ warnings: [{ kind: "incompatible", name: "Old", pageUrl: "https://o", installedTitle: "Old", declaredBy: "c" }], notes: ["c: could not check dependencies."] })],
    ]);
    const warnings = assembleWarnings([a, b, c], new Set([a.path, c.path]), plans);
    expect(warnings.map((warning) => warning.id)).toEqual([`manual:${b.path}`, `disabled:${a.path}`, "needs:x", "incompatible:c>Old", "note:c: could not check dependencies."]);
    expect(warnings.find((warning) => warning.id === "needs:x")).toMatchObject({ tone: "warning", message: expect.stringContaining("No file fits") });
  });
  it("ignores plans of unselected mods", () => {
    const a = item("a");
    expect(assembleWarnings([a], new Set(), new Map([[a.path, plan({ notes: ["x"] })]]))).toEqual([]);
  });
});
