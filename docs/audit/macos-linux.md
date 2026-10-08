# macOS + Linux audit

Format: id, severity, location, problem, fix, test. macOS code could not be run here; CI compiles it, and the macOS adapter, importers and `ps` parser are also compiled and tested on Linux (`#[cfg(any(target_os = "macos", test))]`).

## Defects

| id | sev | where | problem | fix | test |
| --- | --- | --- | --- | --- | --- |
| P1 | high | playtime.rs `find_tracker` | Fallback attached the session to the newest "non-launcher" process (any new browser tab or terminal) | Removed; sessions with no identifying data are not credited | tracking.rs `matcher_needs_something_reliable` |
| P2 | high | playtime.rs | Steam/Proton games on Linux only matched by raw substring of the install path in any process (editors, `tail`, file managers matched; `/games/Foo` matched `/games/Foo Bar`) | `tracking::Matcher`: path-boundary matching, helper-program denylist, `AppId=` args, `SteamAppId`/`STEAM_COMPAT_APP_ID`/`FLATPAK_ID` environment (read once per new process, never for existing ones), children of matched processes | 15 tracking tests (Proton chain, Flatpak Steam mount, Heroic wine paths, macOS bundles, ids compared exactly) |
| P3 | high | playtime.rs `monitor` | Session ended on the first poll with no match; launchers that swap processes split or lost the session | 12 s debounce, idle tail not credited | tracking tests, watcher test with real process |
| P4 | medium | playtime.rs | Direct launch whose script exits after starting the game elsewhere ended instantly | 10 s hand-off grace using the matcher | covered by matcher tests |
| P5 | medium | playtime.rs | Steam hand-off gave up after 120 s (updates, shader compile) | 10 min when a Steam id is known | n/a |
| P6 | medium | playtime.rs `stop` | "Stop" impossible until detected; stale monitor of a cancelled session could end a later session of the same game | Cancel before detection; per-session token | n/a |
| P7 | low | process.rs macOS `ps` | Truncated command lines, collapsed whitespace in paths with spaces | `ps -axww`, raw command preserved, pure `parse_ps` | `parses_macos_ps_output` |
| M1 | high | platform/macos.rs startup | `launchctl bootout` on toggle killed the Mochi that launchd started at login; `bootstrap` launched a second copy; translocated/DMG paths registered | Plist only, started via `open -a bundle`, refuses translocated/DMG paths | launchagent.rs 4 tests |
| M2 | high | sources/macos.rs | `.app` scan skipped symlinked bundles (Homebrew casks); lossy non-UTF-8 paths | follow bundle symlinks, skip non-UTF-8 | `scanning_finds_nested_and_symlinked_bundles...` |
| M3 | high | sources | Heroic GOG/Nile/sideload installs never imported (no title, `id`/`path` keys); missing titles | per-file runner, title lookup in library caches | `heroic_reads_...` |
| M4 | medium | sources | Epic Games Launcher, Whisky, CrossOver program bundles not importable on macOS | Epic manifests, Whisky pins, CrossOver bundle ids | 3 tests |
| M5 | medium | sources | itch `itch://run-game/` is not an itch URL on macOS | launch the game's `.app`, else `itch://games/<id>` | `itch_games_launch_their_own_bundle_on_macos` |
| M6 | medium | platform/macos.rs | Unknown URL schemes (Epic, Battle.net) were executed as programs; missing `.app` gave a raw spawn error | scheme allow-list through `open`; clear message | `url_targets_go_through_open`, `missing_app_bundles...` |
| M7 | medium | entitlements.plist | JIT, unsigned memory, disable-library-validation granted without need | reduced to network client (see docs/macos.md) | CI bundle verification |
| M8 | medium | main.rs | `RunEvent::Opened` did not show a hidden window | show window | manual (docs/macos.md) |
| D1 | high | auth.ts | Google OAuth inside WKWebView is refused; no way back to the app | system browser + `mochi://auth/callback`; callback parser accepts query, fragment, `code` | needs Supabase redirect URL (docs) |
| L1 | high | tray.rs/main.rs | Tray creation failure aborted startup; GNOME without AppIndicator hid the window with no way back | non-fatal, `catch_unwind`, StatusNotifierWatcher check, close quits when no tray | `gdbus_answers_are_parsed` |
| L2 | medium | linux.rs | Desktop entry not named after the app id (Wayland icon match); icons ignored `XDG_DATA_HOME`; AppImage re-copied on every launch | `dev.sidequestgames.Mochilauncher.desktop` (legacy removed), XDG helper, skip copy when identical | `linux_follows_xdg...` |
| L3 | low | linux/macos open_url/open_path | spawned children never reaped (zombies) | `spawn_detached` | n/a |
| L4 | low | packaging | missing libudev (gamepad) deps in deb/rpm/PKGBUILD; PKGBUILD installed `mochi.desktop` | added | n/a |
| R1 | high | release.yml | `create` trigger; releases published before assets; unset secrets passed as empty strings (breaks bundler); racing `latest.json`; missing updater key failed the whole job | tag push + manual trigger, draft then publish, conditional env, serialized jobs, universal DMG, checksums, bundle verification | actionlint-style YAML parse only |
| C1 | medium | main.rs | "Clear app data" left caches and playtime | clears API cache and playtime (not prefixes) | n/a |

## Hardening / verified-correct (not counted as defects)

* `appDirectoriesOverride.config = $CONFIG/Mochi` only affects `app_config_dir()`; on macOS it resolves to `~/Library/Application Support/Mochi`, matching `themes.rs` and the docs. No hard-coded `.config` exists outside `linux.rs`.
* macOS `ensure_platform_integration` copies nothing; Linux copies only the AppImage to `~/.local/bin`.
* AppleScript notification escaping verified injection-safe (test), text length-limited.
* `home_dir()` falls back to the user database when `HOME` is unset; metadata reads are size-capped and tolerate invalid UTF-8; both `libraryfolders.vdf` formats parsed.
* `NSAppleEventsUsageDescription` is not needed (no Apple events are sent). Edit menu / Cmd+Q / Cmd+W come from Tauri's default macOS menu.
* WebKitGTK blank window on NVIDIA: `WEBKIT_DISABLE_DMABUF_RENDERER=1` set when the NVIDIA driver is present and the user did not choose.
* Commands `open_external_url`, `open_path_in_file_manager`, `stop_game`, `get_active_sessions`, `get_playtime`, `get_playtime_history` are now async (off the main thread).

## Not done / needs a Mac or the owner

* Whisky pin format and Epic launch URL are from memory of the upstream formats; unverified on hardware.
* GOG Galaxy, Battle.net libraries and Prism instances are not imported.
* Entitlement removal untested under notarization (fallback documented).
* The release asks for a universal DMG instead of two per-arch DMGs.
* Supabase redirect URLs must be added by the owner.
