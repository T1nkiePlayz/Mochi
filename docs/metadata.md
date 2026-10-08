# Game metadata providers

Mochi fills in descriptions, genres, release dates, screenshots, trailers and artwork from up to three providers. Pick the behaviour in **Settings > Mod & metadata providers > Metadata source**.

| Provider | Gives | Needs |
|---|---|---|
| IGDB | description, genres, release date, screenshots, trailer, covers | Free Twitch Client ID and Secret, saved in Settings (signed in) |
| SteamGridDB | artwork only: 600x900 grids, heroes, logos, icons | Free personal API key from your SteamGridDB preferences page (signed in) |
| Steam Store | description, genres, release date, screenshots, Steam CDN art | Nothing. Only used for games that launch through a Steam appid |

Keys are stored server-side in Supabase Vault; the launcher only learns whether a key is saved. All IGDB and SteamGridDB requests go through the `store-provider-credentials` edge function (`sgdb-search`, `sgdb-assets`, `igdb-search`), which validates input and never returns a key. The Steam Store is called directly from the Rust backend (`get_steam_store_details`) with a timeout, an 8 MB response cap and a disk cache.

## Merge policy (`src/lib/metadata/merge.ts`)

- **Automatic**: text from IGDB, falling back to the Steam Store for Steam games. Artwork: SteamGridDB (prefers 600x900) if a key is saved, then the IGDB cover, then Steam CDN art. Each artwork candidate is downloaded in order; the first that downloads wins.
- **IGDB only** / **SteamGridDB only** restrict lookups to that provider. SteamGridDB has no text, so text is left alone.
- Fields the user edited (`lockedFields`) and artwork with `artworkSource === "custom"` are never overwritten, including by "Refresh all".

## Offline and limits

Lookups are cached per provider in local storage for 7 days (misses too), the Steam Store also on disk with stale-on-error, and artwork is cached on disk via `cache_game_artwork`. Offline, Mochi shows what it has saved and never throws to the UI. Lookups run three at a time and back off exponentially on HTTP 429.

## Cloud sync

`favorite`, `tags`, `artwork_source` and `kind` are synced with the library (migration `20261009090000_provider_steamgriddb_and_library_fields.sql`; apply it before using the new client).

## Tests

`npm run test:metadata` (pure helpers) and `cargo test` (Steam response parsing against `src-tauri/fixtures/steam_appdetails_220.json`).
