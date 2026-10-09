# Round 6: mods and Tofus (MODSYS)

Architecture and APIs are in `docs/mods.md` (sections marked "round 6").

1. **Themed Tofu settings.** New shared `Checkbox`, `Switch` and `Field` (`components/ui/Checkbox.tsx`, `styles/features/form-controls.css`, tokens only). The broken checkboxes came from `.form-fields input { width: 100%; padding... }` hitting checkboxes; that rule no longer applies to checkboxes/radios anywhere. Tofu settings are grouped (General, Mod folders, Launch settings), Escape closes, list is a listbox. Checkboxes in the installed list, updates, Mods & Content, details modal and versions tab use the shared components.
2. **Folder auto-selection.** Detection ranks candidates (`bestPick`: mods present, table order, Minecraft most recent) and selects and saves the best one on the Tofu, in the game page, the Tofu settings and before any download (`ensureTofuFolder`). The folder picker only opens when nothing was detected.
3. **Download button state.** Download / Downloading n% / Downloaded (disabled) / Update available, from on-disk records (restart-safe, also for unpacked archives), the live download list and the update check.
4. **Import-time scan.** Background scan of new games: folder, manifest restore, or record + identify (Modrinth SHA-1, CurseForge fingerprint, Nexus MD5). Unidentified mods: "Identify" opens a search on the game's sites to link them by hand.
5. **Default Tofu + `.mochi/tofus.json`.** Detected mods go into the default Tofu; the manifest (schema 1, atomic, sanitised) is written to the game folder and restored on import.
6. **Robust enable/disable.** Tofus sharing a folder swap mods by rename, only files a Tofu owns, never deleting; applied at launch and on switch when the game is not running; fixture tests for BepInEx, Minecraft (+ resource packs) and tModLoader (shared + separate store).
7. **Mods list.** 8 first, "Show more" -> infinite scroll, windowed rendering (`WindowedGrid`), the installed list uses `content-visibility`; the mods widget is the last section of the game page.
8. **nxm://** handling (opt-in default handler on Linux, bundle scheme on macOS, strict parser with tests, Tofu prompt, free-account downloads). Update checks skip other Tofus' files; CurseForge/Nexus checks now also work for identified (not only downloaded) mods because identification stores file ids and dates.
9. **Downloads tab** shows content kind, destination Tofu, nxm downloads (normal entries) and pending/running mod updates.

## Shared hot spots touched (minimal)

- `src/App.tsx`: one lazy `ModBackground` mount. `src/models.ts`: `Tofu.modScan`. `src-tauri/src/main.rs`: module lines, command list, `register("mochi")` instead of `register_all()` + `nxm::apply_saved`. `src-tauri/tauri.conf.json`: `nxm` scheme. `src/state/useDeepLinks.ts`: two lines routing nxm links. `src/components/GameDetails.tsx` / `src/views/LibraryView.tsx`: `mods` prop rendered last. `src/lib/platform.ts`: `modSyncFor(tofu, piko.tofus)`. `packaging/*.desktop`: nxm MimeType.
- Edge functions: none (the lead deployed `fingerprints` and `nexus-md5`; the client follows that contract: up to 500 fingerprints per call, one MD5 per `nexus-md5` call).

## Tests

Rust: `modhash` (MD5 RFC vectors, fingerprint vs an independent MurmurHash2, streaming), `modprofiles` (6 fixture tests), `modscan` (batch merge). Vitest: `identify`, `installState`, `manifest`, `nxm`, `folders` (bestPick), `targets` (shared-folder requests), sync summary.

## Not verified here

No browser, real game or macOS build. Not run live: CurseForge fingerprint answers (contract taken from the lead's message; the fingerprint algorithm is checked against an independent implementation, not against a real CurseForge file), Nexus `nexus-md5` (response field names as announced; `uploadedAt` accepted as seconds, ms or ISO), Modrinth `version_files` identification, `xdg-mime` registration of `nxm` (and `is_registered`) on a real desktop, macOS handling of the `nxm` bundle scheme, and the visual result of the new controls in the 11 themes. A finished download of a mod the Tofu already has (any source, nxm included) retires the older file: it is kept in `.mochi-rollback` (so "Roll back" works), removed from the folder, and a disabled old file keeps the new one disabled.
