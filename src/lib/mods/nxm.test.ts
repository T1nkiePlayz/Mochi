import { describe, expect, it } from "vitest";
import { nexusManagerDownloadUrl, nxmExpired, parseNxmLink } from "./nxm";

describe("nxm:// links", () => {
  it("parses a Mod Manager Download link", () => {
    const parsed = parseNxmLink("nxm://stardewvalley/mods/2400/files/9876?key=AbC-123_xyz&expires=1900000000&user_id=42");
    expect(parsed).toEqual({ ok: true, link: { gameDomain: "stardewvalley", modId: 2400, fileId: 9876, key: "AbC-123_xyz", expires: 1_900_000_000, userId: 42 } });
    expect(parseNxmLink("NXM://SkyrimSpecialEdition/mods/266/files/1000?key=abcdefgh&expires=1700000000").ok).toBe(true);
  });
  it("refuses anything unexpected", () => {
    for (const bad of [
      "https://www.nexusmods.com/stardewvalley/mods/1",
      "nxm://stardewvalley/mods/2400/files/9876",
      "nxm://stardewvalley/mods/2400/files/9876?key=short&expires=1",
      "nxm://stardewvalley/mods/2400/files/9876?key=abcdefgh&expires=soon",
      "nxm://stardewvalley/mods/x/files/9876?key=abcdefgh&expires=1",
      "nxm://stardewvalley/mods/0/files/9876?key=abcdefgh&expires=1",
      "nxm://stardewvalley/mods/1/files/2/extra?key=abcdefgh&expires=1",
      "nxm://star%20dew/mods/1/files/2?key=abcdefgh&expires=1",
      "nxm://user:pw@stardewvalley/mods/1/files/2?key=abcdefgh&expires=1",
      "nxm://someone@stardewvalley/mods/1/files/2?key=abcdefgh&expires=1",
      "nxm://stardewvalley:8080/mods/1/files/2?key=abcdefgh&expires=1",
      "nxm://stardewvalley/mods/1/files/2?key=abc<script>&expires=1",
      `nxm://g/mods/1/files/2?key=${"a".repeat(3000)}&expires=1`,
    ]) expect(parseNxmLink(bad).ok, bad).toBe(false);
    const collection = parseNxmLink("nxm://skyrimspecialedition/collections/abcd/revisions/3");
    expect(collection.ok === false && collection.reason).toContain("Collections");
  });
  it("knows when a key expired and builds the manager-download page", () => {
    expect(nxmExpired({ expires: 100 }, 101_000)).toBe(true);
    expect(nxmExpired({ expires: 100 }, 99_000)).toBe(false);
    expect(nexusManagerDownloadUrl("stardewvalley", 5, 9)).toBe("https://www.nexusmods.com/stardewvalley/mods/5?tab=files&file_id=9&nmm=1");
    expect(nexusManagerDownloadUrl("stardewvalley", 5)).toBe("https://www.nexusmods.com/stardewvalley/mods/5?tab=files");
  });
});
