/**
 * Dev-server fakes for the mod sites. They answer the Supabase edge function calls (`curseforge-proxy` and the
 * `nexus-*` actions of `store-provider-credentials`) so Discover and the game pages can be previewed in a browser.
 *
 * Fixtures: Minecraft, Terraria and Stardew Valley are on CurseForge; Stardew Valley is also on Nexus Mods (so it
 * must show ONE CurseForge tab; Terraria returns a single CurseForge project like the real API and also exists on Nexus,
 * so Discover must add Nexus mods and say why; Balatro and "RuneScape: Dragonwilds" are Nexus-only); "Cyberpunk 2077" is Nexus-only; "Hidden Test Game" has apiStatus 1 and must never
 * be listed. Add `?premium` to the dev URL to pretend the Nexus account is Premium.
 */
type Json = Record<string, unknown>;

const cfGames = [
  { id: 432, name: "Minecraft", slug: "minecraft", status: 1, apiStatus: 2 },
  { id: 431, name: "Terraria", slug: "terraria", status: 1, apiStatus: 2 },
  { id: 669, name: "Stardew Valley", slug: "stardewvalley", status: 1, apiStatus: 2 },
  { id: 69271, name: "Minecraft Dungeons", slug: "minecraft-dungeons", status: 1, apiStatus: 2 },
  { id: 83374, name: "Satisfactory", slug: "satisfactory", status: 1, apiStatus: 2 },
  { id: 78, name: "The Sims 4", slug: "sims4", status: 1, apiStatus: 2 },
  { id: 1, name: "World of Warcraft", slug: "wow", status: 1, apiStatus: 2 },
  { id: 80000, name: "Starfield", slug: "starfield", status: 1, apiStatus: 2 },
  { id: 70667, name: "Hidden Test Game", slug: "hidden-test-game", status: 1, apiStatus: 1 },
].map((game) => ({ ...game, assets: { iconUrl: "", tileUrl: "", coverUrl: "" } }));

const mcClasses: Record<number, string> = { 6: "Mods", 4471: "Modpacks", 12: "Resource Packs", 6552: "Shaders", 17: "Worlds" };
type Category = { id: number; name: string; isClass?: boolean; classId?: number };
const categories = (gameId: number): Category[] => gameId === 432
  ? [{ id: 6, name: "Mc Mods", isClass: true }, { id: 406, name: "World Gen", classId: 6 }, { id: 407, name: "Magic", classId: 6 }, { id: 410, name: "Technology", classId: 6 }]
  : [{ id: 9001, name: "Gameplay" }, { id: 9002, name: "Graphics" }, { id: 9003, name: "Quality of Life" }, { id: 9004, name: "Characters" }];

const words = ["Better", "Ultimate", "Tiny", "Mega", "Lucky", "Shiny", "Hardcore", "Cozy", "Rapid", "Ancient", "Neon", "Wild"];
const nouns = ["Backpacks", "Tools", "Farming", "Lighting", "Maps", "Inventory", "Pets", "Weather", "Furniture", "Combat", "Cooking", "Fishing"];
const modsFor = (gameId: number, classId?: number) => Array.from({ length: gameId === 431 ? 1 : 140 }, (_, index) => { // Terraria: the real CurseForge API shares only 1 project with apps
  const id = gameId * 1000 + index + 1 + (classId ? classId * 7 : 0);
  const name = `${words[index % words.length]} ${nouns[(index * 5) % nouns.length]} ${Math.floor(index / 12) + 1}`;
  const game = cfGames.find((candidate) => candidate.id === gameId);
  return {
    id, gameId, name, slug: name.toLowerCase().replace(/\W+/g, "-"), classId: classId ?? 0, summary: `${name} adds a small, polished change to ${game?.name ?? "the game"} (${classId ? mcClasses[classId] : "mod"}).`,
    downloadCount: 9_000_000 - index * 53_000, authors: [{ id: 1, name: `Author${index % 9}` }], categories: [{ id: 406, name: "World Gen" }],
    logo: null, links: { websiteUrl: `https://www.curseforge.com/${game?.slug ?? "game"}/mods/${name.toLowerCase().replace(/\W+/g, "-")}` },
    allowModDistribution: index % 11 === 4 ? false : true, dateModified: new Date(Date.now() - index * 86_400_000).toISOString(),
  };
});

