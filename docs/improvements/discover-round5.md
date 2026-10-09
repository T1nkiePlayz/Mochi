# Round 5: Discover track

Architecture and APIs: `docs/mods.md` (section "Discover (round 5)").

## What changed, per complaint

1. **Tab strip.** Rebuilt as `DiscoverTabs`: every tab has a fixed height, always shows its icon and its name (centred, ellipsis at 220 px), and only colours animate, so hovering or focusing never changes a width (the old tabs collapsed to 40 px and grew on hover, which pushed neighbours around). Tabs wrap instead of scrolling. Roving tabindex with Left/Right/Home/End, visible focus ring, selected state with accent border and tint; pill shape from `--mochi-pill-radius`, square in Minecraft Ore.
2. **Game icons.** `GameAvatar` shows the full image (`object-fit: cover`) in a round frame (`--mochi-game-icon-radius`, 0 in Ore) on a backdrop from the generated-art tokens, so transparent PNGs no longer appear as a box; missing or broken images become initials. Used in the tabs and in the Add a game list.
3. **Default games.** Verified against the live `curseforge-proxy` `games` route (38 public games): Minecraft Dungeons is CurseForge 69271, Terraria 431, Stardew Valley 669, Minecraft 432. There is **no Balatro and no RuneScape: Dragonwilds on CurseForge**, so they use Nexus Mods, domains `balatro` and `runescapedragonwilds` (taken from the games' nexusmods.com URLs). Order: Minecraft, Balatro, Dragonwilds, Dungeons, then the previous seeds.
4. **Dragonwilds missing from Add a game.** Three causes: it is not on CurseForge; Nexus games were only fetched with a saved key, so without one nothing Nexus-only could be found; and the server filtered with a plain lowercase substring, so "runescape dragonwilds" never matched "RuneScape: Dragonwilds". Now the whole Nexus list is filtered on the client with normalised names, aliases and space-insensitive matching, CurseForge and Nexus entries of the same game merge into one row with a badge per site, and the seed Nexus games are searchable without a key.
5. **All tab.** A mixed, infinitely scrolling feed over Minecraft and every game tab, round-robin per game (no popularity merge: Nexus gives no download counts), each card labelled with game and site, search across all of them.
6. **Terraria.** Honest note "CurseForge shares only N projects of this game with apps; browse the rest on curseforge.com" with a link; per-game source switcher; and the auto-extend rule below fills the list from Nexus.
7. **Auto-extend + setting.** `modAutoExtendBelow` (default 15, 0 to 100, clamped in `normalizeBehavior`) in Settings > Mod sources next to the site toggles. Evaluated once on the first page. Without a Nexus key a "Connect Nexus" prompt appears instead. The "Automatically update mods" toggle (`Behavior.autoUpdateMods`) now also lives in that section.
8. **Versions tab.** Compact table, expandable rows, filters, one Download per row, fit highlighting for the selected Tofu (details in `docs/mods.md`). Minecraft Modrinth installs from Discover now use the same path as other sites (content folder, SHA-1, install record, Downloads tab) instead of the old direct call.
9. **Avatars.** `Avatar` with lazy loading, `referrerPolicy="no-referrer"` and an initials fallback; CSP `img-src` extended (`*.modrinth.com`, Discord, Google, Gravatar, Twitch, GitLab).
10. **Choose Tofu instance.** Only Minecraft instances for Minecraft content (loader, then newest version), only the game's own Tofus otherwise, with compatibility badges and "Install anyway".
11. **Downloads.** Everything goes through `installFile`/`installBest` and `start_mod_download`; the provider recorded is now the item's own site (it was the list's primary, wrong in mixed lists).

## Tests added (vitest)

`autoExtend` (default, clamp, threshold, dedupe, interleave, note), `extendedSource` (Terraria case, big primary untouched, 0 never extends, duplicates, failing extra site, routing), `mixedSource`, `gameSources`, `gameCatalog` (Dragonwilds in six spellings, no-key fallback, merged rows, switches, aliases, seeds), `tofuChoices` (Minecraft grouping and badges, other games, name fallback, filter), `versionList`, avatar helpers, settings clamp.

## Not verified here

No browser or real run: nothing was clicked through or screenshotted (tab strip look in the 11 themes, versions table, Ore square icons are untested visually). The Nexus domains were checked from public nexusmods.com URLs, **not** against the Nexus API games list (needs a user key; the `nexus-games` action also needs a signed-in account). No live Nexus search or download was run. The new CSP hosts were chosen from where Modrinth avatars can come from, not from observed failures. macOS was not built (no Rust code changed except the CSP in `tauri.conf.json`).
