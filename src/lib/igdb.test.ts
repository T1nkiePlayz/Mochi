import { describe, expect, it } from "vitest";
import { igdbIconFor } from "./igdb";

describe("igdbIconFor", () => {
  const cover = (url: string) => ({ url });
  it("uses the exact title match and upgrades the image size", () => {
    const matches = [{ name: "Skyrim 2", cover: cover("//images.igdb.com/igdb/image/upload/t_thumb/b.jpg") }, { name: "Skyrim", cover: cover("//images.igdb.com/igdb/image/upload/t_thumb/a.jpg") }];
    expect(igdbIconFor("SKYRIM", matches)).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg");
  });
  it("ignores near matches, other hosts and plain http", () => {
    expect(igdbIconFor("Skyrim", [{ name: "Skyrim Special Edition", cover: cover("https://images.igdb.com/x/t_thumb/a.jpg") }])).toBeNull();
    expect(igdbIconFor("Skyrim", [{ name: "Skyrim", cover: cover("https://evil.example/t_thumb/a.jpg") }])).toBeNull();
    expect(igdbIconFor("Skyrim", [{ name: "Skyrim", cover: cover("http://images.igdb.com/t_thumb/a.jpg") }])).toBeNull();
  });
});
