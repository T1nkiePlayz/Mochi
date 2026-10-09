// Unit tests for the pure mod helpers. Run with `npm run test:mods` (Node 22.18+ strips TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isMinecraftJava, modSupportOf, normalizeGameName } from "../src/lib/mods/gameSupport.ts";
import { autoModLinks, bestNameMatch, dedupeKey, mergeModLinks } from "../src/lib/mods/gameMatch.ts";
import { safeHttpUrl, sanitizeHtml, textOf } from "../src/lib/mods/sanitizeHtml.ts";
import { pickBestFile, restrictedReason } from "../src/lib/mods/helpers.ts";

test("Minecraft Java detection", () => {
  assert.equal(isMinecraftJava({ name: "Minecraft" }), true);
  assert.equal(isMinecraftJava({ name: "Minecraft: Java Edition" }), true);
  assert.equal(isMinecraftJava({ name: "Minecraft 1.21.4 (Prism)" }), true);
  assert.equal(isMinecraftJava({ name: "Whatever", igdbId: 121 }), true);
  for (const name of ["Minecraft Dungeons", "Minecraft Legends", "Minecraft Earth", "Minecraft: Story Mode", "Minecraft Education Edition", "Minecraft Bedrock Launcher", "Terraria", "Minesweeper", "Prism Launcher"]) {
    assert.equal(isMinecraftJava({ name }), false, name);
  }
  assert.equal(isMinecraftJava({ name: "Terraria", modLinks: { minecraft: true, source: "user" } }), true);
  assert.equal(isMinecraftJava({ name: "Minecraft", modLinks: { minecraft: false, source: "user" } }), false);
});

test("modSupportOf separates Minecraft, other games and launchers", () => {
  assert.equal(modSupportOf({ name: "Minecraft" }), "minecraft");
  assert.equal(modSupportOf({ name: "Stardew Valley" }), "ecosystem");
  assert.equal(modSupportOf({ name: "Steam", kind: "launcher" }), "none");
});

test("normalizeGameName", () => {
  assert.equal(normalizeGameName("Pokémon™: Red & Blue (2024)"), "pokemon red and blue");
});

test("name matching", () => {
  const games = [{ name: "Stardew Valley", slug: "stardew-valley" }, { name: "Terraria", slug: "terraria" }, { name: "Skyrim Special Edition", slug: "skyrimspecialedition" }, { name: "Skyrim VR", slug: "skyrimvr" }];
  assert.equal(bestNameMatch("Stardew Valley", games)?.slug, "stardew-valley");
  assert.equal(bestNameMatch("stardewvalley", games)?.slug, "stardew-valley");
  assert.equal(bestNameMatch("The Elder Scrolls V: Skyrim", games), null);
  assert.equal(bestNameMatch("Skyrim", games)?.slug, "skyrimspecialedition");
  assert.equal(bestNameMatch("Terraria Remastered", games)?.slug, "terraria");
  assert.equal(bestNameMatch("Terrarium", games), null);
  assert.equal(dedupeKey("The Witcher 3"), dedupeKey("Witcher 3"));
});

test("autoModLinks and mergeModLinks keep user choices", () => {
  const links = autoModLinks({ name: "Stardew Valley" }, [{ id: 669, name: "Stardew Valley", slug: "stardewvalley" }], [{ name: "Stardew Valley", domainName: "stardewvalley" }]);
  assert.deepEqual(links, { source: "auto", curseforge: { gameId: 669, slug: "stardewvalley", name: "Stardew Valley" }, nexus: { domain: "stardewvalley", name: "Stardew Valley" } });
  assert.equal(autoModLinks({ name: "Nothing" }, [], []), undefined);
  const user = { source: "user", nexus: { domain: "x", name: "X" } };
  assert.equal(mergeModLinks(user, links), user);
  assert.deepEqual(mergeModLinks(undefined, links), links);
});

test("sanitizer drops scripts, handlers and bad URLs", () => {
  const nodes = sanitizeHtml(`<p onclick="x()">Hi <b>there</b><script>alert(1)</script></p><a href="javascript:alert(1)">bad</a><a href=" JaVa\nscript:x">bad2</a><a href="https://ex.com/a?b=1&amp;c=2" target="_blank" onmouseover="x">ok</a><iframe src="https://e.com">no</iframe><img src="https://evil.com/x.png"><img src="https://media.forgecdn.net/a.png" onerror="x">`);
  const json = JSON.stringify(nodes);
  assert.ok(!/script|alert|onclick|onerror|onmouseover|javascript|evil|iframe/i.test(json), json);
  assert.ok(json.includes("https://ex.com/a?b=1&c=2"));
  assert.ok(json.includes("media.forgecdn.net"));
  assert.equal(textOf(nodes), "Hi therebadbad2ok");
  assert.equal(safeHttpUrl("//cdn.example.com/x"), "https://cdn.example.com/x");
  assert.equal(safeHttpUrl("data:text/html,x"), null);
  assert.equal(safeHttpUrl("ftp://x.y"), null);
});

