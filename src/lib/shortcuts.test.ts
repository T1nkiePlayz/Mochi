import { describe, expect, it, vi } from "vitest";
import { runAddToSteam, shortcutMenuItems, type AddToSteamResult, type ShortcutTargets } from "./shortcuts";

const targets = (over: Partial<ShortcutTargets> = {}): ShortcutTargets => ({ locations: [{ id: "menu", label: "Application menu", path: "/a" }, { id: "desktop", label: "Desktop", path: "/d" }], steamUsers: [{ id: "1", name: "Ash", path: "/s/1" }], steamRunning: false, ...over });

describe("shortcutMenuItems", () => {
  it("is empty until targets load", () => expect(shortcutMenuItems(null)).toEqual([]));
  it("lists locations then a single plain Steam row", () => {
    const items = shortcutMenuItems(targets());
    expect(items.map((item) => item.label)).toEqual(["Create shortcut: Application menu", "Create shortcut: Desktop", "Add to Steam"]);
    expect(items[2]).toMatchObject({ kind: "steam", userId: "1" });
  });
  it("names each account when several exist and omits Steam when none", () => {
    const many = shortcutMenuItems(targets({ steamUsers: [{ id: "1", name: "Ash", path: "" }, { id: "2", name: "Bo", path: "" }] }));
    expect(many.filter((item) => item.kind === "steam").map((item) => item.label)).toEqual(["Add to Steam: Ash", "Add to Steam: Bo"]);
    expect(shortcutMenuItems(targets({ steamUsers: [] })).some((item) => item.kind === "steam")).toBe(false);
  });
  it("has unique keys", () => { const keys = shortcutMenuItems(targets()).map((item) => item.key); expect(new Set(keys).size).toBe(keys.length); });
});

describe("runAddToSteam", () => {
  const user = { id: "1", name: "Ash" };
  const make = (...results: AddToSteamResult[]) => ({ add: vi.fn(async () => results.shift()!), confirm: vi.fn(async () => true), notify: vi.fn() });
  it("adds without asking when Steam is closed", async () => {
    const deps = make({ status: "added", backup: null });
    expect(await runAddToSteam({ name: "G" }, user, deps)).toBe("added");
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("Added to Steam", expect.stringContaining("Restart Steam"));
  });
  it("asks when Steam is running and retries with permission", async () => {
    const deps = make({ status: "steam-running", backup: null }, { status: "added", backup: "/b" });
    expect(await runAddToSteam({ name: "G" }, user, deps)).toBe("added");
    expect(deps.add.mock.calls).toEqual([["1", false], ["1", true]]);
  });
  it("stops when the user declines", async () => {
    const deps = make({ status: "steam-running", backup: null });
    deps.confirm.mockResolvedValue(false);
    expect(await runAddToSteam({ name: "G" }, user, deps)).toBe("cancelled");
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });
  it("reports an existing entry", async () => {
    const deps = make({ status: "exists", backup: null });
    expect(await runAddToSteam({ name: "G" }, user, deps)).toBe("exists");
    expect(deps.notify).toHaveBeenCalledWith("Already in Steam", expect.any(String));
  });
});
