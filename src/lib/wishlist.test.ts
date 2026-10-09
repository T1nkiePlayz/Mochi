// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addToWishlist, isWishlisted, readWishlist, removeFromWishlist, sanitizeWishlist, updateWishlistItem, WISHLIST_LIMIT } from "./wishlist";

beforeEach(() => window.localStorage.clear());

describe("wishlist store", () => {
  it("adds, persists under mochi:wishlist, newest first", () => {
    const a = addToWishlist({ name: "  Hades  ", source: "manual" }, 1)!;
    addToWishlist({ name: "Celeste", note: "n" }, 2);
    expect(a.name).toBe("Hades");
    expect(readWishlist().map((i) => i.name)).toEqual(["Celeste", "Hades"]);
    expect(JSON.parse(window.localStorage.getItem("mochi:wishlist")!)).toHaveLength(2);
  });
  it("rejects empty names and de-duplicates by name or source id", () => {
    expect(addToWishlist({ name: "   " })).toBeNull();
    const first = addToWishlist({ name: "Hades" })!;
    expect(addToWishlist({ name: "HADES" })).toEqual(first);
    addToWishlist({ name: "A", source: "steam", externalId: "1" });
    expect(addToWishlist({ name: "A renamed", source: "steam", externalId: "1" })!.name).toBe("A");
    expect(readWishlist()).toHaveLength(2);
    expect(isWishlisted(readWishlist(), { name: "hades" })).toBe(true);
  });
  it("updates and removes", () => {
    const item = addToWishlist({ name: "X" })!;
    updateWishlistItem(item.id, { note: " hi " });
    expect(readWishlist()[0]!.note).toBe("hi");
    updateWishlistItem(item.id, { note: undefined });
    expect(readWishlist()[0]!.note).toBeUndefined();
    removeFromWishlist(item.id);
    expect(readWishlist()).toEqual([]);
  });
  it("sanitises corrupt data and keeps a stable snapshot", () => {
    window.localStorage.setItem("mochi:wishlist", JSON.stringify([null, { id: "a" }, { id: "b", name: "B", coverUrl: "javascript:x", source: "bad" }, { id: "b", name: "dup" }]));
    expect(readWishlist()).toEqual([{ id: "b", name: "B", addedAt: 0 }]);
    expect(readWishlist()).toBe(readWishlist());
    window.localStorage.setItem("mochi:wishlist", "{oops");
    expect(readWishlist()).toEqual([]);
    expect(sanitizeWishlist("x")).toEqual([]);
  });
  it("notifies listeners-independent: caps the list", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1);
    for (let i = 0; i < WISHLIST_LIMIT; i++) addToWishlist({ name: `g${i}` });
    expect(addToWishlist({ name: "one more" })).toBeNull();
    spy.mockRestore();
  });
});
