# Platform Architecture

Mochi intentionally isolates operating-system behavior so adding another supported desktop platform does not require rewriting the React application.

## Architecture

Mochi separates platform behaviour from game-source discovery so new integrations do not become an OS × launcher matrix.

## Rust platform adapter

Platform-specific native behavior lives in `src-tauri/src/platform/`.

- `mod.rs` — shared types and the platform dispatch boundary.
- `linux.rs` — Linux launch targets, Flatpak discovery, desktop integration, startup, notifications, and launch behaviour.
- `macos.rs` — macOS launch targets, `.app` bundles, LaunchAgent startup, notifications, URL handling, and capabilities.
- `unsupported.rs` — safe fallback for platforms that are not explicitly supported.

The Tauri commands in `main.rs` are deliberately thin. They validate the command boundary and delegate immediately to the platform adapter.

When adding a new platform, create a dedicated adapter module and add its dispatch in `mod.rs`. Shared commands should expose intent only; platform modules own native commands, paths, filenames, launch methods, startup integration, notifications, URL handling, and capability values. Do not put OS-specific process commands in React components or shared application logic.

## Game source architecture

Game sources are kept separate from operating-system adapters. This prevents the project from becoming an OS × launcher matrix.

Linux and macOS provide read-only discovery/import adapters for their supported local launchers:

- Flatpak
- Steam, including installed games and non-Steam shortcuts, including installed Steam library manifests
- Heroic Games Launcher
- Lutris
- Bottles
- itch.io

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
4. Heroic, Lutris, Bottles, and itch.io source detection/import where those applications and their local data are available.
5. macOS process tracking for playtime and launcher hand-off detection.
6. Launch-at-login through a per-user LaunchAgent.
7. Native URL opening through `open`.
8. Native desktop notifications through `osascript`.
9. Static `mochi://` deep-link registration through the Tauri bundle configuration.
10. macOS CI validation on Intel and Apple-silicon runners.

Public macOS distribution still requires normal Apple signing/notarization work; that is a release-engineering concern rather than a reason to scatter signing logic through the launcher.

## Design rule

**Shared code describes what Mochi wants to do. Platform adapters describe how the operating system does it.**
