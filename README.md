<p align="center">
  <img src="./public/mochi.png" alt="Mochi logo" width="220">
</p>

<h1 align="center">Mochi</h1>

<p align="center">
  <strong>Your games, your way.</strong><br>
  A cross-platform desktop game launcher built around local control, flexible launch targets, and optional cloud metadata.
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/T1nkiePlayz/Mochi?style=flat-square" alt="Last commit">
  <img src="https://github.com/T1nkiePlayz/Mochi/actions/workflows/ci.yml/badge.svg" alt="Mochi CI">
  <img src="https://img.shields.io/github/issues/T1nkiePlayz/Mochi?style=flat-square" alt="Issues">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-informational?style=flat-square" alt="Platforms">
  <img src="https://img.shields.io/badge/status-early%20development-orange?style=flat-square" alt="Early development">
</p>

> 🚧 **Early development:** Mochi is actively being built. Features, APIs, storage formats, platform support, and UI behavior may change before the first stable release.

## Table of contents

- [Overview](#overview)
- [Design philosophy](#design-philosophy)
- [Piko and Tofu](#piko-and-tofu)
- [Features](#features)
- [Launch targets](#launch-targets)
- [IGDB metadata](#igdb-metadata)
- [Local-first storage](#local-first-storage)
- [Accounts and cloud sync](#accounts-and-cloud-sync)
- [First-launch setup and importing](#first-launch-setup-and-importing)
- [Architecture](#architecture)
- [Platform support](#platform-support)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Development setup](#development-setup)
- [Environment configuration](#environment-configuration)
- [Building](#building)
- [Development notes](#development-notes)
- [Current limitations](#current-limitations)
- [Roadmap](#roadmap)
- [Related projects](#related-projects)
- [Contributing](#contributing)
- [Security and privacy](#security-and-privacy)
- [License](#license)

## Overview

Mochi is a desktop game launcher intended to sit above existing game ecosystems rather than replace them.

The goal is simple: give the user one flexible library for games that already exist on their computer. Mochi does not need every game to come from the same store, publisher, or distribution platform. A library entry can point to an executable, desktop entry, Flatpak application, script, or another supported launch target.

Mochi is deliberately **local-first**. Your game installations stay on your device. The launcher keeps the information required to organise and launch those games locally, while optional account features can synchronise selected metadata between devices.

The application is also designed around a clear separation between web UI code and operating-system code. React handles the interface, while Tauri and Rust handle native operations.

## Design philosophy

Mochi is guided by several principles:

1. **Your games should belong to you, not your launcher.** Mochi organises and launches games without taking ownership of their installations.
2. **Local first, cloud optional.** A cloud service should never be a requirement for a local library to remain useful.
3. **Use native capabilities where they matter.** File dialogs, application discovery, and process launching belong in the desktop layer.
4. **Stay flexible.** Mochi should work with different ways of obtaining and installing software instead of assuming one store.
5. **Keep the model understandable.** Pikos represent games, while Tofus represent individual environments or ways of running those games.
6. **Keep platform behavior isolated.** Operating-system-specific behavior should live in platform adapters rather than being scattered through the React application.

## Piko and Tofu

Mochi uses two names for its core library concepts.

### 🐣 Piko — the game

A **Piko** represents a game managed by Mochi.

A Piko can contain:

- Name and description
- Artwork
- Categories or genres
- Local launch target
- Source information
- One or more Tofus
- Other metadata used by the launcher

The Piko is the identity of the game. It is not tied to one particular runtime, modpack, profile, or installation environment.

### 🧊 Tofu — the environment

A **Tofu** represents an individual environment, instance, profile, runtime, or configuration belonging to a Piko.

A Tofu can eventually represent:

- A default installation
- A specific game version
- A modded profile
- A custom runtime
- A testing configuration
- Other future managed environments

One Piko can therefore have multiple Tofus without duplicating the game's identity.

**Piko = what you play. Tofu = how you play it.**

## Features

### Launcher experience

- Library search across game names, descriptions, and categories, with **Ctrl+K / Cmd+K** focus shortcut.
- Customizable local themes with theme-defined colors, typography, component tokens, and assets.
- A dedicated high-contrast light theme with light-specific icon assets.
- Guided first-launch setup with separated Welcome, account, IGDB, and import stages.
- Setup navigation with Previous on the left and Next on the right.
- In-app notification centre with unread indicator and native desktop notifications on Linux (`notify-send`) and macOS (`osascript`).
- Account control beneath the Mochi branding, showing username when available and supporting up to **five saved accounts**.

### Account switching and security

The launcher now mirrors the important account-security controls available in the Mochi Website dashboard. Signed-in users can manage TOTP authenticators, connected Google/GitHub identities, and passkeys without leaving the desktop application. TOTP setup includes QR/manual-secret enrollment and six-digit verification.

The sign-in flow also provides a dedicated, polished two-factor authentication challenge when MFA is required.


### Interactive game setup

When IGDB is configured, adding a custom game searches for several possible matches and shows a dedicated confirmation step. The user can approve the correct game or add it without IGDB metadata.

### Flexible game launching

Mochi provides one interface for several launch styles while leaving the actual installation under the user's control.

### Community content discovery

Mochi includes a Discovery experience for community game content. Minecraft content is powered by Modrinth and currently supports popular mods, modpacks, resource packs, and shaders, with Minecraft-version and mod-loader filters, project details, version/changelog browsing, creator information, and installation into a selected Tofu instance.

Mochi also has an **experimental Nexus Mods integration** for supported accounts. When experimental features are enabled and a Nexus Mods API key is configured, Discovery can load Nexus game tabs and trending mods. The current default games are Satisfactory, Five Nights at Freddy's Security Breach, Subnautica, Subnautica 2, Subnautica: Below Zero, and Stardew Valley. The `+` game picker performs a live Nexus game-catalog search so additional games can be added as persistent Discovery tabs. Nexus game artwork is sourced from Nexus Mods, and the launcher links users to the original mod page rather than downloading Nexus mods directly.

Nexus Mods credentials are handled through the provider-credential backend boundary; the API key is not returned to the launcher. Nexus discovery remains experimental while the integration and game coverage mature.

### Native file and folder selection

Adding a file-based game uses the Tauri native file dialog. The import flow also uses a native folder picker when a source needs a manually supplied library path.

### Steam library and shortcut import

On Linux, Mochi imports installed Steam games from Steam library manifests and also discovers **non-Steam games added to Steam as shortcuts**. Non-Steam shortcuts remain Steam-owned launch targets, so Mochi starts them through Steam instead of bypassing Steam's launch context.

### Flatpak discovery

On Linux, Mochi can discover installed Flatpak applications and display them in a selection interface. Applications are currently grouped into:

- Games
- Other applications

Games are shown first to make the list easier to use.

### Game identity matching

When IGDB is configured, Mochi can search for possible matches after a game is added. The user can review the candidates before accepting metadata.

### Local themes and settings

Mochi includes multiple visual themes and stores launcher preferences locally. Settings include appearance, launcher behavior, and optional IGDB configuration.

### Account integration

An optional Mochi account allows library metadata to be synchronised. The account system is separate from the local launch mechanism, so signing in does not mean that game installations are uploaded.

Supported authentication flows currently include:

- Email/password authentication
- Google and GitHub OAuth
- Email verification
- Passkey sign-in and registration
- TOTP authenticator-based multi-factor authentication
- Connected Google and GitHub identities
- Local account switching (up to five saved accounts)

Mochi also supports custom verification deep links so email verification can return directly to the desktop application.

Account avatars are displayed without requiring Mochi to host image files. Provider avatars are preferred when available, with a Gravatar-derived fallback and a local initial fallback.

## First-launch setup and importing

Mochi includes a guided first-launch experience designed to get a new installation ready without making any step mandatory.

The setup flow covers:

1. **Welcome** — introduces Mochi.
2. **Account** — optionally signs in to Mochi Cloud.
3. **IGDB** — optionally configures local IGDB credentials.
4. **Game imports** — detects supported game sources and lets the user choose which detected sources to scan.

The import system has native platform adapters for Linux and macOS. Linux supports Flatpak, Steam, Steam non-Steam shortcuts, Heroic Games Launcher, Lutris, Bottles, and itch.io. macOS supports Steam, Heroic Games Launcher, Lutris, Bottles, and itch.io when their native applications and local data are present.

The standalone **Import Games** flow can rescan sources, select individual games, and manually point Mochi at a supported library path when automatic detection does not find a source.

Imports are non-destructive. Mochi does not move, copy, uninstall, or take ownership of the underlying game installation. Instead, it records a source-aware launch target and hands execution back to the original launcher when appropriate.

### Community discovery launch/install boundary

Discovery integrations are metadata and content-discovery features rather than replacements for the source platforms. Modrinth downloads can be queued into a chosen local Tofu instance. Nexus Mods discovery currently provides game and mod metadata plus links back to Nexus Mods for the original content.

### Source launch handoff

Source integrations intentionally preserve the original launcher's responsibility for its game runtime:

| Source | Mochi launch handoff |
| --- | --- |
| Steam | steam://rungameid/<id> |
| Heroic | Heroic launch URI |
| Lutris | lutris:rungameid/<id> |
| Bottles | bottles:run/<bottle>/<program> |
| itch.io | itch-setup game launch |
| Flatpak | Flatpak application ID |

This avoids bypassing source-specific runtime, Proton/Wine, prefix, authentication, overlay, or configuration behavior where the source launcher owns those responsibilities.

## Launch targets

The current launch layer recognises several target types:

| Target | Behavior |
| --- | --- |
| Executable | Launches the native executable |
| .desktop | Uses the desktop application's launch mechanism |
| Flatpak | Runs an installed Flatpak application by ID |
| .sh / .bash | Runs the script through sh |
| .py | Runs the script through python3 |
| .js | Runs the script through node |
| macOS `.app` | Opens the application bundle through macOS |
| Custom | Preserves a supported custom launch target |

The exact capabilities are reported by the native platform adapter. Platform-specific values such as launch methods, application-bundle support, startup support, notifications, and native paths are kept inside the relevant adapter rather than being hard-coded in shared UI code.

The frontend normalises launch targets before sending them to the native backend. For Flatpak, Mochi stores a normalised application identifier rather than requiring the user to remember the full command.

## IGDB metadata

IGDB integration is optional.

When the required local credentials are configured, adding a game can follow this flow:

1. Enter the game name.
2. Select or enter its launch target.
3. Mochi searches IGDB.
4. Candidate games are displayed for review.
5. The user approves the correct match or continues without metadata.
6. The selected metadata becomes part of the local Piko.

Metadata can include the game's name, description, genres, cover artwork, and other available artwork.

If IGDB is unavailable, incorrectly configured, or unable to find a useful match, the game can still be added as a custom Piko.

IGDB credentials are configured locally and are not part of the ordinary Piko/Tofu cloud synchronization model.

## Local-first storage

Mochi is designed to remain useful without an account or an active internet connection.

The local library stores the information required to display Pikos, manage their Tofus, and launch configured targets. Launcher preferences are also stored locally.

Cloud synchronization is an optional layer on top of this local state.

Mochi's cloud system is **metadata synchronization, not game backup**. Complete game installations, arbitrary files, and the contents of a user's game directories are not uploaded as part of normal library synchronization.

A local launch target can also be machine-specific. A path that works on one computer may need to be configured again on another.

## Security and provider credentials

Mochi supports passkey authentication and TOTP-based MFA. TOTP is the second-factor flow after password authentication; passkeys provide a separate WebAuthn sign-in path.

Supported provider credentials currently include IGDB and Nexus Mods. Provider credentials are handled separately from ordinary Piko/Tofu metadata. The Nexus Mods key is stored server-side and is not returned to the launcher.

## Accounts and cloud sync

Authenticated users can optionally synchronize library metadata.

The current cloud model is based around three main record types:

- profiles — account/profile information
- pikos — games owned by an account
- tofus — instances associated with Pikos

The relationship is approximately:

    Account
      |
      +-- Pikos
            |
            +-- Tofu
            +-- Tofu
            +-- Tofu

The launcher can pull a user's cloud library after authentication. If the cloud library is empty, the local library can be used as the initial source for a push. Later local library changes can be pushed back to the account.

The cloud layer does not replace local installation management. Piko and Tofu metadata can move between devices, but machine-specific files and paths remain local.

## Architecture

Mochi is split into a React frontend and a native Tauri/Rust backend.

    React UI
       |
       v
    src/lib/platform.ts
       |
       v
    Tauri command
       |
       v
    Rust platform adapter
       |
       +-- Linux
       +-- macOS
       +-- unsupported fallback
       |
       v
    Operating system
       |
       v
    Game / launcher / application

### React frontend

The frontend is responsible for:

- Library presentation
- Navigation
- Piko and Tofu interfaces
- Settings
- Authentication UI
- Cloud synchronization state
- IGDB configuration and lookup
- Calling native functionality through small wrappers

Native operations are exposed to React through src/lib/platform.ts so the main application does not need to contain platform-specific process-launching logic.

### Tauri and Rust

Tauri provides the desktop application boundary around the React UI.

Rust handles operations that require native operating-system access, including:

- Launching targets
- Discovering installed Flatpaks where supported
- Reporting platform capabilities
- Platform-specific application launching

### Platform adapters

Platform-specific implementations live under src-tauri/src/platform/.

### Game source adapters

Game-source discovery is intentionally separate from operating-system support. Linux source integrations live under src-tauri/src/sources/ and currently cover Flatpak, Steam, Heroic Games Launcher, Lutris, Bottles, and itch.io. Mochi reads existing local launcher state without modifying or uninstalling the source installation, then stores a launch target that hands execution back to the source launcher where appropriate. This keeps Wine/Proton prefixes, Steam runtime behavior, launcher authentication, and source-specific configuration owned by the original platform.

The current structure separates Linux, macOS, and unsupported-platform behavior. Each platform adapter owns its configurable native commands, paths, launch methods, startup integration, notifications, and capability values. This keeps future platform work out of unrelated components.

## Platform support

### Linux

Linux is Mochi's primary development platform.

The Linux implementation currently has the strongest native integration, including Flatpak discovery, source import, source-aware launch handoff, and Steam shortcut support. The project is designed with modern Linux desktop environments and Wayland-based workflows in mind.

### macOS

macOS has a dedicated native platform adapter and now supports `.app` bundle selection/launching, native executables and scripts, source discovery for supported local launchers, process tracking for playtime, launch-at-login through LaunchAgents, native URL opening, desktop notifications, and static `mochi://` deep-link registration. The Tauri configuration also defines a macOS-specific minimum system version and hardened runtime settings.

The application is validated in CI on both Intel and Apple-silicon macOS runners. Public distribution still needs Apple signing and notarization before it should be considered a release-ready macOS build.

### Windows

Windows is intentionally outside the current development scope. Mochi is being developed Linux-first, with macOS isolated as the secondary platform target.

## Technology stack

| Technology | Purpose |
| --- | --- |
| Rust | Native backend and platform integration |
| Tauri 2 | Desktop application framework |
| React | User interface |
| TypeScript | Frontend type safety |
| Vite | Frontend tooling and builds |
| Lucide React | Interface icons |
| Supabase | Optional authentication and cloud metadata |

## Repository structure

    Mochi/
    ├── src/
    │   ├── components/       # Reusable React components
    │   ├── lib/              # Auth, cloud, IGDB and platform helpers
    │   └── models.ts         # Piko and Tofu data models
    │
    ├── src-tauri/
    │   └── src/
    │       ├── platform/     # OS-specific native behavior
    │       └── sources/      # Game-source discovery and import adapters
    │
    ├── docs/                 # Architecture and project documentation
    ├── supabase/             # Database migrations/backend definitions
    ├── public/               # Static assets, including the Mochi logo
    ├── .github/workflows/    # CI and release automation
    ├── .env.example          # Environment template
    ├── package.json          # Scripts and dependencies
    └── README.md

## Development setup

### Requirements

You need:

- Node.js and npm
- Rust and Cargo
- Tauri 2's native dependencies for your operating system
- A working desktop environment for native application testing
- Flatpak for Flatpak-specific testing on Linux

### Clone

    git clone https://github.com/T1nkiePlayz/Mochi.git
    cd Mochi

### Install dependencies

    npm install

### Configure environment

    cp .env.example .env

Fill in the values required by your development environment. Never commit real secrets.

### Run the desktop application

    npm run tauri dev

For frontend-only development:

    npm run dev

## Environment configuration

Public configuration templates belong in .env.example. Local development values belong in .env.

Backend/account configuration should be treated as infrastructure configuration. Secrets, private tokens, and local environment files must not be committed.

IGDB credentials are configured separately inside Mochi and are intended to remain local to the launcher.

## Building

### Frontend

    npm run build

This performs TypeScript checking and creates the Vite production build.

### Desktop application

For development:

    npm run tauri dev

For a production desktop build:

    npm run tauri build

GitHub Actions also runs the frontend production build and Rust/Tauri backend check on pushes and pull requests. The release workflow is triggered by version tags beginning with `v`.

Tauri packages the application for the target operating system using the configured release settings.

The exact package formats depend on the target platform and release configuration.

## Development notes

### Machine-specific paths

Cloud synchronization can move a Piko between devices, but a local executable path may not be valid on another machine. This is expected for a launcher that keeps installations local.

### Native operations

When functionality depends on the operating system, prefer adding a small Tauri command and implementing the behavior inside the relevant platform adapter.

### Cloud boundaries

Do not treat cloud metadata as a file storage system. The intended synchronization boundary is launcher metadata, not arbitrary user files or complete game installations.

### Evolving data model

Pikos and Tofus are still early concepts. Their fields and relationships may evolve as runtime, profile, mod, and installation management become more complete.

## Current limitations

Mochi is not yet a finished replacement for dedicated game stores or specialised game managers.

Current limitations include:

- Source scanners depend on the source launcher's local configuration format or CLI and may require compatibility work as those launchers evolve.
- Some source scanners depend on the source launcher's local configuration format or CLI and may require future compatibility work as those launchers evolve.
- Manual library-path scanning is currently most complete for Steam; source-specific path semantics for the other integrations will continue to mature.
- Tofu management is early-stage.
- Game process lifecycle management is not complete.
- Runtime management is not yet a complete system.
- Mod and profile management is planned.
- Synced paths may not work on another machine.
- Linux has the strongest platform integration.
- macOS public release packaging still requires signing and notarization.
- Windows is not currently a development target.
- Cloud synchronization is metadata-only.
- APIs, storage formats, and UI behavior may change before a stable release.

## Roadmap

The roadmap is intentionally evolutionary rather than a promise of fixed release dates.

- [x] Local Piko library foundation
- [x] Piko/Tofu data model
- [x] Native launch command architecture
- [x] Linux Flatpak discovery
- [x] Native game-target file selection
- [x] Optional IGDB metadata lookup
- [x] Interactive IGDB game-match confirmation
- [x] Account authentication foundation
- [x] Secure provider credential storage
- [x] Cloud metadata synchronization foundation
- [x] Native installed-game source discovery and import
- [x] First-launch setup flow
- [x] Guided source import picker with per-game selection
- [x] Flatpak, Steam (including non-Steam shortcuts), Heroic, Lutris, Bottles and itch.io Linux integrations
- [x] Source-aware launch handoff for imported games
- [x] Google and GitHub OAuth
- [x] Email/password authentication
- [x] Passkey authentication and registration
- [x] TOTP multi-factor authentication
- [x] Account switching with up to five saved accounts
- [x] In-app and Linux desktop notifications
- [x] Library search with keyboard shortcut
- [x] Theme-aware light-mode contrast and icon assets
- [x] Launcher security controls mirrored from the Mochi Website
- [x] Email verification deep links
- [x] Account avatars with provider/Gravatar fallback
- [x] Automated frontend and Tauri backend CI checks
- [x] Formal platform/source architecture documentation
- [x] Modrinth community content discovery with project details and Tofu installation
- [x] Experimental Nexus Mods game discovery and trending-mod tabs
- [x] Live Nexus Mods game search and persistent custom Discovery tabs
- [ ] Full Tofu management
- [ ] Game process management
- [ ] Runtime management
- [ ] Mod and profile management
- [ ] More Linux desktop integrations
- [x] Expanded modular macOS platform support
- [ ] Linux distribution packages
- [ ] macOS signed/notarized release packages
- [ ] Stable release

## Related projects

The companion website is maintained separately:

- Mochi Website: https://github.com/T1nkiePlayz/Mochi-Website

The website provides project information, documentation, FAQ material, account access, privacy information, and Terms of Use.

## Contributing

Mochi is still establishing its architecture, so changes should be made with maintainability in mind.

When contributing:

1. Understand the existing implementation before changing it.
2. Keep changes focused.
3. Keep platform-specific behavior inside the platform adapters where practical.
4. Keep native Tauri calls behind frontend wrappers.
5. Avoid hard-coded operating-system assumptions in shared UI code.
6. Test both frontend and desktop builds when a change affects both.
7. Update documentation when user-facing behavior or architecture changes.
8. Never commit credentials or private environment files.

Bug reports, reproducible examples, and focused feature discussions are especially useful while Mochi is in early development.

## Security and privacy

Mochi is designed with a clear separation between local game installations and optional cloud metadata.

Important boundaries include:

- Game installations remain on the user's device.
- Cloud synchronization is intended for metadata.
- IGDB configuration is local.
- Account access is handled through the configured authentication system.
- Secrets and tokens must not be committed to the repository.
- Mochi does not provide, host, or distribute pirated game content.

Users remain responsible for the software, games, scripts, launch targets, and other content they choose to run through the launcher.

For the current public legal and privacy information, see the Mochi Website.

## License

Mochi does not currently declare a final open-source license. Until a license is explicitly added, the source code should not be assumed to be freely reusable, redistributed, or relicensed.

License information will be added as the project approaches its first public release.
