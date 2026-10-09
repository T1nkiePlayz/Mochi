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

## Tofu folders, per-Tofu mod sets and the launch sync (round 5)

A Tofu has up to three folders (see `Tofu` in `src/models.ts`):

| Field | Meaning |
|---|---|
| `path` | The Tofu's own mods: where downloads land and what Mochi lists, enables, disables and updates. |
| `gameDir` | The folder the game itself loads mods from (detected or picked by the user). |
| `contentRoot` | Minecraft only: the game folder holding `resourcepacks` and `shaderpacks`. |

- **Default**: `path === gameDir`. The Tofu works directly on the game folder and nothing is ever copied.
- **Keep this Tofu's mods separate** (Mod folders dialog / Tofu settings): `path` becomes a store in Mochi's data (`<app data>/instances/<tofu id>/files`, from `get_instance_store_dir`) and the game folder is only written to at launch. Existing mods are copied (never moved) into the store. `Tofu.syncReplaceExisting` is the opt-in to replace same-named files that Mochi did not put there.
- **Sync** (`src-tauri/src/modinstance.rs`, `run_sync`): runs inside `launch_game_tracked` right before the game starts, never on a timer or on selection change. Enabled files of the store are hard-linked (copied across volumes) into `gameDir`; the files placed by the previous Tofu are removed. Only the difference is touched, tracked in `<gameDir>/.mochi-managed.json` (name, size, mtime, owning Tofu). A file Mochi did not place, or one the user replaced, is never overwritten or removed and is reported as a conflict. Progress: event `mod-sync-progress` (`{tofuId, done, total}`); end: `mod-sync-result` (`{tofuId, report | error}`), shown as a notification by `useGameActions`. A failing sync never blocks the launch. `resourcepacks` and `shaderpacks` inside the store sync to `contentRoot` the same way.
- **Records**: every download is recorded in `<app data>/instances/<tofu id>/mods.json` (source, project id, file id, version, title, sha1, file date, enabled, rollback). `list_instance_mods` joins the files on disk with their records; files Mochi did not install simply have no record.
- **Detection** (`src-tauri/src/modlocs.rs`, command `detect_mod_locations`): Minecraft launcher folders (official launcher incl. Flatpak, Prism, PolyMC, MultiMC, ATLauncher, CurseForge app, Modrinth app incl. Flatpak, GDLauncher; Linux XDG paths and macOS `~/Library/Application Support`), reading loader and game version from `mmc-pack.json`, `instance.cfg`, `minecraftinstance.json` and `launcher_profiles.json`; other games via a table (BepInEx `plugins`, `Mods`, `Data`, tModLoader's `ModLoader/Mods`, Factorio, Zomboid, ...) under the game's install folder or `steamapps/common/<name>` (native and Flatpak Steam). Exactly one existing folder is applied automatically (`useAutoModFolder`); several are offered; none leaves a folder picker. Detection never writes.
- **Where downloads go** is one pure function, `contentFolder(tofu, kind)` in `src/lib/mods/targets.ts` (mods -> `path`; resource packs and shaders -> `<path>/<subdir>` with a separate store, `<contentRoot>/<subdir>` when working on the game folder directly). `installFile`/`installBest` use it; so should any new install button.
- **Enable/disable**: `x.jar` <-> `x.jar.disabled` (a rename in place, always reversible; `.mrpack`, `.tmod`, `.dll`, ... likewise). `set_instance_mods_enabled(tofuId, paths, enabled)` is the bulk call and keeps the record in step. Profiles (`apply_mod_profile`) still exist on top of this.
- Content types Mochi installs and lists: `jar zip mrpack tmod smod pak dll esp esm esl ba2 7z rar vpk` (`CONTENT_EXTENSIONS` in `modrinth.rs`).

## Updates

- Pure logic in `src/lib/mods/updates.ts` (`pickUpdate`, `dueForCheck`, `ModUpdateItem`), network in `updateService.ts` (`checkTofuUpdates`, `applyModUpdate`), shared in-memory state in `src/state/modUpdates.ts` (`ensureChecked`, `applyUpdates`, `useTofuUpdates`, `useUpdateVersion`, `updateBeforeLaunch`).
- Modrinth: by file hash (`analyze_mod_files`), so it works for any jar. CurseForge and Nexus: by the file id Mochi recorded when it installed the file (CurseForge mods are re-read through `cfMod`, so `allowModDistribution === false` still routes to "Open page"). Results are held in memory only (CurseForge terms); only the game version and loader narrow Minecraft Tofus.
- A Tofu is checked when its manager opens (and the Mods & Content view lists it), at most every 6 hours per session, 15 minutes after a failed check, never blocking the UI. Badges: `Updates (n)` tab, "Update available" per mod, count on the Tofu card.
- Updating (`update_mod_file`, any of the three providers): host allow-list, SHA-1 when the source gives one, the new file is only put in place after it verified, the old file is kept in `<folder>/.mochi-rollback/` (hard link, newest 40) and `rollback_mod_update` restores it with its record. A disabled mod stays disabled.
- `Behavior.autoUpdateMods` (default **off**; toggle in the Updates tab and the Mods & Content view): `useGameActions.launchGame` calls `updateBeforeLaunch`, which waits at most 12 s for the check and 25 s for installs and then launches regardless.

## Compatibility API (for Discover and any install button)

`src/lib/mods/compat.ts` (pure, no runtime imports):

```ts
compatibility(meta: { gameVersions?: string[]; loaders?: string[] }, tofu: Tofu | { loader?: ModLoader; gameVersion?: string })
  : { status: "compatible" | "maybe" | "incompatible"; reasons: string[] }
metaFromModFile(file: ModFile)            // works for Modrinth (loaders) and CurseForge (loaders mixed into gameVersions)
bestCompatibility(files: ModVersionMeta[], tofu)   // the best result over a mod's files
tofuTarget(tofu) -> { loader?, gameVersion? }      // Tofu.loader / Tofu.version first, then text in runtime/name/version
sortTofus(tofus), groupTofusByLoader(tofus) -> [{ loader, label, tofus }]   // vanilla, fabric, quilt, forge, neoforge, unknown; newest version first
parseLoader(text), compareGameVersions(a, b), loaderLabels, MOD_LOADERS, ALL_LOADERS
```

Rules: no loader named by the file (resource packs, shaders) = loader-agnostic; unknown loader/version on either side = `maybe`; same release series (1.20.4 vs 1.20.1) = `maybe`; Quilt runs Fabric mods (`maybe`); NeoForge runs Forge mods on 1.20.1 only (`maybe`); everything else that differs = `incompatible`. It only explains risk: **install is never blocked**. `installBest(..., force)` ignores the filter, `NoCompatibleFileError` + `InstallNotice.force` give the "Install anyway" button, and `ModDetailsModal` has "Show files for other game versions and loaders".

Minecraft Tofus record `Tofu.loader` (vanilla/fabric/quilt/forge/neoforge) and `Tofu.version`; both come from detection (`applyLocation` in `lib/mods/folders.ts`) or the Mod folders dialog.

## Downloads

Every provider goes through `start_mod_download` (`downloads.rs`). Entries live in native memory (`get_downloads`, kept 10 minutes) and now carry `provider` and `dir`. The native side emits `mod-download-changed` on start, finish and cancel, so `useDownloads` refreshes at once (it still polls every 1.5-4 s as a fallback). `cancel_mod_download(id)` aborts the task and removes the partial file; `clear_finished_downloads` empties the finished rows. The Downloads view (`src/views/DownloadsView.tsx`, row model in `src/lib/downloadView.ts`) shows progress, completion, failure, cancellation, the provider, "Open folder" and "Clear finished". `startModDownload` accepts `subdir` and `record`.

## Game logs

`launch_game_tracked` appends the game's stdout and stderr to `<app data>/logs/<game id>/<start ms>-<direct|handoff>.log` (8 newest sessions per game; a running log over 16 MiB is cut back to its last 4 MiB). `list_game_logs`, `read_game_log(from)` (tail on the first read, follow with the returned `offset`), `clear_game_logs`; the UI is `GameLogsButton` on the game page. A game started through Steam, a Flatpak launcher or macOS `open` writes nowhere Mochi can see: those sessions are tagged `handoff` and the viewer says where to look (`handoffHelp`).

## Navigation name

The page behind the `Installed` nav id lists every Tofu's mods, disk use and updates, so it is called **Mods & Content** (`src/lib/nav.ts`, `navLabel`; used by the sidebar, the top bar and the page title). The id stays `Installed` because themes, icons and the controller use it.

## Known limitation: nxm:// links

Free Nexus users could return from the site's "Mod Manager Download" button through an `nxm://` link. It is not implemented: the Tauri deep-link plugin only forwards schemes listed in `tauri.conf.json` (dynamic schemes are ignored by its single-instance handling), so it needs Rust changes in `main.rs` (forward a single `nxm://` argument as a `deep-link://new-url` event) plus an opt-in `register("nxm")` setting on Linux. The frontend pieces would be: parse `nxm://<game>/mods/<id>/files/<fid>?key=&expires=`, call `nexus-download` with `key` and `expires`, then download to the Tofu the user was working in.

## Dev server

`src/devModsMock.ts` fakes the proxy and the Nexus actions so everything can be previewed in a browser: Minecraft, Terraria, Stardew Valley and Satisfactory on CurseForge; Stardew Valley also on Nexus (one CurseForge tab); Cyberpunk 2077 Nexus-only; a hidden test game that must not appear; mods with and without download URLs; HTML descriptions with script/handler/iframe payloads to prove the sanitiser. `?premium` pretends a Premium Nexus account. Nexus needs a signed-in Mochi account and a saved key, as in production. Toggle sources in Settings > Mod sources to check the rules above.

## Tests

`npm run test:mods` covers game support, matching, the sanitiser and the source priority function. `npm test` (vitest) also covers compatibility, update picking, content targets, folder choices, the downloads list model, log buffering and the launch-sync summary; the native side has unit tests for sync, bulk toggle, rollback, detection, download cancel and log rotation.
