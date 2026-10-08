import { describe, expect, it } from "vitest";
import { buttonToAction, familyFromName, stickDirection } from "./mapping";
import { pickNeighbor } from "./spatial";
import { normalizeControllerSettings } from "./settings";

describe("controller logic", () => {
  it("Nintendo layouts confirm on the east button, swap flips it", () => {
    expect(buttonToAction("south", "xbox", false)).toBe("confirm");
    expect(buttonToAction("east", "switch", false)).toBe("confirm");
    expect(buttonToAction("south", "xbox", true)).toBe("back");
  });
  it("stick dead zone and hysteresis", () => {
    expect(stickDirection(0.1, 0.1, 0.35)).toBeNull();
    expect(stickDirection(0.9, 0.1, 0.35)).toBe("right");
    expect(stickDirection(0.5, 0.55, 0.26, "right")).toBe("right");
  });
  it("detects families", () => { expect(familyFromName("Xbox 360 Controller")).toBe("xbox"); expect(familyFromName("DualSense")).toBe("playstation"); expect(familyFromName("???")).toBe("generic"); });
  it("spatial navigation stays in its column", () => {
    const r = (l: number, t: number) => ({ left: l, top: t, right: l + 50, bottom: t + 50 });
    expect(pickNeighbor(r(0, 0), [{ item: "right", rect: r(100, 0) }, { item: "below", rect: r(0, 100) }, { item: "far", rect: r(200, 100) }], "down")).toBe("below");
    expect(pickNeighbor(r(0, 0), [], "up")).toBeNull();
  });
  it("normalises settings", () => {
    expect(normalizeControllerSettings({ deadZone: 99, repeatSpeed: "x" })).toMatchObject({ deadZone: 0.8, repeatSpeed: "normal", enabled: null });
    expect(normalizeControllerSettings({ deadZone: NaN }).deadZone).toBe(0.35);
  });
});