const description = (name: string) => `<h2>${name}</h2><p>A <b>demo</b> description with a <a href="https://www.curseforge.com/">link</a> and an unsafe <a href="javascript:alert(1)">one</a>.</p>
<script>alert("must never run")</script><p onclick="alert(1)">Click handlers are stripped.</p><ul><li>Feature one</li><li>Feature two</li></ul>
<iframe src="https://example.com"></iframe><table><tr><th>Option</th><th>Default</th></tr><tr><td>Speed</td><td>1.0</td></tr></table><img src="https://tracker.example.com/pixel.png" alt="blocked image">`;

const filesFor = (modId: number) => [0, 1, 2].map((offset) => {
  const id = modId * 10 + offset;
  const restricted = id % 7 === 0;
  return {
    id, modId, displayName: `Release ${3 - offset}.0`, fileName: `mod-${modId}-${3 - offset}.0.${modId % 2 ? "jar" : "zip"}`, releaseType: offset === 2 ? 2 : 1,
    fileDate: new Date(Date.now() - offset * 30 * 86_400_000).toISOString(), fileLength: 800_000 + offset * 90_000, isAvailable: true,
    downloadUrl: restricted ? null : `https://edge.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/mod-${modId}.zip`,
    gameVersions: ["1.21.1", "Fabric"], hashes: [{ value: "da39a3ee5e6b4b0d3255bfef95601890afd80709", algo: 1 }],
    // Dependency fixtures: +1 required, +2 optional (ignored), mod 360438 is "installed" in devInstancesMock (required when id%4==2, incompatible when id%4==1).
    dependencies: offset === 0 ? [{ modId: modId + 1, relationType: 3 }, { modId: modId + 2, relationType: 2 }, ...(modId % 4 === 2 ? [{ modId: 360438, relationType: 3 }] : []), ...(modId % 4 === 1 ? [{ modId: 360438, relationType: 5 }] : [])] : [],
  };
});

function curseforge(body: Json): { status: number; json: unknown } {
  const num = (key: string, fallback = 0) => Number(body[key] ?? fallback);
  switch (body.route) {
    case "games": return { status: 200, json: { data: cfGames.slice(num("index"), num("index") + num("pageSize", 50)), pagination: { index: num("index"), pageSize: num("pageSize", 50), resultCount: cfGames.length, totalCount: cfGames.length } } };
    case "categories": return { status: 200, json: { data: categories(num("gameId")).filter((category) => !body.classId || category.classId === num("classId") || category.isClass) } };
    case "search": {
      const text = String(body.searchFilter ?? "").toLowerCase();
      const all = modsFor(num("gameId"), body.classId ? num("classId") : undefined).filter((mod) => !text || mod.name.toLowerCase().includes(text));
      if (body.sortField === 4) all.sort((a, b) => a.name.localeCompare(b.name));
      const index = num("index"); const size = Math.min(50, num("pageSize", 30));
      const data = all.slice(index, index + size);
      return { status: 200, json: { data, pagination: { index, pageSize: size, resultCount: data.length, totalCount: all.length } } };
    }
    case "mod": return { status: 200, json: { data: { ...modsFor(Math.floor(num("modId") / 1000), undefined)[0], id: num("modId"), name: `Mod ${num("modId")}` } } };
    case "description": return { status: 200, json: { data: description(`Mod ${num("modId")}`) } };
    case "files": return { status: 200, json: { data: filesFor(num("modId")), pagination: { index: 0, pageSize: 30, resultCount: 3, totalCount: 3 } } };
    case "fingerprints": {
      // Every third fingerprint is "known", as mod 1000 + fingerprint.
      const prints = (body.fingerprints as number[] | undefined) ?? [];
      const exactMatches = prints.filter((print) => print % 3 === 0).map((print) => ({ id: 1000 + print, file: { ...filesFor(1000 + print)[0], fileFingerprint: print } }));
      return { status: 200, json: { data: { isCacheBuilt: true, exactMatches, exactFingerprints: exactMatches.map((match) => match.file.fileFingerprint), unmatchedFingerprints: prints.filter((print) => print % 3 !== 0) } } };
    }
    case "download-url": { const file = filesFor(num("modId")).find((entry) => entry.id === num("fileId")); return { status: 200, json: { data: file?.downloadUrl ?? null, restricted: !file?.downloadUrl } }; }
    default: return { status: 400, json: { error: "Unknown route.", code: "bad_request" } };
  }
}

