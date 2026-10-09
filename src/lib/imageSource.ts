/** Where an image came from, for honest credit lines ("Images from Steam", not always IGDB). */
export type ImageSource = "igdb" | "steam" | "steamgriddb" | "custom";

export const imageSourceLabels: Record<ImageSource, string> = { igdb: "IGDB", steam: "Steam", steamgriddb: "SteamGridDB", custom: "you" };

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function imageSourceOf(url: string): ImageSource {
  const host = hostOf(url);
  if (isHost(host, "igdb.com")) return "igdb";
  if (isHost(host, "steamgriddb.com")) return "steamgriddb";
  if (isHost(host, "steamstatic.com") || isHost(host, "steampowered.com") || isHost(host, "steamcommunity.com") || isHost(host, "steamusercontent.com") || host === "steamcdn-a.akamaihd.net") return "steam";
  return "custom";
}

export type ImageSet = { source: ImageSource; label: string; items: Array<{ url: string; index: number }> };

/** Groups images by source, keeping first-seen order; `index` is the position in the original list. */
export function groupBySource(urls: string[]): ImageSet[] {
  const sets = new Map<ImageSource, ImageSet>();
  urls.forEach((url, index) => {
    const source = imageSourceOf(url);
    let set = sets.get(source);
    if (!set) { set = { source, label: creditFor(source), items: [] }; sets.set(source, set); }
    set.items.push({ url, index });
  });
  return [...sets.values()];
}

export const creditFor = (source: ImageSource) => (source === "custom" ? "Images you added" : `Images from ${imageSourceLabels[source]}`);
