# Contributing to Mochi

Thanks for helping! Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. Mochi is in early
development, so small focused changes are easier to review than large ones.

## Ways to help

- Report reproducible bugs and platform quirks (Linux distro, macOS version, Steam Deck).
- Test on macOS and Steam Deck / gamepads: those are the least-tested paths.
- Write or improve themes ([`src/themes/README.md`](src/themes/README.md)).
- Improve documentation and translations.

Do **not** use issues for piracy help, and never post secrets.

## Setup

Requirements: Node 20+, a stable Rust toolchain, and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/T1nkiePlayz/Mochi.git
cd Mochi
npm ci
npm run tauri dev      # full desktop app
npm run dev            # browser-only UI with the dev mock backend
```

Copy `.env.example` (if present) to `.env.local` and fill in your own Supabase / IGDB values.
Never commit credentials.

## Before you open a pull request

```bash
npm run build                                   # validates themes, type-checks, bundles
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

CI runs the same checks plus the macOS backend on Apple-silicon and Intel runners.

## Guidelines

1. Understand the existing implementation before changing it; keep changes focused.
2. OS-specific behaviour belongs in `src-tauri/src/platform/{linux,macos}.rs`. Windows is not
   supported. Shared UI must not assume an OS: use `get_platform_capabilities`.
3. Keep native Tauri calls behind the wrappers in `src/lib`.
4. The app must keep working **offline**. New features need a graceful offline state, and remote
   assets must be cacheable or bundled.
5. UI: use design tokens (`--mochi-*`) instead of hard-coded colours so every theme can restyle it.
   Run `node scripts/list-theme-hooks.mjs` after adding class names and commit `docs/theme-hooks.md`.
6. New unfinished features go behind an entry in `src/lib/experimental.ts`.
7. Database changes are new, idempotent files in `supabase/migrations/`. Never edit an applied one.
8. Update the README/docs when user-facing behaviour changes.
9. Use conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`).

## Pull requests

Fill in the template, link the issue, include screenshots for UI changes (ideally in more than one
theme) and list how you tested. Draft PRs are welcome for early feedback.
