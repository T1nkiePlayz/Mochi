import { describe, expect, it } from "vitest";
import { createTypeAhead, gridKeyAction, pageRows, prefixMatch } from "./gridKeys";

describe("gridKeyAction", () => {
  it("maps navigation keys", () => {
    expect(gridKeyAction({ key: "ArrowRight" })).toEqual({ type: "step", delta: 1 });
    expect(gridKeyAction({ key: "ArrowUp" })).toEqual({ type: "row", direction: "up" });
    expect(gridKeyAction({ key: "End" })).toEqual({ type: "edge", edge: "last" });
    expect(gridKeyAction({ key: "PageDown" })).toEqual({ type: "page", direction: "down" });
  });
  it("only Shift+Enter plays; plain Enter stays a normal click", () => {
    expect(gridKeyAction({ key: "Enter", shiftKey: true })).toEqual({ type: "play" });
    expect(gridKeyAction({ key: "Enter" })).toBeNull();
  });
  it("leaves browser shortcuts alone", () => {
    expect(gridKeyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(gridKeyAction({ key: "ArrowLeft", ctrlKey: true })).toBeNull();
    expect(gridKeyAction({ key: "f", ctrlKey: true })).toBeNull();
    expect(gridKeyAction({ key: "Tab" })).toBeNull();
    expect(gridKeyAction({ key: " " })).toBeNull();
  });
  it("uses Ctrl+D for favourites and / for search; letters type ahead", () => {
    expect(gridKeyAction({ key: "d", ctrlKey: true })).toEqual({ type: "favorite" });
    expect(gridKeyAction({ key: "d", metaKey: true })).toEqual({ type: "favorite" });
    expect(gridKeyAction({ key: "/" })).toEqual({ type: "search" });
    expect(gridKeyAction({ key: "c" })).toEqual({ type: "type", char: "c" });
  });
});

describe("type ahead", () => {
  it("builds a prefix and resets after a pause", () => {
    const type = createTypeAhead(500);
    expect(type("C", 1000)).toBe("c");
    expect(type("e", 1200)).toBe("ce");
    expect(type("x", 2000)).toBe("x");
  });
  const names = ["Celeste", "Cave Story", "Hades", "Hollow Knight", "Cult of the Lamb"];
  it("jumps to the first match after the current game and wraps", () => {
    expect(prefixMatch(names, 0, "h")).toBe(2);
    expect(prefixMatch(names, 3, "h")).toBe(2);
    expect(prefixMatch(names, 4, "c")).toBe(0);
  });
  it("cycles with a repeated letter and refines with a longer prefix", () => {
    expect(prefixMatch(names, 0, "cc")).toBe(1);
    expect(prefixMatch(names, 1, "cu")).toBe(4);
    expect(prefixMatch(names, 0, "ho")).toBe(3);
  });
  it("returns -1 without a match", () => {
    expect(prefixMatch(names, 0, "zz")).toBe(-1);
    expect(prefixMatch([], 0, "a")).toBe(-1);
    expect(prefixMatch(names, 0, "")).toBe(-1);
  });
});

describe("pageRows", () => {
  it("moves about a screen and never less than one row", () => {
    expect(pageRows(900, 150)).toBe(5);
    expect(pageRows(100, 150)).toBe(1);
    expect(pageRows(900, 0)).toBe(1);
  });
});