const nexusGames = [
  { id: "1303", name: "Stardew Valley", domain_name: "stardewvalley", mods: 90_000 },
  { id: "3333", name: "Cyberpunk 2077", domain_name: "cyberpunk2077", mods: 60_000 },
  { id: "1049", name: "Terraria", domain_name: "terraria", mods: 160 },
  { id: "6543", name: "Balatro", domain_name: "balatro", mods: 740 },
  { id: "6600", name: "RuneScape: Dragonwilds", domain_name: "runescapedragonwilds", mods: 300 },
  { id: "3279", name: "Minecraft Dungeons", domain_name: "minecraftdungeons", mods: 165 },
];
const nexusMods = (domain: string) => Array.from({ length: 260 }, (_, index) => ({
  id: String(index + 1), modId: index + 1, name: `${domain} mod ${index + 1}`, author: `Modder${index % 7}`, summary: "A generated Nexus Mods entry for the dev server.",
  modPageUrl: `https://www.nexusmods.com/${domain}/mods/${index + 1}`,
}));
const premium = () => new URLSearchParams(location.search).has("premium");

function nexus(body: Json): { status: number; json: unknown } | null {
  switch (body.action) {
    case "status": return { status: 200, json: { providers: ["nexus"] } };
    case "nexus-status": return { status: 200, json: { configured: true, premium: premium(), name: "DevUser" } };
    case "nexus-games": return { status: 200, json: { games: nexusGames.filter((game) => !body.query || game.name.toLowerCase().includes(String(body.query).toLowerCase())) } };
    case "nexus-mods": {
      const all = nexusMods(String(body.gameDomain)); const offset = Number(body.offset ?? 0); const limit = Number(body.limit ?? 25);
      return { status: 200, json: { mods: all.slice(offset, offset + limit), total: all.length, offset } };
    }
    case "nexus-mod": return { status: 200, json: { id: Number(body.modId), name: `Nexus mod ${body.modId}`, summary: "Summary", description: "[b]Bold BBCode[/b]<br />A <b>HTML</b> body.", author: "Modder1", version: "1.2.0", endorsements: 4321, modPageUrl: `https://www.nexusmods.com/${body.gameDomain}/mods/${body.modId}` } };
    case "nexus-files": return { status: 200, json: { files: [{ fileId: Number(body.modId) * 10, name: "Main file", fileName: "main-1.2.0.zip", version: "1.2.0", category: "MAIN", sizeKb: 2048, uploadedAt: new Date().toISOString(), primary: true }, { fileId: Number(body.modId) * 10 + 1, name: "Optional", fileName: "optional.zip", version: "1.0", category: "OPTIONAL", sizeKb: 300, primary: false }] } };
    case "nexus-md5": return { status: 200, json: { matches: String(body.md5).endsWith("1") ? [{ modId: 77, fileId: 770, name: "Mock Nexus mod", fileVersion: "1.0", fileName: "mock.zip", uploadedAt: 1_700_000_000, modPageUrl: `https://www.nexusmods.com/${body.gameDomain}/mods/77` }] : [] } };
    case "nexus-download": return premium() || body.key
      ? { status: 200, json: { url: "https://premium-files.nexus-cdn.com/mock/file.zip", fileName: "main-1.2.0.zip" } }
      : { status: 403, json: { error: "Direct downloads need Nexus Mods Premium.", code: "premium_required" } };
    default: return null;
  }
}

export function installModsMock() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Nexus requirements come straight from the public GraphQL API; every mod requires mod 1 and one outside site.
    if (url.includes("api.nexusmods.com/v2/graphql") && typeof init?.body === "string" && init.body.includes("modRequirements")) {
      const nodes = [{ modId: "1", modName: "Mock Framework", gameId: "1", url: "", externalRequirement: false }, { modId: "9", modName: "Script Extender (outside Nexus)", gameId: "1", url: "https://example.com/extender", externalRequirement: true }];
      return new Response(JSON.stringify({ data: { legacyModsByDomain: { nodes: [{ modId: 5, gameId: 1, modRequirements: { nexusRequirements: { nodes } } }] } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const target = url.includes("/functions/v1/curseforge-proxy") ? "cf" : url.includes("/functions/v1/store-provider-credentials") ? "nexus" : "";
    if (target && typeof init?.body === "string") {
      let body: Json = {};
      try { body = JSON.parse(init.body) as Json; } catch { /* leave empty */ }
      const reply = target === "cf" ? curseforge(body) : nexus(body);
      if (reply) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
      }
    }
    return realFetch(input, init);
  };
}
