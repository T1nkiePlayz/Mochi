// TEMPORARY STUB: another worker owns the real implementation of this module. Keep theirs when merging.
export type ArtworkCandidate = {
  id: string;
  provider: "steamgriddb" | "igdb" | "steam";
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  style?: string;
  author?: string;
};

export async function searchArtwork(_query: string, _opts?: { provider?: "steamgriddb" | "igdb" | "all" }): Promise<ArtworkCandidate[]> {
  return [];
}
