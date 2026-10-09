import { afterEach, describe, expect, it, vi } from "vitest";
import { getNexusRequirements } from "./nexus";

const reply = (data: unknown) => vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }));
afterEach(() => vi.unstubAllGlobals());

describe("getNexusRequirements", () => {
  it("reads the author's requirement list from the public GraphQL API without a key", async () => {
    const fetchMock = reply({ legacyModsByDomain: { nodes: [{ modId: 12604, gameId: 1704, modRequirements: { nexusRequirements: { nodes: [
      { modId: "30379", modName: "SKSE64", gameId: "1704", url: "", externalRequirement: false, notes: "" },
      { modId: "1", modName: "Outside", gameId: "1704", url: "https://example.com/x", externalRequirement: true, notes: "needed" },
      { modId: "x", modName: "Broken", gameId: "1704", url: "", externalRequirement: false },
    ] } } }] } });
    vi.stubGlobal("fetch", fetchMock);
    expect(await getNexusRequirements("skyrimspecialedition", 12604)).toEqual([
      { modId: 30379, name: "SKSE64", external: false, gameDomain: "skyrimspecialedition" },
      { modId: 1, name: "Outside", external: true, url: "https://example.com/x", notes: "needed" },
    ]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.stringify(init.headers)).not.toMatch(/apikey|authorization/i);
    expect(JSON.parse(init.body as string).variables).toEqual({ ids: [{ gameDomain: "skyrimspecialedition", modId: 12604 }] });
  });

  it("returns nothing for an invalid id without calling out", async () => {
    const fetchMock = reply({});
    vi.stubGlobal("fetch", fetchMock);
    expect(await getNexusRequirements("x", 0)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
