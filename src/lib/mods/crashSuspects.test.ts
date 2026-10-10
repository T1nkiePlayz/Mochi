import { describe, expect, it } from "vitest";
import { crashSuspects, suspectIssues } from "./crashSuspects";
import type { CheckEntry } from "./conflicts";

const mod = (filename: string, title?: string, extra: Partial<CheckEntry> = {}): CheckEntry => ({
  filename, path: `/mods/${filename}`, enabled: true,
  record: title ? { file: filename, source: "modrinth", projectId: title.toLowerCase().replace(/\s/g, ""), title } : undefined, ...extra,
});
const entries = [mod("sodium-fabric-0.5.8+mc1.20.4.jar", "Sodium"), mod("lithium-fabric-0.12.jar", "Lithium"), mod("BetterEnd-4.0.jar"), mod("create-1.20.1-0.5.jar", "Create"), mod("fabric-api-0.92.jar", "Fabric API")];

describe("crashSuspects", () => {
  it("finds a Fabric mod named in an entrypoint error", () => {
    const log = "[main/ERROR]: Could not execute entrypoint stage 'main' due to errors, provided by 'lithium'!";
    const out = crashSuspects(log, entries);
    expect(out.map((s) => s.entry.filename)).toEqual(["lithium-fabric-0.12.jar"]);
    expect(out[0].confidence).toBe("exact");
  });
  it("reads a Forge crash report's suspected mods", () => {
    const log = "-- Head --\nSuspected Mods: \n\tCreate (create), Version: 0.5\n\n-- Next --";
    expect(crashSuspects(log, entries).map((s) => s.name)).toEqual(["Create"]);
  });
  it("matches a mixin config and a named jar", () => {
    expect(crashSuspects("Mixin apply failed sodium.mixins.json:core.Foo", entries)[0].name).toBe("Sodium");
    expect(crashSuspects("Mod File: /home/u/mods/BetterEnd-4.0.jar failed to load", entries)[0].entry.filename).toBe("BetterEnd-4.0.jar");
  });
  it("never blames the loader or the game, and ignores switched-off or foreign files", () => {
    expect(crashSuspects("provided by 'fabricloader' Mod 'Fabric API' (fabric-api) minecraft", entries)).toEqual([]);
    const off = [mod("sodium.jar.disabled", "Sodium", { enabled: false }), mod("sodium-b.jar", "Sodium", { foreign: true })];
    expect(crashSuspects("provided by 'sodium'", off)).toEqual([]);
  });
  it("does not guess from short ids", () => {
    expect(crashSuspects("provided by 'ab'", entries)).toEqual([]);
    expect(crashSuspects("", entries)).toEqual([]);
    expect(crashSuspects(null, entries)).toEqual([]);
  });
  it("turns suspects into rows with a switch-off action", () => {
    const [issue] = suspectIssues(crashSuspects("provided by 'lithium'", entries));
    expect(issue.kind).toBe("crash-suspect");
    expect(issue.actions).toEqual([{ kind: "disable", label: "Disable Lithium", paths: ["/mods/lithium-fabric-0.12.jar"] }]);
  });
});
