import { describe, expect, it } from "vitest";
import type { Piko, Tofu } from "../../models";
import { linkPack, markChecked, packArtKey, patchInstance, rematchPack, tofusNeedingPackArt, tofusToMatch, unlinkPack, withPackArt } from "./packLink";

const tofu = (id: string, over: Partial<Tofu> = {}): Tofu => ({ id, name: id, version: "1.21.1", runtime: "prism", mods: 0, status: "Ready", loader: "fabric", launchTarget: `mc-instance://prism/${id}`, ...over });
const library = (tofus: Tofu[]): Piko[] => [{ id: "minecraft", name: "Minecraft", description: "", accent: "#fff", artwork: "", tofus }];

describe("pack link state", () => {
  it("picks instances that are unlinked, unchecked and have a version and loader", () => {
    const lib = library([tofu("a"), tofu("b", { pack: { source: "modrinth", projectId: "x", matchedBy: "managed" } }), tofu("c", { packCheckedAt: 1 }), tofu("d", { loader: "vanilla" }), tofu("e", { version: "Imported" })]);
    expect(tofusToMatch(lib).map((item) => item.id)).toEqual(["a"]);
    expect(tofusToMatch(lib, new Set(["a"]))).toEqual([]);
  });
  it("links, remembers a miss, and re-runs", () => {
    const lib = library([tofu("a"), tofu("b")]);
    const linked = patchInstance(lib, "a", linkPack({ source: "modrinth", projectId: "p", matchedBy: "search" }));
    expect(linked[0].tofus[0].pack?.projectId).toBe("p");
    expect(linked[0].tofus[1]).toBe(lib[0].tofus[1]);
    const missed = patchInstance(lib, "a", markChecked(5))[0].tofus[0];
    expect(missed.packCheckedAt).toBe(5);
    expect(rematchPack(missed).packCheckedAt).toBeUndefined();
  });
  it("gives a Modrinth pack's icon only to instances without a cover, and unlink removes just that cover", () => {
    const pack = { source: "modrinth" as const, projectId: "p", matchedBy: "search" as const };
    expect(tofusNeedingPackArt(library([tofu("a", { pack }), tofu("b", { pack, artwork: "own" }), tofu("c", { pack: { ...pack, source: "curseforge" } })])).map((item) => item.id)).toEqual(["a"]);
    const art = withPackArt("https://cdn/icon.png", packArtKey("a"))(tofu("a", { pack }));
    expect(art.artworkCacheKey).toBe("mc-pack-a");
    expect(withPackArt("u", "k")(tofu("b", { artwork: "own" })).artwork).toBe("own");
    const unlinked = unlinkPack(9)(art);
    expect(unlinked).toMatchObject({ packCheckedAt: 9, artwork: undefined, artworkCacheKey: undefined });
    expect(unlinked.pack).toBeUndefined();
    expect(unlinkPack(9)(tofu("b", { pack, artwork: "own", artworkCacheKey: "custom" })).artwork).toBe("own");
  });
});
