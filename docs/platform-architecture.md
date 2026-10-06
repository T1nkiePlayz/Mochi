# Platform Architecture

Mochi intentionally isolates operating-system behavior so adding another supported desktop platform does not require rewriting the React application.

## Rust platform adapter

Platform-specific native behavior lives in `src-tauri/src/platform/`.

- `mod.rs` — shared types and the platform dispatch boundary.
- `linux.rs` — Linux launch targets and installed Flatpak discovery.
- `macos.rs` — macOS-specific launch behavior and application bundles.
- `unsupported.rs` — safe fallback for platforms that are not explicitly supported.

The Tauri commands in `main.rs` are deliberately thin. They validate the command boundary and delegate immediately to the platform adapter.

When adding a new platform, create a new adapter module and add one `cfg(target_os = "...")` branch in `mod.rs`. Do not put OS-specific process commands in React components or shared application logic.

## Game source architecture

Game sources are kept separate from operating-system adapters. This prevents the project from becoming an OS × launcher matrix.

Linux currently provides read-only discovery/import adapters for:

- Flatpak
- Steam, including installed Steam library manifests
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

The Linux implementation lives under src-tauri/src/sources/linux.rs, while src/lib/sources.ts provides the frontend boundary. Other operating systems can implement the same source contract later without changing the React import UI.

## Frontend platform adapter

`src/lib/platform.ts` is the frontend boundary for native operations:

- launching a game
- querying installed launch targets
- opening the native game-file picker
- normalizing platform-specific launch targets
- reading platform capabilities

React components should call these functions instead of invoking Tauri commands directly.

## Adding macOS support

The macOS adapter already has a dedicated place for application-bundle behavior. Future work should build on this boundary rather than adding macOS checks throughout `App.tsx`.

Typical future work will include:

1. macOS application discovery.
2. Better `.app` metadata extraction.
3. Native process tracking.
4. macOS-specific permissions and path handling.
5. macOS CI/release configuration.
6. Signing and notarization for public distribution.

## Design rule

**Shared code describes what Mochi wants to do. Platform adapters describe how the operating system does it.**
