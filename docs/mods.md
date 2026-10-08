# Mods architecture

How Mochi finds and downloads mods. Read this before touching `src/lib/mods/`, `src/components/mods/` or `src/components/discover/`.

## Sources and priority

Three sources, each switchable under Settings > Mod sources (`Behavior.modSources`, all on by default). A switched-off source is never contacted and disappears from Discover, game pages, the Minecraft manager and downloads.

| Game | Sources shown (best first) |
|---|---|
| Minecraft: Java Edition | Modrinth and CurseForge, selectable. Modrinth off: every content type (mods 6, modpacks 4471, resource packs 12, shaders 6552) comes from CurseForge. CurseForge off: Modrinth only. Both off: a message pointing to Settings. |
| Any other game on CurseForge | CurseForge only. It replaces Nexus Mods for that game everywhere. A game on both sites has one CurseForge tab. |
| A game not on CurseForge (or CurseForge off) | Nexus Mods, only when the user saved a Nexus key and Nexus is on. |

All of this is one pure function: `resolveSources` in `src/lib/mods/resolveSources.ts` (also `minecraftSourceFor`, `tabSource`). Never re-implement the priority in a component.

## Layers

- `src/lib/curseforge.ts` typed wrapper over the `curseforge-proxy` edge function. Mochi owns the CurseForge API key; it lives only in the function's secret. Under the CurseForge API terms nothing from it may be saved or cached: the wrapper only de-duplicates identical in-flight requests, and the games list is held in memory for 10 minutes. Do not add persistent caches (no localStorage, disk, service worker). Only `apiStatus === 2` games are public; `cfAllGames` drops the rest.
- `src/lib/nexus.ts` Nexus actions (`nexus-games/mods/status/mod/files/download`) on `store-provider-credentials`, using the user's own key stored server-side.
- `src/lib/mods/types.ts` the common `ModSource` interface: `categories`, `search` (paged), `details`, `files`, `resolveDownload` -> `{ url, fileName, sha1?, size?, restricted?, needsPremium?, pageUrl }`. Implementations: `modrinthSource.ts`, `curseforgeSource.ts`, `nexusSource.ts`. A source object is already scoped to one game (or one Minecraft class).
- `src/lib/mods/install.ts` resolves a file and calls the native `start_mod_download` (`src/lib/downloads.ts`). The Rust side checks the host allow-list per provider, verifies SHA-1, and extracts `.zip` when the Tofu has `extractArchives`.
- `src/lib/mods/gameSupport.ts` (is this Minecraft Java, does a game belong to an ecosystem), `gameMatch.ts` (name matching), `sanitizeHtml.ts` (strict HTML allow-list), `helpers.ts`. These are pure with no runtime imports so `npm run test:mods` can run them with plain `node --test`.
- `src/state/useGameMods.ts` links a Piko to CurseForge/Nexus by normalised name once per session and stores the result in `piko.modLinks` (ids/slugs only; `source: "user"` entries are never overwritten).
- `src/components/mods/` UI: `GameMods` (game page entry; Minecraft keeps `ModrinthManager`), `ModsBrowser` (search, category, sort, infinite scroll, download), `ModCard`, `ModDetailsModal` (file picker, required dependencies, restricted notice), `LinkGameModal`, `SafeHtml`.
- `src/components/discover/` Discover tabs (`useDiscoverGames`, `AddGamePicker`, `ModrinthDiscover`). Every mod card has "Choose Tofu instance" (`TofuPicker`, lists Tofus of games linked to the mod's ecosystem first) and "View".

## Rules to keep

- CurseForge: show "Powered by CurseForge" and a "View on CurseForge" link; never construct forgecdn URLs; when the author disabled third-party downloads (`allowModDistribution === false` or no `downloadUrl`) show the message and "Open on CurseForge". Mod descriptions are HTML written by strangers: render only through `sanitizeHtml` / `SafeHtml`, never `dangerouslySetInnerHTML`.
- Nexus: premium members download through the API; free members get "Download on Nexus" opening `https://www.nexusmods.com/<game>/mods/<id>?tab=files`. Required dependencies are only listed with links; nothing is installed automatically.
- Offline: remote lists show an offline state with Retry; CurseForge data is never cached for offline use.

## Known limitation: nxm:// links

Free Nexus users could return from the site's "Mod Manager Download" button through an `nxm://` link. It is not implemented: the Tauri deep-link plugin only forwards schemes listed in `tauri.conf.json` (dynamic schemes are ignored by its single-instance handling), so it needs Rust changes in `main.rs` (forward a single `nxm://` argument as a `deep-link://new-url` event) plus an opt-in `register("nxm")` setting on Linux. The frontend pieces would be: parse `nxm://<game>/mods/<id>/files/<fid>?key=&expires=`, call `nexus-download` with `key` and `expires`, then download to the Tofu the user was working in.

## Dev server

`src/devModsMock.ts` fakes the proxy and the Nexus actions so everything can be previewed in a browser: Minecraft, Terraria, Stardew Valley and Satisfactory on CurseForge; Stardew Valley also on Nexus (one CurseForge tab); Cyberpunk 2077 Nexus-only; a hidden test game that must not appear; mods with and without download URLs; HTML descriptions with script/handler/iframe payloads to prove the sanitiser. `?premium` pretends a Premium Nexus account. Nexus needs a signed-in Mochi account and a saved key, as in production. Toggle sources in Settings > Mod sources to check the rules above.

## Tests

`npm run test:mods` covers game support, matching, the sanitiser and the source priority function.
