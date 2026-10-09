import { describe, expect, it } from "vitest";
import { pickTrailer } from "./trailer";

const video = { name: "T", thumbnail: "https://shared.akamai.steamstatic.com/t.jpg", mp4: "https://video.akamai.steamstatic.com/a.mp4" };

describe("pickTrailer", () => {
  it("prefers a Steam video over YouTube", () => {
    expect(pickTrailer({ trailerVideos: [video], trailerId: "dQw4w9WgXcQ" })).toEqual({ kind: "steam", video: { ...video, webm: undefined, hls: undefined } });
  });
  it("falls back to YouTube, then none", () => {
    expect(pickTrailer({ trailerId: "dQw4w9WgXcQ" })).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(pickTrailer({ trailerVideos: [], trailerId: "bad id!" })).toEqual({ kind: "none" });
    expect(pickTrailer({})).toEqual({ kind: "none" });
  });
  it("ignores videos that are not on a Steam host", () => {
    expect(pickTrailer({ trailerVideos: [{ name: "x", mp4: "https://evil.example/a.mp4" }, { name: "y", webm: "http://video.akamai.steamstatic.com/a.webm" }] })).toEqual({ kind: "none" });
  });
  const hlsOnly = { name: "H", hls: "https://video.akamai.steamstatic.com/h.m3u8" };
  it("uses HLS only when the webview can play it, after direct files, before YouTube", () => {
    expect(pickTrailer({ trailerVideos: [hlsOnly], trailerId: "dQw4w9WgXcQ" }, { canPlayHls: false })).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(pickTrailer({ trailerVideos: [hlsOnly], trailerId: "dQw4w9WgXcQ" }, { canPlayHls: true })).toMatchObject({ kind: "steam", video: { hls: hlsOnly.hls } });
    expect(pickTrailer({ trailerVideos: [{ ...video, hls: hlsOnly.hls }] }, { canPlayHls: true })).toMatchObject({ kind: "steam", video: { mp4: video.mp4, hls: undefined } });
    expect(pickTrailer({ trailerVideos: [hlsOnly] }, { canPlayHls: false })).toEqual({ kind: "none" });
  });
  it("falls back to YouTube after the video failed", () => {
    expect(pickTrailer({ trailerVideos: [video], trailerId: "dQw4w9WgXcQ" }, { skipSteam: true })).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
  });
});
