<p align="center">
  <img src="./public/mochi.svg" alt="Mochi logo" width="220">
</p>

<h1 align="center">Mochi</h1>

<p align="center">
  <strong>Your games, your way.</strong><br>
  A Linux-first game launcher built around local control, flexible launch targets, and optional cloud metadata.
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/T1nkiePlayz/Mochi?style=flat-square" alt="Last commit">
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

### Flexible game launching

Mochi provides one interface for several launch styles while leaving the actual installation under the user's control.

### Native file selection

Adding a file-based game uses the Tauri native file dialog. This gives the desktop application a proper native selection flow instead of depending on browser-style file handling.

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

An optional account allows library metadata to be synchronised. The account system is separate from the local launch mechanism, so signing in does not mean that game installations are uploaded.

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
| Custom | Preserves a supported custom launch target |

The exact capabilities are reported by the native platform adapter. Linux currently provides the broadest integration.

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

The current structure separates Linux, macOS, and unsupported-platform behavior. This makes future platform work easier to reason about and avoids scattering operating-system checks across unrelated components.

## Platform support

### Linux

Linux is Mochi's primary development platform.

The Linux implementation currently has the strongest native integration, including Flatpak discovery and launch support. The project is designed with modern Linux desktop environments and Wayland-based workflows in mind.

### macOS

Mochi has a separate macOS platform implementation so that macOS support can mature without changing the Linux architecture. Application-bundle launching is part of this platform design.

macOS should currently be considered development-stage rather than a fully released platform.

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
    │       └── platform/     # OS-specific native behavior
    │
    ├── supabase/             # Database migrations/backend definitions
    ├── public/               # Static assets
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

    npm run tauri build

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

- Native installed-game detection is still being developed.
- Tofu management is early-stage.
- Game process lifecycle management is not complete.
- Runtime management is not yet a complete system.
- Mod and profile management is planned.
- Synced paths may not work on another machine.
- Linux has the strongest platform integration.
- macOS support is still developing.
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
- [x] Account authentication foundation
- [x] Cloud metadata synchronization foundation
- [ ] Native installed-game detection
- [ ] Full Tofu management
- [ ] Game process management
- [ ] Runtime management
- [ ] Mod and profile management
- [ ] More Linux desktop integrations
- [ ] Mature macOS support
- [ ] Linux distribution packages
- [ ] macOS release packages
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
