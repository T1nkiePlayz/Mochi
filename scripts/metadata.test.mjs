// Unit tests for the pure metadata helpers. Run with `npm run test:metadata` (Node 22.18+ strips TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMetadata, mergeText, pickGrid, planProviders, steamAppIdOf } from "../src/lib/metadata/merge.ts";

const base = { id: "steam:220", name: "Half-Life 2", description: "mine", accent: "#fff", artwork: "", tofus: [], sourceId: "steam" };
const ready = { igdb: true, steamgriddb: true };

test("steamAppIdOf reads imported Steam ids and rungameid targets", () => {
  assert.equal(steamAppIdOf(base), 220);
  assert.equal(steamAppIdOf({ id: "custom-1", executablePath: "steam://rungameid/105600" }), 105600);
  assert.equal(steamAppIdOf({ id: "custom-1", executablePath: "/usr/bin/game" }), null);
  assert.equal(steamAppIdOf({ id: "steam:abc", sourceId: "steam" }), null);
});

test("auto plan prefers SteamGridDB art, then IGDB, then Steam", () => {
  assert.deepEqual(planProviders("auto", ready, 220), { text: ["igdb", "steam"], art: ["steamgriddb", "igdb", "steam"] });
  assert.deepEqual(planProviders("auto", { igdb: false, steamgriddb: false }, 220), { text: ["steam"], art: ["steam"] });
  assert.deepEqual(planProviders("auto", { igdb: false, steamgriddb: false }, null), { text: [], art: [] });
});

test("explicit choices restrict providers", () => {
  assert.deepEqual(planProviders("igdb", ready, 220), { text: ["igdb"], art: ["igdb"] });
  assert.deepEqual(planProviders("steamgriddb", ready, 220), { text: [], art: ["steamgriddb"] });
  assert.deepEqual(planProviders("steamgriddb", { igdb: true, steamgriddb: false }, 220), { text: [], art: [] });
});

test("pickGrid prefers 600x900, then portrait, then anything", () => {
  const items = [{ width: 920, height: 430, id: 1 }, { width: 342, height: 482, id: 2 }, { width: 600, height: 900, id: 3 }];
  assert.equal(pickGrid(items).id, 3);
  assert.equal(pickGrid(items.slice(0, 2)).id, 2);
  assert.equal(pickGrid(items.slice(0, 1)).id, 1);
  assert.equal(pickGrid([]), undefined);
});

test("mergeText: first provider wins per field", () => {
  const merged = mergeText([{ description: "igdb text", categories: [] }, { description: "steam text", categories: ["Action"], firstReleaseDate: 5 }]);
  assert.equal(merged.description, "igdb text");
  assert.deepEqual(merged.categories, ["Action"]);
  assert.equal(merged.firstReleaseDate, 5);
});

test("applyMetadata never overwrites locked fields or custom artwork", () => {
  const text = { name: "New", description: "new", categories: ["RPG"] };
  const art = { source: "steamgriddb", url: "https://cdn2.steamgriddb.com/a.png" };
  const locked = applyMetadata({ ...base, lockedFields: ["description", "artwork"] }, { text, art });
  assert.equal(locked.description, "mine");
  assert.equal(locked.name, "New");
  assert.equal(locked.artworkUrl, undefined);
  const custom = applyMetadata({ ...base, artworkSource: "custom", artworkUrl: "x" }, { text, art });
  assert.equal(custom.artworkUrl, "x");
  const open = applyMetadata(base, { text, art });
  assert.equal(open.artworkSource, "steamgriddb");
  assert.equal(open.artworkCacheKey, "steam-220");
  assert.deepEqual(open.categories, ["RPG"]);
});