test("sanitizer survives malformed and hostile input", () => {
  assert.equal(textOf(sanitizeHtml("<div><p>open <b>bold</p> after</div> <<<>>> &lt;script&gt;")), "open bold after <<<>>> <script>");
  assert.doesNotThrow(() => sanitizeHtml("<".repeat(100000)));
  assert.doesNotThrow(() => sanitizeHtml("<div>".repeat(5000)));
  assert.deepEqual(sanitizeHtml("<style>p{}</style>x<!-- c -->y"), ["x", "y"]);
  assert.equal(textOf(sanitizeHtml("<script>a<script>b</script>c</script>d")), "d");
});

test("pickBestFile prefers releases, then newest", () => {
  const files = [
    { id: 1, releaseType: 2, fileDate: "2024-03-01" }, { id: 2, releaseType: 1, fileDate: "2024-01-01" }, { id: 3, releaseType: 1, fileDate: "2024-02-01" },
  ];
  assert.equal(pickBestFile(files)?.id, 3);
  assert.equal(pickBestFile([{ id: 9, releaseType: 3, fileDate: "2024-01-01" }])?.id, 9);
  assert.equal(pickBestFile([]), undefined);
});

test("restrictedReason", () => {
  assert.match(restrictedReason({ allowModDistribution: false }, { downloadUrl: "https://x" }) ?? "", /author/i);
  assert.match(restrictedReason({ allowModDistribution: true }, { downloadUrl: null }) ?? "", /author/i);
  assert.equal(restrictedReason({ allowModDistribution: true }, { downloadUrl: "https://edge.forgecdn.net/x" }), null);
});

test("isLinkedTo ranks Tofu targets by ecosystem", async () => {
  const { isLinkedTo } = await import("../src/lib/mods/gameSupport.ts");
  const stardew = { name: "Stardew Valley", modLinks: { curseforge: { gameId: 669, slug: "stardewvalley", name: "Stardew Valley" }, nexus: { domain: "stardewvalley", name: "Stardew Valley" }, source: "auto" } };
  assert.equal(isLinkedTo(stardew, { source: "curseforge", gameId: 669 }), true);
  assert.equal(isLinkedTo(stardew, { source: "nexus", domain: "stardewvalley" }), true);
  assert.equal(isLinkedTo(stardew, { source: "curseforge", gameId: 432 }), false);
  assert.equal(isLinkedTo({ name: "Minecraft" }, { source: "curseforge", gameId: 432 }), true);
  assert.equal(isLinkedTo({ name: "Minecraft" }, { source: "modrinth" }), true);
  assert.equal(isLinkedTo(stardew, { source: "modrinth" }), false);
});

test("resolveSources applies source priority", async () => {
  const { resolveSources, allSourcesOn, minecraftSourceFor, tabSource, isPublicCurseforgeGame } = await import("../src/lib/mods/resolveSources.ts");
  const both = { curseforge: true, nexus: true, nexusKey: true };
  assert.deepEqual(resolveSources(both, allSourcesOn), ["curseforge"]);
  assert.deepEqual(resolveSources(both, { ...allSourcesOn, curseforge: false }), ["nexus"]);
  assert.deepEqual(resolveSources({ nexus: true, nexusKey: true }, allSourcesOn), ["nexus"]);
  // Browsing Nexus needs no key (public GraphQL catalog), so a game on Nexus resolves to it either way.
  assert.deepEqual(resolveSources({ nexus: true, nexusKey: false }, allSourcesOn), ["nexus"]);
  assert.deepEqual(resolveSources({ nexus: true, nexusKey: true }, { ...allSourcesOn, nexus: false }), []);
  assert.deepEqual(resolveSources({ curseforge: true }, { ...allSourcesOn, curseforge: false, nexus: false }), []);
  assert.deepEqual(resolveSources({ minecraft: true }, allSourcesOn), ["modrinth", "curseforge"]);
  assert.deepEqual(resolveSources({ minecraft: true }, { ...allSourcesOn, modrinth: false }), ["curseforge"]);
  assert.deepEqual(resolveSources({ minecraft: true }, { ...allSourcesOn, curseforge: false }), ["modrinth"]);
  assert.deepEqual(resolveSources({ minecraft: true }, { modrinth: false, curseforge: false, nexus: true }), []);
  const noModrinth = { ...allSourcesOn, modrinth: false };
  for (const kind of ["mod", "modpack", "resourcepack", "shader", "world"]) assert.equal(minecraftSourceFor(kind, "modrinth", noModrinth), "curseforge", kind);
  assert.equal(minecraftSourceFor("world", "modrinth", allSourcesOn), "curseforge");
  assert.equal(minecraftSourceFor("mod", "modrinth", allSourcesOn), "modrinth");
  assert.equal(minecraftSourceFor("mod", "curseforge", { ...allSourcesOn, curseforge: false }), "modrinth");
  assert.equal(minecraftSourceFor("mod", "curseforge", { modrinth: false, curseforge: false, nexus: true }), null);
  assert.equal(tabSource({ onCurseforge: true, onNexus: true }, allSourcesOn, true), "curseforge");
  assert.equal(tabSource({ onCurseforge: false, onNexus: true }, allSourcesOn, false), null);
  assert.equal(isPublicCurseforgeGame({ apiStatus: 2 }), true);
  assert.equal(isPublicCurseforgeGame({ apiStatus: 1 }), false);
  assert.equal(isPublicCurseforgeGame({}), false);
});
