import { afterEach, describe, expect, it, vi } from "vitest";
import { getNexusGames, getNexusMods } from "./nexus";

const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
afterEach(() => vi.unstubAllGlobals());

describe("keyless Nexus catalog", () => {
  it("lists mods from the public GraphQL API without any key header, most downloaded first", async () => {
    const fetchMock = vi.fn(async () => reply({ mods: { totalCount: 2, nodes: [{ modId: 2400, name: "SMAPI", summary: "Loader", thumbnailUrl: "https://staticdelivery.nexusmods.com/t.png", author: "Pathoschild" }, { modId: "x", name: "bad" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await getNexusMods(null, "stardewvalley", { offset: 80, limit: 500 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.nexusmods.com/v2/graphql");
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("apikey");
    expect(headers["Application-Name"]).toBe("Mochi");
    const body = JSON.parse(String(init.body));
    expect(body.query).toContain("downloads: { direction: DESC }");
    expect(body.variables).toEqual({ domain: "stardewvalley", count: 80, offset: 80 });
    expect(page).toEqual({ total: 2, offset: 80, mods: [{ id: "2400", modId: 2400, name: "SMAPI", author: "Pathoschild", summary: "Loader", pictureUrl: "https://staticdelivery.nexusmods.com/t.png", modPageUrl: "https://www.nexusmods.com/stardewvalley/mods/2400" }] });
  });

  it("reports an HTTP failure readably", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(getNexusMods(null, "stardewvalley")).rejects.toThrow("HTTP 503");
  });

  it("searches games by name and normalises them", async () => {
    const fetchMock = vi.fn(async () => reply({ games: { nodes: [{ id: 1303, name: "Stardew Valley", domainName: "stardewvalley", modCount: 34410, genre: "Simulation" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const games = await getNexusGames(null, "stardew");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).variables.filter).toEqual({ name: { value: "stardew", op: "WILDCARD" } });
    expect(games).toEqual([{ id: "1303", name: "Stardew Valley", domainName: "stardewvalley", modCount: 34410, genre: "Simulation" }]);
  });
});
