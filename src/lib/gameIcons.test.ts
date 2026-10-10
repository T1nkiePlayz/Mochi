import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupGameIcon } from "./gameIcons";

function clientReturning(games: Array<{ name: string; cover?: { url?: string } }>) {
  const invoke = vi.fn(async () => ({ data: { games }, error: null }));
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

describe("shared game icon lookup", () => {
  it("shares in-flight requests and caches a successful artwork URL", async () => {
    const { client, invoke } = clientReturning([{ name: "Icon Cache Regression Game", cover: { url: "//images.igdb.com/igdb/image/upload/t_thumb/co123.jpg" } }]);
    const key = "icon-cache-regression-game";
    const [first, second] = await Promise.all([
      lookupGameIcon(client, key, "Icon Cache Regression Game"),
      lookupGameIcon(client, key, "Icon Cache Regression Game"),
    ]);
    expect(first).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg");
    expect(second).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await lookupGameIcon(client, key, "Icon Cache Regression Game")).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not use a sequel's artwork when the title does not match exactly", async () => {
    const { client } = clientReturning([{ name: "Example Game 2", cover: { url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co999.jpg" } }]);
    expect(await lookupGameIcon(client, "icon-exact-match-regression", "Example Game")).toBeNull();
  });
});
