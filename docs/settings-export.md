# Settings export / import

Settings > Data > **Settings backup** writes your preferences to a portable zip and restores them on another device.

## Format
`mochi-settings-YYYY-MM-DD.zip` holds:
- `manifest.json`: `{ format: "mochi-settings", version: 1, createdAt, appVersion, sections }`
- one JSON per section: `behavior`, `appearance`, `sound`, `controller`, `accessibility`, `collections`, `wishlist`, `launcherOverrides`, `games`
- `themes/<id>/...` (folder themes) or `themes/<id>.json` (single-file themes)

A newer `version` is refused with a message asking to update Mochi.

## What is exported (allowlist)
Sections are built from explicit fields in `src/lib/settingsExport.ts`, never by dumping localStorage. Never included: Supabase `sb-*` sessions, provider keys, accounts, caches, notifications, the library itself (cloud sync's job), sound pack files. Launch-option env vars whose names look like credentials (`/token|secret|key|password|auth|session/i`) are dropped, and the export aborts if any credential-named field remains. Tests seed fake secrets and assert they never appear.
Per-game data (launch options, tags, collection ids, backlog) is keyed by piko id and `importKey` and only applied to games already in the library on import. Controller "mappings" are the controller settings (no per-button remapping exists yet).

## Import
"Import settings..." opens a preview sheet: tick sections, choose Merge or Replace for list sections (collections, wishlist, launcher corrections, per-game data), see what changes, optionally install themes. Nothing changes until Import.
- Merge: union; existing entries win on conflicts (collections also match by name; tags and collection ids are unioned; launch options and backlog only fill gaps).
- Replace: the file's data overwrites (per-game: only on matched games).
- Scalar sections (general, appearance, sound, controller, accessibility) overwrite.
- State is applied live (hooks/stores re-read). Library view and sort apply when the library opens.
- Installed themes are never overwritten.

## Limits (Rust, `src-tauri/src/settings_zip.rs`)
Max 2000 entries, 50 MB uncompressed, 8 MB per section, 10 MB per theme file; only expected names; traversal, absolute paths, backslashes and symlinks are rejected; theme manifests go through the normal theme validation. Commands are async and run on the blocking pool.

## Not exported
Credentials, library games, artwork, sound pack files, playtime.
