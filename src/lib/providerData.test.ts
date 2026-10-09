import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { gamesWithArtworkFrom, withoutArtwork } from "./providerData";

const game = (id: string, over: Partial<Piko> = {}): Piko => ({ id, name: id, description: "", accent: "#fff", artwork: "", tofus: [], artworkCacheKey: `k-${id}`, ...over });

describe("provider data", () => {
  const library = [game("a", { artworkSource: "igdb" }), game("b", { artworkSource: "steam" }), game("c", { artworkSource: "custom" }), game("d"), game("e", { artworkSource: "igdb", artworkCacheKey: undefined })];
  it("finds each source's cover files independently", () => {
    expect(gamesWithArtworkFrom(library, "igdb").map((g) => g.id)).toEqual(["a"]);
    expect(gamesWithArtworkFrom(library, "steam").map((g) => g.id)).toEqual(["b"]);
    expect(gamesWithArtworkFrom(library, "custom-artwork").map((g) => g.id)).toEqual(["c"]);
    expect(gamesWithArtworkFrom(library, "steamgriddb")).toEqual([]);
    expect(gamesWithArtworkFrom(library, "steam-achievements")).toEqual([]);
  });
  it("forgets the cover but keeps the cache key, and unlocks custom artwork", () => {
    const cleared = withoutArtwork(game("c", { artworkSource: "custom", artworkUrl: "https://x/y.jpg", artwork: "url(x)", lockedFields: ["artwork", "name"] }));
    expect(cleared).toMatchObject({ artwork: "", artworkCacheKey: "k-c", lockedFields: ["name"] });
    expect(cleared.artworkUrl).toBeUndefined();
    expect(cleared.artworkSource).toBeUndefined();
  });
});
