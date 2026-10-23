import { describe, expect, it } from "vitest";
import { buildLaunchConfig } from "../lib/launch";
import { addControllerProfile, controllerProfileFor, defaultControllerProfile, getControllerProfiles, launcherControllerProfile, normalizeControllerProfiles, removeControllerProfile, remapConflict, updateControllerProfile } from "./profiles";

describe("controller profiles", () => {
  it("drops malformed entries and cleans the rest", () => {
    const list = normalizeControllerProfiles([
      null, { id: "", name: "x" }, { id: "a", name: "  " },
      { id: "p", name: " Pad ", layout: "weird", typeHint: "playstation", remap: { a: "b", guide: "a", x: "x", y: 3 }, onlyGuid: "NOPE", protonHidraw: true },
      { id: "p", name: "dupe" },
      { id: "q", name: "Q", layout: "nintendo", onlyGuid: "030000005E0400008E02000014010000" },
    ]);
    expect(list.map((profile) => profile.id)).toEqual(["p", "q"]);
    expect(list[0]).toMatchObject({ name: "Pad", layout: "xbox", typeHint: "playstation", remap: { a: "b" }, protonHidraw: true });
    expect(list[0]?.onlyGuid).toBeUndefined();
    expect(list[1]?.onlyGuid).toBe("030000005e0400008e02000014010000");
  });

  it("detects remaps that send two buttons to one output", () => {
    const base = { ...defaultControllerProfile("p", "P"), layout: "custom" as const };
    expect(remapConflict({ ...base, remap: { a: "b", b: "a" } })).toBe(false);
    expect(remapConflict({ ...base, remap: { a: "b", x: "b" } })).toBe(true);
    expect(remapConflict({ ...base, layout: "xbox", remap: { a: "b", x: "b" } })).toBe(false);
  });

  it("stores profiles, assigns them to games and forgets removed ones", () => {
    const profile = addControllerProfile("Couch", "cp-test");
    expect(profile?.id).toBe("cp-test");
    expect(addControllerProfile("   ")).toBeNull();
    updateControllerProfile("cp-test", { layout: "nintendo", ignoreSteamVirtual: true });
    expect(controllerProfileFor({ controllerProfileId: "cp-test" })).toMatchObject({ layout: "nintendo", ignoreSteamVirtual: true });
    expect(controllerProfileFor({})).toBeUndefined();
    removeControllerProfile("cp-test");
    expect(controllerProfileFor({ controllerProfileId: "cp-test" })).toBeUndefined();
    expect(getControllerProfiles()).toHaveLength(0);
  });

  it("sends only what the launcher needs, and nothing for games without a profile", () => {
    expect(launcherControllerProfile(undefined)).toBeNull();
    const custom = { ...defaultControllerProfile("p", "P"), layout: "custom" as const, remap: { a: "b" as const } };
    expect(launcherControllerProfile(custom)).toMatchObject({ layout: "custom", remap: { a: "b" }, onlyGuid: null });
    expect(launcherControllerProfile({ ...custom, layout: "nintendo" })?.remap).toEqual({});
    expect(buildLaunchConfig(undefined, undefined).controller).toBeNull();
    expect(buildLaunchConfig(undefined, undefined, launcherControllerProfile(custom)).controller?.name).toBe("P");
  });
});
