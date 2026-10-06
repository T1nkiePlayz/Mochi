# Mochi 🍡

**Your games, your way.**

Mochi is a Linux-first game launcher designed to bring games, game installations, profiles, and tools together in one place.

> 🚧 **Early development** — Mochi is not ready for general use yet.

## What is Mochi?

Mochi sits above existing game ecosystems rather than replacing them. It aims to make managing games and different game environments simple, flexible, and local-first.

The project is built around two concepts:

- 🐣 **Piko** — a game managed by Mochi.
- 🧊 **Tofu** — an individual game instance, profile, environment, runtime, or mod setup for a Piko.

## Architecture

Mochi keeps platform-specific system behavior behind a small Rust adapter at `src-tauri/src/platform/`.

Each supported platform owns its launch and discovery behavior, while the Tauri command layer and React UI use platform-neutral interfaces. This keeps future macOS work from scattering OS checks throughout the application.

Tauri operations used by React are also wrapped by `src/lib/platform.ts`, keeping native calls out of the main React application.

### Current platform scope

- 🐧 Linux is the primary supported platform.
- 🍎 macOS has an isolated platform implementation ready for further development, including application-bundle launching.
- 🪟 Windows is intentionally out of scope.

## Technology

- **Rust** — native backend and platform integration
- **Tauri 2** — desktop application framework
- **React + TypeScript** — user interface
- **Vite** — frontend tooling
- **Supabase** — optional authentication and cloud metadata

## Development

### Environment

Copy `.env.example` to `.env` and fill in your Supabase project values.

### Run

```bash
npm install
npm run tauri dev
```

Build the frontend with `npm run build` or the desktop application with `npm run tauri build`.

## Project structure

```text
Mochi/
├── src/                  # React frontend
│   ├── components/       # Reusable UI components
│   └── lib/              # Auth, cloud, IGDB, and platform adapters
├── src-tauri/            # Tauri/Rust application
│   └── src/platform/     # OS-specific native behavior
├── supabase/             # Database migrations
├── .env.example          # Environment variable template
├── package.json
└── README.md
```

## Development status

Mochi is still in its foundation stage. Current work focuses on the local-first launcher core, account system, game metadata, and native game launching.

Planned areas include:

- [ ] Native game detection
- [ ] Piko management
- [ ] Tofu management
- [ ] Game process management
- [ ] Runtime management
- [ ] Mod and profile management
- [ ] More Linux integrations
- [ ] Complete macOS support and release pipeline
- [ ] Cloud metadata synchronization
- [ ] Linux distribution packages
- [ ] macOS App/DMG releases

## Philosophy

Mochi is built around the idea that **your games should belong to you, not your launcher**.

The launcher should make managing games easier without locking them into one ecosystem. Local installations should remain useful when cloud services are unavailable, while optional cloud features can make metadata and settings easier to synchronize.

## License

License information will be added as the project approaches its first public release.
