import type { Piko, TrailerVideo } from "../models";

export type TrailerChoice = { kind: "steam"; video: TrailerVideo } | { kind: "youtube"; id: string } | { kind: "none" };

const youtubeId = /^[A-Za-z0-9_-]{6,20}$/;
const steamHost = /^https:\/\/([a-z0-9-]+\.)*steamstatic\.com\//;

/** Picks what the Trailer section plays: a Steam video file (plays natively) first, then the YouTube embed, else nothing. */
export function pickTrailer(piko: Pick<Piko, "trailerVideos" | "trailerId">): TrailerChoice {
  const video = piko.trailerVideos?.find((item) => (item.mp4 && steamHost.test(item.mp4)) || (item.webm && steamHost.test(item.webm)));
  if (video) return { kind: "steam", video: { ...video, mp4: video.mp4 && steamHost.test(video.mp4) ? video.mp4 : undefined, webm: video.webm && steamHost.test(video.webm) ? video.webm : undefined } };
  if (piko.trailerId && youtubeId.test(piko.trailerId)) return { kind: "youtube", id: piko.trailerId };
  return { kind: "none" };
}
