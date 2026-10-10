// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { newSince, scanRequestFor, type ScreenshotFile } from "./screenshots";

const file = (modified: number): ScreenshotFile => ({ path: `/p/${modified}.png`, modified, source: "folder" });

describe("screenshots helpers", () => {
  it("only counts files newer than the last look, and none before the first look", () => {
    expect(newSince([file(5), file(10)], null)).toEqual([]);
    expect(newSince([file(5), file(10)], 7).map((f) => f.modified)).toEqual([10]);
  });
  it("builds a scan request with the game's own and the shared folders", () => {
    const request = scanRequestFor({ id: "a", name: "Portal 2", sourceId: "steam", executablePath: "steam://rungameid/620", screenshotFolders: ["/x"] }, ["/shared"]);
    expect(request).toEqual({ steamAppId: 620, gameName: "Portal 2", gameFolders: ["/x"], sharedFolders: ["/shared"] });
  });
});
