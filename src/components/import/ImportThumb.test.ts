import { describe, expect, it } from "vitest";
import { steamCapsuleUrl } from "./ImportThumb";

describe("steamCapsuleUrl", () => {
  it("builds the capsule url for steam ids", () => {
    expect(steamCapsuleUrl("steam:220")).toBe("https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/220/capsule_184x69.jpg");
  });
  it("rejects non-steam, shortcut and malformed ids", () => {
    for (const id of ["steam-shortcut:3", "launcher:steam", "steam:", "steam:12a", "steam:1/../2", "steam:12\n", "x steam:5", ""]) expect(steamCapsuleUrl(id)).toBeNull();
  });
});
