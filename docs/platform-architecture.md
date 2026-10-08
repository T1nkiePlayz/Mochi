# Platform Architecture

Mochi intentionally isolates operating-system behavior so adding another supported desktop platform does not require rewriting the React application.

## Architecture

Mochi separates platform behaviour from game-source discovery so new integrations do not become an OS × launcher matrix.

## Rust platform adapter

Platform-specific native behavior lives in `src-tauri/src/platform/`.

- `mod.rs` — shared types, launch pipeline (`LaunchConfig`, process-group spawning, timeouts) and the thin dispatch to the OS module.
- `linux.rs` — Linux launch targets, Flatpak discovery, desktop integration, startup, notifications, and launch behaviour.
- `macos.rs` — macOS launch targets, `.app` bundles, LaunchAgent startup, notifications, URL handling, and capabilities.

The Tauri commands in `main.rs` are deliberately thin. They validate the command boundary and delegate immediately to the platform adapter.

Mochi builds only for Linux and macOS; other targets fail at compile time. When adding a new platform, create a dedicated adapter module and select it in `mod.rs`. Shared commands should expose intent only; platform modules own native commands, paths, filenames, launch methods, startup integration, notifications, URL handling, and capability values. Do not put OS-specific process commands in React components or shared application logic.

## Game source architecture

Game sources are kept separate from operating-system adapters. This prevents the project from becoming an OS × launcher matrix.

Linux and macOS provide read-only discovery/import adapters for their supported local launchers:

- Flatpak
- Steam, including installed games and non-Steam shortcuts, including installed Steam library manifests
- Heroic Games Launcher
- Lutris
- Bottles
- itch.io
- Desktop applications (Linux `.desktop` entries and macOS `.app` bundles categorised as games)

Shared scanners live in `sources/mod.rs`; `sources/linux.rs` and `sources/macos.rs` only say where each launcher keeps its data and which extra sources exist. Sources are scanned in parallel with timeouts, and Steam, Lutris, Bottles and itch data is read directly (no shelling out to `gzip` or `sh`).

Source discovery reads the source's existing local state and produces a normalized ImportedGame record containing a stable source ID, display name, install path when available, and a source-aware launch target. Mochi does not take over installation, updates, authentication, Wine/Proton prefixes, or source configuration.

Launch targets are handed back to the owning source where appropriate:

- Steam → steam://rungameid/...
- Heroic → heroic://launch?...
- Lutris → lutris:rungameid/...
- Bottles → bottles:run/...
- itch.io → itch-setup --run-game ...
- Flatpak → flatpak run ...

The platform-specific implementations live under src-tauri/src/sources/, while src/lib/sources.ts provides the frontend boundary. The import picker can detect sources, scan them, select individual games, and perform manual library-path scans when automatic detection is unavailable.

## Frontend platform adapter

`src/lib/platform.ts` is the frontend boundary for native operations:

- launching a game
- querying installed launch targets
- opening the native game-file picker
- normalizing platform-specific launch targets
- reading platform capabilities
- choosing a native game-library folder for manual source scans

React components should call these functions instead of invoking Tauri commands directly.

## macOS support

macOS now has a dedicated native adapter and source-discovery implementation. The shared application code does not need to know how macOS launches or integrates applications.

Current macOS support includes:

1. Native `.app` bundle selection and launching through the macOS application system.
2. Native executable, shell, Python, and JavaScript launching.
3. Steam library discovery using macOS application-support paths and Steam library manifests.
4. Steam, Heroic and itch.io source detection/import, plus an Applications-folder source for games that declare the games category.
5. macOS process tracking for playtime and launcher hand-off detection (`ps -axww`, parsed by `process::parse_ps`).
6. Launch-at-login through a per-user LaunchAgent.
7. Native URL opening through `open`.
8. Native desktop notifications through `osascript`.
9. Static `mochi://` deep-link registration through the Tauri bundle configuration.
10. macOS CI validation on Intel and Apple-silicon runners.
11. Windows programs through CrossOver or Whisky, chosen per Tofu.
12. Game session tracking and Stop through process groups.
13. Hardened-runtime entitlements and a release job that signs and notarizes when credentials are configured.

Public macOS distribution requires Apple Developer credentials supplied as repository secrets (see the README); signing logic lives in the release workflow, not in the launcher.

## Game sessions

`playtime.rs` owns running-game state. A launch returns whether the child is the game itself; direct launches are tracked by the process group Mochi created, while hand-offs (Steam, Heroic, `open`, Flatpak) are followed by `tracking.rs`, a pure matcher over a process-table snapshot: Steam `AppId=` arguments and `SteamAppId`-style environment variables (read only for processes started after the launch), install-folder / `.app` bundle prefixes (also across Flatpak mounts and Wine `Z:\` paths), Flatpak ids, plus every descendant of a matched process. A session ends only after the game has been gone for 12 seconds, and a game Mochi never detects is not credited. `stop_game` signals the group (SIGTERM, then SIGKILL after five seconds). The frontend subscribes to the `game-sessions-changed` event through `src/hooks.ts`.

## Design rule

**Shared code describes what Mochi wants to do. Platform adapters describe how the operating system does it.**
