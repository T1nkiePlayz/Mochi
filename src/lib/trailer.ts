import type { Piko, TrailerVideo } from "../models";

export type TrailerChoice = { kind: "steam"; video: TrailerVideo } | { kind: "youtube"; id: string } | { kind: "none" };
export type TrailerOptions = { canPlayHls?: boolean; skipSteam?: boolean };

const youtubeId = /^[A-Za-z0-9_-]{6,20}$/;
const steamHost = /^https:\/\/([a-z0-9-]+\.)*steamstatic\.com\//;
const steamUrl = (url?: string) => (typeof url === "string" && steamHost.test(url) ? url : undefined);

/** True when this webview can play HLS in a plain `<video>` (WebKit on macOS; WebKitGTK when GStreamer has the HLS demuxer). */
export function canPlayHlsNatively(): boolean {
  try { return document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== ""; } catch { return false; }
}

/**
 * Picks what the Trailer section plays: a direct Steam file, then a Steam HLS stream when the webview can play it,
 * then the YouTube embed, else nothing. `skipSteam` is set after the `<video>` failed so YouTube takes over.
 */
export function pickTrailer(piko: Pick<Piko, "trailerVideos" | "trailerId">, { canPlayHls = false, skipSteam = false }: TrailerOptions = {}): TrailerChoice {
  if (!skipSteam) {
    for (const item of piko.trailerVideos ?? []) {
      const mp4 = steamUrl(item.mp4), webm = steamUrl(item.webm), hls = canPlayHls ? steamUrl(item.hls) : undefined;
      if (mp4 || webm || hls) return { kind: "steam", video: { name: item.name, thumbnail: steamUrl(item.thumbnail), mp4, webm, hls: mp4 || webm ? undefined : hls } };
    }
  }
  if (piko.trailerId && youtubeId.test(piko.trailerId)) return { kind: "youtube", id: piko.trailerId };
  return { kind: "none" };
}
