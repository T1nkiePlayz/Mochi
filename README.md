# Mochi 🍡

**Your games, your way.**

Mochi is a Linux-first game launcher designed to bring your games, game installations, profiles, and tools together in one place.

> 🚧 **Early development** — Mochi is not ready for general use yet.

## What is Mochi?

Mochi is intended to sit above existing game ecosystems rather than replace them. It aims to make managing games and different game environments simple, flexible, and local-first.

The project is built around two concepts:

- 🐣 **Piko** — a game managed by Mochi.
- 🧊 **Tofu** — an individual game instance, profile, environment, runtime, or mod setup for a Piko.

For example:

```text
🍡 Mochi
├── 🐣 Minecraft
│   ├── 🧊 Vanilla
│   ├── 🧊 Fabric
│   └── 🧊 Performance
├── 🐣 Hytale
│   └── 🧊 Main
└── 🐣 My Game
    └── 🧊 Development
```

## Goals

Mochi is being built with the following goals:

- 🐧 Linux-first desktop experience
- 🎮 Simple game discovery and management
- 🧊 Flexible game instances and profiles
- ⚙️ Native system and process management
- 🚀 Reliable game launching
- 🔌 Integration with existing game platforms and tools
- 💾 Local-first functionality
- ☁️ Optional cloud synchronization for metadata and settings
- 🛠️ Support for both games and development workflows
- 🪟 Long-term support for Windows and macOS

## Technology

Mochi currently uses:

- **Rust** — native backend and system functionality
- **Tauri 2** — desktop application framework
- **React + TypeScript** — user interface
- **Vite** — frontend tooling
- **SQLite** — local application data
- **Supabase** — optional authentication and cloud metadata

## Development

### Requirements

For Linux development, Mochi requires a working Rust and Node.js development environment along with the system dependencies required by Tauri.

### Install dependencies

```bash
npm install
```

### Run the web development server

```bash
npm run dev
```

### Run Mochi as a desktop application

```bash
npm run tauri dev
```

### Build the frontend

```bash
npm run build
```

### Build the desktop application

```bash
npm run tauri build
```

## Project structure

```text
Mochi/
├── src/                 # React frontend
├── src-tauri/           # Rust/Tauri application
├── supabase/             # Supabase migrations
├── public/              # Frontend public assets
├── package.json
└── README.md
```

## Development status

Mochi is currently in its foundation stage. Current work is focused on turning the existing interface into a fully functional native desktop launcher.

Planned areas include:

- [ ] Native Tauri application shell
- [ ] Native system information
- [ ] Game detection
- [ ] Piko management
- [ ] Tofu management
- [ ] Game process management
- [ ] Game launching
- [ ] Runtime management
- [ ] Mod and profile management
- [ ] Platform integrations
- [ ] Cloud metadata synchronization
- [ ] Linux distribution packages
- [ ] AppImage releases
- [ ] Windows support
- [ ] macOS support

## Philosophy

Mochi is built around the idea that **your games should belong to you, not your launcher**.

The launcher should make managing games easier without locking them into one ecosystem. Local installations should remain useful even when cloud services are unavailable, while optional cloud features can make metadata and settings easier to synchronize.

## License

License information will be added as the project approaches its first public release.
