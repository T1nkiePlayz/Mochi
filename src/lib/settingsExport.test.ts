// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { defaultBehavior } from "../state/settings";
import { defaultSoundSettings } from "./sound/settings";
import { defaultControllerSettings } from "../controller/settings";
import { defaultAccessibility } from "../state/accessibility";
import {
  EXPORT_STORAGE_KEYS, SECTION_IDS, applyGameEntries, buildExportSections, buildGameEntries, checkManifest, findSecretPaths, isSecretName, mergeCollections,
  mergeOverrides, mergeWishlist, planImport, sanitizeLaunchOptions, sanitizeSections, scrubSecrets, type Selection, type Snapshot,
} from "./settingsExport";

const piko = (id: string, extra: Partial<Piko> = {}): Piko => ({ id, name: id, description: "", accent: "#fff", artwork: "", tofus: [], ...extra } as Piko);
const snapshot = (extra: Partial<Snapshot> = {}): Snapshot => ({
  behavior: defaultBehavior, appearance: { theme: "mochi", libraryView: "grid", librarySort: "category" }, sound: defaultSoundSettings, controller: defaultControllerSettings,
  accessibility: defaultAccessibility, collections: [], wishlist: [], launcherOverrides: {}, library: [], ...extra,
});
const all = (mode: "merge" | "replace" = "merge"): Selection => Object.fromEntries(SECTION_IDS.map((id) => [id, { enabled: true, mode }]));

// Fake credentials: if any of these strings appears in an export, the allowlist failed.
const SECRETS = ["sb-abc-auth-token-VALUE", "igdb-client-secret-VALUE", "steamgriddb-api-key-VALUE", "nexus-key-VALUE", "pw-VALUE", "jwt-VALUE", "session-VALUE"];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("sb-abc-auth-token", JSON.stringify({ access_token: SECRETS[0], refresh_token: SECRETS[5] }));
  window.localStorage.setItem("mochi:igdb-client-secret", SECRETS[1]);
  window.localStorage.setItem("mochi:steamgriddb-api-key", SECRETS[2]);
  window.localStorage.setItem("mochi:nexus", SECRETS[3]);
  window.localStorage.setItem("mochi:accounts", JSON.stringify([{ password: SECRETS[4], session: SECRETS[6] }]));
  window.localStorage.setItem("mochi:wishlist", JSON.stringify([{ id: "w", name: "Hades", addedAt: 1 }]));
});

describe("allowlist and denylist", () => {
  it("never reads a storage key that looks like a credential", () => {
    for (const key of Object.values(EXPORT_STORAGE_KEYS)) expect(isSecretName(key), key).toBe(false);
    expect(Object.values(EXPORT_STORAGE_KEYS).some((key) => key.startsWith("sb-"))).toBe(false);
  });
  it("recognises credential-looking names, but not importKey", () => {
    for (const name of ["sb-x-auth-token", "apiKey", "API_KEY", "client_secret", "Password", "access_token", "sessionId", "authorization", "nexusKey", "cookie"]) expect(isSecretName(name), name).toBe(true);
    for (const name of ["importKey", "name", "tags", "launchOptions", "volume", "theme"]) expect(isSecretName(name), name).toBe(false);
  });
  it("exports no secret value or field, whatever is in localStorage or the library", () => {
    const library = [piko("a", { importKey: "steam:1", tags: ["t"], launchOptions: { env: [["DXVK_HUD", "1"], ["STEAM_API_KEY", SECRETS[2]], ["MY_TOKEN", SECRETS[0]], ["Password", "pw"]], args: ["-windowed"] } })];
    const sections = buildExportSections(snapshot({ library, wishlist: [{ id: "w", name: "Hades", addedAt: 1 }] }), SECTION_IDS);
    const text = JSON.stringify(sections);
    for (const value of SECRETS) expect(text).not.toContain(value);
    expect(text).not.toContain("STEAM_API_KEY");
    expect(text).not.toContain("MY_TOKEN");
    expect(text).toContain("DXVK_HUD");
    expect(text).toContain("importKey");
    const { launcherOverrides: _skip, ...rest } = sections;
    expect(findSecretPaths(rest).filter((path) => !path.endsWith("importKey"))).toEqual([]);
  });
  it("only ever produces the allowlisted section files", () => {
    const sections = buildExportSections(snapshot(), SECTION_IDS);
    expect(Object.keys(sections).sort()).toEqual([...SECTION_IDS].sort());
    expect(Object.keys(buildExportSections(snapshot(), ["sound"]))).toEqual(["sound"]);
  });
  it("scrubSecrets drops credential-named fields deeply", () => {
    expect(scrubSecrets({ a: 1, token: "x", nested: { apiKey: "y", ok: [{ password: "z", fine: 2 }] } })).toEqual({ a: 1, nested: { ok: [{ fine: 2 }] } });
  });
  it("cleans launch options", () => {
    expect(sanitizeLaunchOptions({ env: [["OK", "1"], ["1BAD", "x"], ["SECRET_X", "y"], ["a b", "z"]], args: ["-a", 3], gamemode: true, runtime: { kind: "proton", id: "p" } })).toEqual({ env: [["OK", "1"]], args: ["-a"], gamemode: true, runtime: { kind: "proton", id: "p" } });
    expect(sanitizeLaunchOptions("nope")).toBeUndefined();
  });
});

