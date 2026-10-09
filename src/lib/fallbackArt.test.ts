import { describe, expect, it } from "vitest";
import { artworkBackground, hasArtwork, hasMetadata, hueOf, initialsOf, placeholdersLast } from "./fallbackArt";

describe("initialsOf", () => {
  it("takes the first letters of significant words", () => {
    expect(initialsOf("Half-Life 2")).toBe("H2");
    expect(initialsOf("The Witcher 3: Wild Hunt")).toBe("W3");
    expect(initialsOf("Terraria")).toBe("Te");
    expect(initialsOf("Stardew Valley")).toBe("SV");
    expect(initialsOf("The")).toBe("Th");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("Ōkami HD")).toBe("OH");
    expect(initialsOf("ゲーム")).toBe("ゲー");
  });
});

describe("hueOf", () => {
  it("is stable and spreads names", () => {
    expect(hueOf("terraria")).toBe(hueOf("terraria"));
    expect(hueOf("terraria")).toBeGreaterThanOrEqual(0);
    expect(hueOf("terraria")).toBeLessThan(360);
    const hues = new Set(["a", "b", "c", "doom", "quake", "celeste", "hades", "minecraft"].map(hueOf));
    expect(hues.size).toBeGreaterThan(5);
  });
});

describe("artworkBackground", () => {
  it("passes CSS images through and wraps bare launcher URLs", () => {
    expect(artworkBackground("linear-gradient(red, blue), url('x')")).toContain("linear-gradient");
    expect(artworkBackground("/assets/steam-abc.svg")).toBe("url('/assets/steam-abc.svg')");
    expect(artworkBackground("data:image/svg+xml;base64,AAA")).toMatch(/^url\(/);
  });
  it("treats empty text and the legacy purple placeholder as no artwork", () => {
    expect(artworkBackground("")).toBeUndefined();
    expect(artworkBackground("linear-gradient(145deg, rgba(73,57,103,.8), #000)")).toBeUndefined();
    expect(artworkBackground("not a url")).toBeUndefined();
  });
});

describe("hasArtwork", () => {
  it("is true for a remote url, a known source or usable stored artwork", () => {
    expect(hasArtwork({ artwork: "" })).toBe(false);
    expect(hasArtwork({ artwork: "", artworkUrl: "https://x/y.jpg" })).toBe(true);
    expect(hasArtwork({ artwork: "", artworkSource: "custom" })).toBe(true);
    expect(hasArtwork({ artwork: "/a/b.svg" })).toBe(true);
  });
});

describe("placeholdersLast", () => {
  const art = { artwork: "", artworkUrl: "https://x/y.jpg" };
  const bare = { artwork: "" };
  it("treats art or an IGDB match as metadata", () => {
    expect(hasMetadata(art)).toBe(true);
    expect(hasMetadata({ ...bare, igdbId: 5 })).toBe(true);
    expect(hasMetadata(bare)).toBe(false);
  });
  it("moves placeholders after games with metadata and keeps each side's order", () => {
    const list = [{ ...bare, n: "a" }, { ...art, n: "b" }, { ...bare, n: "c" }, { ...art, n: "d" }, { ...bare, n: "e" }];
    expect(placeholdersLast(list).map((g) => g.n)).toEqual(["b", "d", "a", "c", "e"]);
    expect(list.map((g) => g.n)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
