# Round 5: mods track

What changed, per item of the brief. Architecture and APIs are in `docs/mods.md`.

1. **Mod folders per Tofu.** `modlocs.rs` detects where a game loads mods (Minecraft: official launcher incl. Flatpak, Prism, PolyMC, MultiMC, ATLauncher, CurseForge app, Modrinth app incl. Flatpak, GDLauncher on Linux and macOS; other games: per-game table incl. tModLoader, BepInEx, `Mods`, `Data`, Factorio, Zomboid, Steam native and Flatpak `steamapps/common`). One existing folder is applied automatically, several are offered, none falls back to the native folder picker. `Tofu` gained `gameDir`, `contentRoot`, `loader`, `syncReplaceExisting`; UI: `ModFolderEditor` (Tofu settings and a "Mod folders" dialog on the game page).
2. **Enable/disable.** Per-mod switch, select + bulk, enable/disable all. State is the file name (`x.jar.disabled`), so it is saved, reversible and visible in the file manager; the record follows (`set_instance_mods_enabled`).
3. **Per-instance mod sets and launch sync.** Records per Tofu (`mods.json`), optional separate store, sync at launch only (`run_sync`: hard link or copy, only differences, `.mochi-managed.json` manifest, never touches unmanaged files unless the Tofu opts in). Progress and result events. Resource packs and shaders follow.
4. **Updates.** Modrinth by hash, CurseForge/Nexus by recorded file ids, background-polite (once per session per Tofu, 6 h, 15 min after failure), badges on tab, mod and Tofu card, `Behavior.autoUpdateMods` (default off) updating at launch, SHA-1 verified, rollback copy and one-click rollback.
5. **Navigation name.** "Installed" is now "Mods & Content" (sidebar, top bar, page title, docs); the nav id is unchanged.
6. **Downloads.** Verified end to end for Modrinth, CurseForge and Nexus: start -> native entry -> `mod-download-changed` event -> list. Fixed: file types of other games (`.tmod`, `.smod`, `.pak`, `.dll`, ... were rejected by the downloader), Minecraft resource packs/shaders went into the mods folder, the Minecraft Modrinth search path skipped SHA-1 and provenance, cancelled/failed rows were indistinguishable. Added: cancel (task abort + temp-file guard), clear finished, open folder, provider label, `provider`/`dir` on entries.
7. **Game logs.** stdout/stderr of every launched game is captured per session (`gamelogs.rs`, 8 sessions per game, long logs shortened), viewer with session picker, follow, copy, open folder, clear. Steam/Flatpak/`open` hand-offs are tagged and explained for Linux and macOS.
8. **Compatibility.** `compatibility`, `bestCompatibility`, `metaFromModFile`, `sortTofus`, `groupTofusByLoader` in `lib/mods/compat.ts`; loader and version are stored on Minecraft Tofus and detected from instance files. "Install anyway" always available.

## Tests added

Native (`cargo test`, 195 total): launch sync (swap, idempotence, conflicts, user-changed files, same-folder no-op, Minecraft subfolders), bulk toggle + records, rollback, record sanitising, import, detection (Prism, official launcher, CurseForge app, macOS and Flatpak roots, game table, Steam by name), version id parsing, log rotation/trim/follow/UTF-8, download cancel/clear, subfolder allow-list, new content types.
Frontend (`npm test`, 152 total): compatibility, update picking and scheduling, content targets, folder choices, downloads list model, log buffer, sync summary, nav label, settings default, modrinth client args.

## Numbers

Entry chunk 354 kB (update logic is a lazy 3 kB chunk; the mod manager chunk is 33 kB). Launch overhead of a sync with nothing changed: one directory listing and one small JSON read per lane.

## Not verified here

No browser or real game was available: nothing was clicked through visually, no real launcher folders (Prism, CurseForge app, Flatpak) were read, no macOS build, no live CurseForge/Nexus update, no Steam/Flatpak hand-off log, no cross-volume copy fallback of the sync (covered only by code reading).
