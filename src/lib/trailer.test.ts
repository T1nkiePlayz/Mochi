import { describe, expect, it } from "vitest";
import { pickTrailer } from "./trailer";

const video = { name: "T", thumbnail: "https://shared.akamai.steamstatic.com/t.jpg", mp4: "https://video.akamai.steamstatic.com/a.mp4" };

describe("pickTrailer", () => {
  it("prefers a Steam video over YouTube", () => {
    expect(pickTrailer({ trailerVideos: [video], trailerId: "dQw4w9WgXcQ" })).toEqual({ kind: "steam", video: { ...video, webm: undefined } });
  });
  it("falls back to YouTube, then none", () => {
    expect(pickTrailer({ trailerId: "dQw4w9WgXcQ" })).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(pickTrailer({ trailerVideos: [], trailerId: "bad id!" })).toEqual({ kind: "none" });
    expect(pickTrailer({})).toEqual({ kind: "none" });
  });
  it("ignores videos that are not on a Steam host", () => {
    expect(pickTrailer({ trailerVideos: [{ name: "x", mp4: "https://evil.example/a.mp4" }, { name: "y", webm: "http://video.akamai.steamstatic.com/a.webm" }] })).toEqual({ kind: "none" });
  });
});