describe("version check", () => {
  it("accepts version 1 and rejects other formats or versions", () => {
    expect(checkManifest({ format: "mochi-settings", version: 1 })).toEqual({ ok: true });
    expect(checkManifest({ format: "mochi-settings", version: 2 })).toMatchObject({ ok: false, error: expect.stringContaining("newer") });
    expect(checkManifest({ format: "mochi-settings", version: 0 }).ok).toBe(false);
    expect(checkManifest({ format: "mochi-settings", version: "1" }).ok).toBe(false);
    expect(checkManifest({ format: "other", version: 1 }).ok).toBe(false);
    expect(checkManifest(null).ok).toBe(false);
  });
});

describe("merge and replace", () => {
  const col = (id: string, name: string) => ({ id, name });
  it("merges collections by id, then by name, and maps ids", () => {
    const result = mergeCollections([col("a", "Cozy"), col("b", "RPG")], [col("a", "Renamed"), col("z", "cozy"), col("n", "New")], "merge");
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "n"]);
    expect(result.idMap.get("z")).toBe("a");
    expect(result.counts).toMatchObject({ added: 1, unchanged: 2 });
  });
  it("replaces collections", () => {
    const result = mergeCollections([col("a", "Cozy")], [col("n", "New")], "replace");
    expect(result.items).toEqual([col("n", "New")]);
    expect(result.counts).toMatchObject({ added: 1, removed: 1 });
  });
  it("merges the wishlist without duplicates and respects replace", () => {
    const a = { id: "1", name: "Hades", addedAt: 1 }, b = { id: "2", name: "hades", addedAt: 2 }, c = { id: "3", name: "Celeste", addedAt: 3 };
    expect(mergeWishlist([a], [b, c], "merge").items.map((item) => item.id)).toEqual(["1", "3"]);
    expect(mergeWishlist([a], [c], "replace").items).toEqual([c]);
  });
  it("merge keeps existing overrides, replace takes the file's", () => {
    expect(mergeOverrides({ a: "game" }, { a: "launcher", b: "launcher" }, "merge").items).toEqual({ a: "game", b: "launcher" });
    const replaced = mergeOverrides({ a: "game", c: "game" }, { a: "launcher" }, "replace");
    expect(replaced.items).toEqual({ a: "launcher" });
    expect(replaced.counts).toMatchObject({ changed: 1, removed: 1 });
  });
  it("applies per-game fields to games matched by id or import key", () => {
    const library = [piko("p1", { tags: ["x"], collectionIds: ["c1"] }), piko("p2", { importKey: "steam:2", backlog: { status: "playing", addedAt: 1 } }), piko("p3")];
    const entries = buildGameEntries([piko("q", { tags: ["y"] })]).concat([
      { id: "p1", tags: ["y"], collectionIds: ["old", "missing"], launchOptions: { env: [], args: ["-x"] } },
      { id: "other", importKey: "steam:2", backlog: { status: "finished", addedAt: 9 }, tags: ["z"] },
      { id: "nobody", tags: ["q"] },
    ]);
    const merged = applyGameEntries(library, entries.slice(1), "merge", new Map([["old", "c2"]]), new Set(["c1", "c2"]));
    expect(merged).toMatchObject({ matched: 2, unmatched: 1, changed: 2 });
    expect(merged.library[0]).toMatchObject({ tags: ["x", "y"], collectionIds: ["c1", "c2"], launchOptions: { args: ["-x"] } });
    expect(merged.library[1]).toMatchObject({ tags: ["z"], backlog: { status: "playing" } });
    expect(merged.library[2]).toBe(library[2]);
    const replaced = applyGameEntries(library, entries.slice(1), "replace", new Map([["old", "c2"]]), new Set(["c2"]));
    expect(replaced.library[0]).toMatchObject({ tags: ["y"], collectionIds: ["c2"] });
    expect(replaced.library[1]).toMatchObject({ backlog: { status: "finished" } });
  });
  it("round-trips an export into a clean device (replace) with the same data", () => {
    const source = snapshot({ collections: [{ id: "c", name: "Cozy" }], wishlist: [{ id: "w", name: "Hades", addedAt: 1 }], launcherOverrides: { "steam:1": "launcher" }, library: [piko("p", { tags: ["t"], collectionIds: ["c"] })] });
    const exported = JSON.parse(JSON.stringify(buildExportSections(source, SECTION_IDS)));
    const target = snapshot({ library: [piko("p")] });
    const result = planImport(target, sanitizeSections(exported), all("replace"));
    expect(result.next.collections).toEqual(source.collections);
    expect(result.next.wishlist).toEqual(source.wishlist);
    expect(result.next.launcherOverrides).toEqual(source.launcherOverrides);
    expect(result.next.library[0]).toMatchObject({ tags: ["t"], collectionIds: ["c"] });
    expect(result.changed).toEqual(expect.arrayContaining(["collections", "wishlist", "launcherOverrides", "games"]));
  });
  it("only touches sections the user ticked and reports no change when identical", () => {
    const current = snapshot({ collections: [{ id: "c", name: "Cozy" }] });
    const sections = sanitizeSections({ collections: [{ id: "n", name: "New" }], wishlist: [{ id: "w", name: "X", addedAt: 1 }] });
    const result = planImport(current, sections, { collections: { enabled: true, mode: "merge" }, wishlist: { enabled: false, mode: "merge" } });
    expect(result.next.wishlist).toEqual([]);
    expect(result.changed).toEqual(["collections"]);
    expect(result.summary.map((item) => item.id)).toEqual(["collections"]);
    expect(planImport(current, sanitizeSections({ collections: [{ id: "c", name: "Cozy" }] }), { collections: { enabled: true, mode: "merge" } }).changed).toEqual([]);
  });
  it("sanitizes hostile section data", () => {
    const sections = sanitizeSections({ behavior: "x", appearance: { theme: "../evil", libraryView: "nope", librarySort: 5 }, collections: [null, { id: 1 }, { id: "ok", name: "  " }], wishlist: "no", launcherOverrides: { a: "bad" }, games: [{ id: "g", launchOptions: { env: "no" }, backlog: { status: "bogus" } }] });
    expect(sections.appearance).toEqual({ theme: "", libraryView: "grid", librarySort: "category" });
    expect(sections.collections).toEqual([]);
    expect(sections.wishlist).toEqual([]);
    expect(sections.launcherOverrides).toEqual({});
    expect(sections.games).toEqual([{ id: "g", launchOptions: { env: [], args: [] } }]);
  });
});
