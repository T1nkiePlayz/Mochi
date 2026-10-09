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

> [!WARNING]
> **Mochi builds are NOT code-signed or notarized.**
>
> - There is no Apple Developer account behind this project. The macOS DMG is **ad-hoc signed only**, so **Gatekeeper will block the first launch**. See [Install](#install) for how to open it.
> - Linux packages (AppImage, deb, rpm) are not platform-signed, but every release file carries a **GPG signature** and a **GitHub build attestation**, and the release lists `SHA256SUMS.txt`. See [Verify your download](#verify-your-download).
> - Only download Mochi from the official [GitHub Releases](https://github.com/T1nkiePlayz/Mochi/releases) page and verify the download before running anything.
> - **Early development:** storage formats, features and UI may change between versions. Do not treat Mochi as the only copy of data you care about (library, collections, playtime history). Keep your own backups.

## Table of contents

- [Install](#install)
- [Verify your download](#verify-your-download)
- [Overview](#overview)
- [Piko and Tofu](#piko-and-tofu)
- [Features](#features)
- [Importing games and launching](#importing-games-and-launching)
- [Accounts, cloud sync and offline use](#accounts-cloud-sync-and-offline-use)
- [Platform support](#platform-support)
- [Security model](#security-model)
- [Development](#development)
- [Releasing](#releasing)
- [Current limitations](#current-limitations)
- [Roadmap](#roadmap)
- [Documentation index](#documentation-index)
- [Contributing](#contributing)
- [License](#license)

## Install

Download from the [Releases page](https://github.com/T1nkiePlayz/Mochi/releases) only.

Verify what you downloaded before running it: see [Verify your download](#verify-your-download).

### Linux

AppImage, `.deb` and `.rpm` are published, and the repository has an Arch `PKGBUILD` (`packaging/arch`). For the AppImage: `chmod +x Mochi*.AppImage && ./Mochi*.AppImage`. The AppImage and the macOS app update themselves in place; deb, rpm and AUR installs only get an "Open release page" prompt.

### macOS (12.0 or newer, Apple silicon and Intel)

One universal DMG is published. Because the app is only ad-hoc signed, macOS will say it cannot verify Mochi on first launch. Drag `Mochi.app` to Applications, then either:

1. **Right-click (Control-click) Mochi.app > Open > Open**, or
2. Try to open it once, then go to **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to the Mochi message, or
3. Advanced users, in Terminal: `xattr -dr com.apple.quarantine /Applications/Mochi.app`

You only need to do this once per downloaded copy. Details and file locations: [docs/macos.md](docs/macos.md).

## Verify your download

Each release publishes three proofs; details and the one-time maintainer setup are in [docs/verify-downloads.md](docs/verify-downloads.md).

```bash
# 1. Checksums (SHA256SUMS.txt in the same folder; use shasum -a 256 on macOS)
sha256sum -c --ignore-missing SHA256SUMS.txt

# 2. GPG signature made with the Mochi release key
curl -fsSL https://raw.githubusercontent.com/T1nkiePlayz/Mochi/main/docs/release-signing-key.asc | gpg --import
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
gpg --verify <file>.asc <file>

# 3. GitHub build attestation: proves the file came from this repository's release workflow
gh attestation verify <file> --repo T1nkiePlayz/Mochi
```

The release key fingerprint is listed in [docs/verify-downloads.md](docs/verify-downloads.md); compare it with what `gpg --fingerprint "Mochi Releases"` prints. A GPG "not certified" warning is expected. Verification proves the files are the ones the project built; it does not replace Apple notarization on macOS.

## Overview

Mochi is a cross-platform (Linux and macOS) desktop game launcher that sits above existing game ecosystems instead of replacing them. It gives you one library for games that already live on your computer: Steam, Heroic, Epic, itch.io, Flatpak, Lutris, Bottles, Whisky/CrossOver, plain executables, scripts and apps.

- **Local first.** Installations stay where they are; the library, launching, playtime, themes and settings work without an account or a network. Cloud sync is optional and metadata-only.
- **Native where it matters.** React/TypeScript for the UI; Tauri 2 and Rust for launching, discovery, process tracking and downloads. OS-specific code lives in `src-tauri/src/platform/` and `src-tauri/src/sources/`, and the UI asks `get_platform_capabilities` instead of assuming an OS.
- **Your launcher stays in charge of its games.** Imported games are launched through the owning launcher (Steam, Heroic, ...) so prefixes, overlays and authentication keep working.

## Piko and Tofu

**Piko = what you play. Tofu = how you play it.**

A **Piko** is a game in your library: name, artwork, genres, launch target, source, playtime and metadata. A **Tofu** is an environment belonging to a Piko: a default install, a specific version, a modded profile, a custom runtime. One Piko can have several Tofus. Each Tofu has its own content folder and launch settings (compatibility runtime, wrappers, arguments, environment variables, working directory) and its own mods.

## Features

### Library
- Search across names, descriptions and categories (**Ctrl+K / Cmd+K**), sorting, and a *Continue playing* shelf.
- **Favourites, tags and collections** (user-named, optional emoji, stored per profile) and **smart filters**: All, Favourites, Installed, Recently played, Unplayed, Most played, Launchers, Running now. Filter by source too.
- Per-game page with playtime, Tofus, metadata, screenshots/trailer, Steam achievements and mod management.
- Guided first-launch setup (welcome, account, accessibility, import) and an import picker with per-game selection.
- In-app notification centre plus desktop notifications (`notify-send` on Linux, `osascript` on macOS).

### Themes
Eleven built-in themes: Mochi, Mochi Light, Minecraft Ore, Minecraft Dungeons, Subnautica, Stardew Valley, RuneScape, Fallout Pip-Boy, Cyberpunk 2077, Animal Crossing and Terraria. Themes are packages: a JSON manifest of design tokens (colours, shapes, fonts, shell position) and an optional `theme.css` and assets. You can import a theme file or folder in Settings > Appearance. The build validates themes, including contrast. See [src/themes/README.md](src/themes/README.md), [docs/theme-architecture.md](docs/theme-architecture.md) and [docs/theme-hooks.md](docs/theme-hooks.md).

### Big Picture, controller and Steam Deck
- **Big Picture mode**: a full-screen, controller-first interface with shelves, game pages, a side menu and a button legend. Enter from the top bar, F11, Start + Select, the tray, `mochi --big-picture` or `mochi://bigpicture`; it can also be the startup mode and is the default under gamescope.
- **Controller support** (Xbox, PlayStation, Switch Pro, Steam Deck, generic pads) for the whole app: spatial navigation, on-screen keyboard, configurable layout and prompts.
- **Steam Deck** detection, 44px touch targets and instructions for adding Mochi to Steam.
- See [docs/controller.md](docs/controller.md) and [docs/steam-deck.md](docs/steam-deck.md).

### Metadata and artwork
- Providers: **IGDB** (text, genres, screenshots, trailer, covers; needs a free Twitch Client ID/Secret), **SteamGridDB** (artwork; needs a free API key) and the **Steam Store** (no key, Steam games only). Choose the behaviour in Settings; IGDB matches are confirmed by you.
- **Custom artwork**: pick, drop or crop your own image, or search SteamGridDB. Hand-edited fields and custom artwork are never overwritten by refreshes.
- Results are cached and everything works offline from the cache. See [docs/metadata.md](docs/metadata.md).

### Playtime, stats and achievements
- Playtime is credited when a game exits, for games Mochi starts directly and for games handed to another launcher (followed by process group or install folder; Linux and macOS). The Play button turns into **Stop**.
- A **Stats** view shows playtime and activity.
- **77 Mochi achievements** across Playtime, Streaks, Habits, Variety, Library, Explore, Mods and Steam categories, with rarities.
- **Steam achievements** per game, read from your local Steam account and public profile (optionally with your own Web API key, kept only on your device). See [docs/improvements/achievements.md](docs/improvements/achievements.md).

### Discover and mods
- **Discover** browses community content from **Modrinth**, **CurseForge** and **Nexus Mods**. Each source can be switched off in Settings > Mod sources, and fixed rules pick the source per game (Minecraft Java: Modrinth and CurseForge; other CurseForge games: CurseForge; otherwise Nexus when you saved a Nexus key).
- **Mods per Tofu**: install into a chosen Tofu, enable/disable/delete, **profiles** (saved mod sets), and **updates** for Modrinth files by hash. Downloads are done by Rust with a per-provider host allow-list, size cap, SHA-1 check and safe zip extraction. Nexus free accounts are linked out; `nxm://` links are not supported.
- CurseForge uses Mochi's own server-side key (you need no account), shows "Powered by CurseForge", never caches CurseForge data and links back when an author disabled third-party downloads.
- See [docs/mods.md](docs/mods.md) and [docs/curseforge.md](docs/curseforge.md).

### Accessibility
Settings > Accessibility covers text and interface size (85-150%), high contrast, colour-blind palettes, reduced motion/transparency, focus ring styling, a readable font, spacing, larger targets and text labels. Dialogs get focus traps, Escape handling and screen-reader names; `?` opens the shortcuts list. See [docs/accessibility.md](docs/accessibility.md).

### Updates
Background check 10 seconds after start and every 6 hours (Settings > Updates > Auto-update), never installing without you pressing **Install & restart**. Updates are verified against an embedded public key. See [docs/updates.md](docs/updates.md).

### Linux and macOS integration
Application-menu shortcuts (`mochi://launch/<id>`), start at login, tray icon, managed AppImage copy and `mochi://` handler on Linux; LaunchAgent, Dock reopen and menu-bar hiding on macOS. Experimental opt-in features live in Settings > Experimental ([docs/experimental-features.md](docs/experimental-features.md)).

## Importing games and launching

| Source | Linux | macOS | Launch handoff |
| --- | --- | --- | --- |
| Steam (libraries and non-Steam shortcuts) | yes | yes | `steam://rungameid/<id>` |
| Heroic (Epic, GOG, Amazon, sideloaded) | yes | yes | `heroic://launch?...` |
| Epic Games Launcher | no | yes | `com.epicgames.launcher://` |
| itch.io | yes | yes | itch URI, or the game's `.app` on macOS |
| Flatpak | yes | no | Flatpak application ID |
| Lutris | yes | no | `lutris:rungameid/<id>` |
| Bottles | yes | no | `bottles:run/<bottle>/<program>` |
| Whisky bottle pins | no | yes | `open -a Whisky.app <exe>` |
| Desktop apps categorised as games | yes | `.app` bundles in /Applications (also CrossOver launchers and known launchers) | the app itself |

Not imported: Battle.net and GOG Galaxy libraries, and Prism/MultiMC instances (Prism itself is listed as a launcher on macOS). The Whisky pin format was inferred from its source and is not verified on a real machine. Imports never move, copy or uninstall anything, and you can point Mochi at a library folder manually when detection misses it.

Manually added games can target: executables, `.desktop` files, Flatpak IDs, `.sh`/`.bash`, `.py`, `.js`, macOS `.app` bundles, `.exe`/`.bat` through the Tofu's runtime (Wine or Proton, GameMode and MangoHud on Linux; CrossOver or Whisky on macOS), and the launcher URIs above. Runtimes are detected, not installed.

## Accounts, cloud sync and offline use

An account is optional. It enables sync of library metadata (profiles, Pikos, Tofus, including favourites, tags, artwork source and kind) through Supabase; game files and local paths are never uploaded, and a synced path may need fixing on another machine. Sign in with email/password, Google or GitHub, with passkeys and TOTP multi-factor authentication, and keep up to five saved accounts on a device. IGDB, SteamGridDB and Nexus keys are stored server-side in Supabase Vault and never returned to the app.

Offline, the library, launching, playtime, stats, themes, settings, installed-mod management and cached artwork all work. Fonts for built-in themes are bundled, so themes render without a network. Metadata, Discover, sign-in, trailers and downloads need a connection and fail quietly. Full table: [docs/offline.md](docs/offline.md).

## Platform support

- **Linux** is the primary development platform and the best tested one.
- **macOS** has a full native adapter (universal DMG, minimum macOS 12) and is built and tested in CI on Apple-silicon and Intel runners, but has had far less real-world use than Linux. Data locations: `~/Library/Application Support/Mochi` for config, themes and artwork, and `~/Library/Application Support/dev.sidequestgames.Mochilauncher` for playtime and Wine prefixes ([docs/macos.md](docs/macos.md)).
- **Windows is not supported.**

## Security model

- A strict Content Security Policy (`script-src 'self'`, no remote scripts, an explicit host list for images and connections) and a web view with no asset-protocol access. Details and how to add hosts: [docs/security-csp.md](docs/security-csp.md).
- Mod downloads happen in Rust against a per-provider URL allow-list, with size and hash checks and path-traversal-safe extraction. Third-party HTML (mod descriptions) is rendered through a strict sanitiser.
- **No secrets in the client.** The app ships only the public Supabase URL and publishable key. The CurseForge API key exists only as a Supabase edge-function secret; user provider keys live in Supabase Vault.
- Auth uses Supabase; provider sign-in opens the system browser and returns through `mochi://auth/callback`, and the app asks before installing a session.
- Releases are not code-signed (see the warning above). The updater verifies its own signature key independently of OS signing.
- Mochi does not host or distribute game content. You are responsible for what you choose to run.

## Development

Requirements: Node 20+, a stable Rust toolchain and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.

    git clone https://github.com/T1nkiePlayz/Mochi.git
    cd Mochi
    npm ci
    npm run tauri dev     # full desktop app
    npm run dev           # browser-only UI with a dev mock backend

The repository's `.env` holds only the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; point them at your own Supabase project if you run one. Never commit secrets.

Checks (the same ones CI runs):

    npm run build             # validates themes, type-checks, bundles
    npm run lint
    npm test                  # vitest + metadata and mods tests
    npm run typecheck:tests
    cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test

`npm run tauri build` works locally without the updater signing key (updater artifacts are only enabled by the release workflow).

**Supabase setup.** Migrations are in `supabase/migrations/` (apply in order; never edit an applied one). Edge functions: `store-provider-credentials` and `curseforge-proxy` (deploy with `--no-verify-jwt`; secret `CURSEFORGE_API_KEY`), see [docs/curseforge.md](docs/curseforge.md). Under Authentication > URL Configuration > Redirect URLs add **`mochi://auth/callback`** and **`mochi://auth/verify`**, otherwise sign-in links cannot return to the app.

Layout: `src/` (React UI, `lib/` wrappers, `themes/`, `bigpicture/`, `controller/`), `src-tauri/src/` (`platform/`, `sources/`, downloads, playtime, gamepad, Steam/artwork helpers), `supabase/`, `packaging/`, `scripts/`, `docs/`.

## Releasing

Push a tag `vX.Y.Z` (`-beta.N` for pre-releases) on the commit to ship. The release workflow builds AppImage, deb, rpm and a universal macOS DMG, generates `SHA256SUMS.txt` and publishes the release. Without Apple secrets the DMG is ad-hoc signed and unnotarized (what is published today). Secrets, checklist and re-runs: [docs/release.md](docs/release.md).

## Current limitations

- Builds are unsigned and unnotarized; macOS needs the manual Gatekeeper steps above.
- macOS support is newer and less tested than Linux; some paths (Whisky, entitlements) are unverified on real hardware.
- Source scanners read other launchers' local formats and may break when those change. Battle.net, GOG Galaxy and Prism/MultiMC libraries are not imported.
- Runtimes (Wine, Proton, CrossOver) are detected, not installed.
- Mod profiles and update checks cover Modrinth only; Nexus has no `nxm://` link handling and no automatic dependency install.
- Games handed to another launcher can only be stopped once Mochi detects them.
- Synced paths may not work on another machine; sync is metadata-only.
- Storage formats and UI may change before a stable release.

## Roadmap

Not promises or dates.

- [x] Library, Piko/Tofu model, imports, launch handoff, runtimes, process tracking
- [x] Themes (11), bundled fonts, accessibility, Big Picture, controller and Steam Deck support
- [x] Metadata providers, custom artwork, collections, tags, smart filters
- [x] Playtime, stats, achievements, Steam achievements
- [x] Discover and mod management (Modrinth, CurseForge, Nexus)
- [x] Accounts, passkeys, MFA, optional cloud sync, auto-update, Linux packages, universal macOS DMG
- [ ] Signed and notarized macOS builds (needs an Apple Developer account)
- [ ] `nxm://` handling, Battle.net / GOG Galaxy / Prism import
- [ ] Mod profiles and updates beyond Modrinth
- [ ] Stable release

## Documentation index

[accessibility](docs/accessibility.md), [controller](docs/controller.md), [Steam Deck and Big Picture](docs/steam-deck.md), [macOS](docs/macos.md), [metadata](docs/metadata.md), [mods](docs/mods.md), [CurseForge backend](docs/curseforge.md), [offline and fonts](docs/offline.md), [updates](docs/updates.md), [release](docs/release.md), [CSP](docs/security-csp.md), [platform architecture](docs/platform-architecture.md), [themes](docs/theme-architecture.md), [experimental features](docs/experimental-features.md), [achievements](docs/improvements/achievements.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Keep changes focused, keep OS-specific code in the platform adapters, keep the app working offline, and never commit credentials. The companion website is maintained in [Mochi-Website](https://github.com/T1nkiePlayz/Mochi-Website).

## License

Mochi does not currently declare an open-source license. Until one is added, do not assume the code may be reused, redistributed or relicensed.
