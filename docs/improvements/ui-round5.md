# UI round 5

Driven by screenshots from a real Linux run. One section per complaint.

## 1. Covers without artwork
- Games with no account or provider no longer show empty grey boxes. `src/lib/fallbackArt.ts` derives a stable hue from the game name, initials ("Half-Life 2" gives H2) and the import source's icon; `GameArtwork` and the Big Picture `Art` draw them with `.generated-art` (`src/styles/features/generated-art.css`).
- Themes tune the generated covers with `--mochi-art-saturation`, `--mochi-art-lightness`, `--mochi-art-text`, `--mochi-art-font`, and may pin `--mochi-art-hue` (Pip-Boy does). Animal Crossing and Mochi Light use light pastels.
- Cards without artwork (`hasArtwork()` false) get `.no-art`: a compact banner instead of a tall cover. The game details header shrinks to a square badge. Big Picture rows, the hero backdrop and thumbnails (continue playing, stats, installed) use the same generated art.
- Bug fixed on the way: bundled launcher art is stored as a bare URL, which was assigned straight to `background-image` (invalid CSS, so an empty box). `artworkBackground()` wraps it.

## 2. View modes
Toolbar button cycles Grid, Compact grid, List, Shelves (one scrolling row per category) and Large cards; click or Arrow keys, Shift+click goes back. Stored in `localStorage` (`mochi:library-view`), announced through a live region, animated (disabled for reduced motion). Pure logic in `src/lib/libraryView.ts`; layout in `src/styles/features/library-views.css`. Select mode and category grouping work in every mode.

## 3. Data and privacy
Settings > Data and privacy lists IGDB, SteamGridDB, Steam Store, Steam achievements and your own artwork. Each has its own Clear button (lookup cache plus the cover files that came from that source; achievements and store caches through new commands `clear_steam_achievements_cache` and `clear_steam_store_cache`), plus "Clear all cached data" (keeps your own artwork). The provider rows have their own Refresh buttons that ask only that provider (`refreshAll(library, only)`, `planProviders("steam")`), enabled exactly when it can work: the Steam Store works signed out, IGDB and SteamGridDB say whether they need a sign-in or a saved key. Pure helpers are in `src/lib/providerData.ts`.

## 4. Destructive buttons and contrast
`scripts/lib/contrast.mjs` now checks `.danger-outline` and `.stop-button` (normal and hover, text and fill) and danger text on panels in every theme. Fixed: Terraria (white on light red), RuneScape, Animal Crossing, Cyberpunk hover, Subnautica and Terraria danger text.

## 5. Website dashboard
Settings > Help has "Open Mochi dashboard". `ashtontink.com` and `mochi.ashtontink.com` are trusted hosts in `url_policy.rs` (with a test, including look-alike hosts).

## 6. Steam achievements and HTTP 429
`steam_achievements.rs` sends every Steam request through one gate: one at a time, at least 1.5 s apart plus jitter, and after a 429 (or 503) a back-off (`Retry-After` honoured, otherwise 30 s doubling to 15 min) during which no request leaves the machine. Results are fresh for 6 hours (was 20 minutes), a manual refresh of a game younger than 60 s is ignored, and a rate-limited or failing fetch serves the saved copy with "Showing saved data. Steam is busy, so Mochi will try again in about N minutes." New status `rate-limited` (no cache) is a calm note, not an error. The library-wide sync stops when Steam is busy. The limiter is pure and unit tested. Not persisted across restarts (the 6 hour cache covers the common case).

## 7. Minecraft Ore
The bell and Big Picture buttons are now 40 px bevelled Ore toolbar buttons with a redrawn, larger pixel bell and a square notification pip. Stats (Overview and Achievements) use Ore panels, 2 px outlines, flat bevelled segmented controls and chips, square meters and badges. `pillRadius` is now set for the blocky themes (Ore, Pip-Boy, Stardew, Cyberpunk, RuneScape, Dungeons, Terraria) so stats controls follow each theme; stats radii read theme tokens.

## Checks
`npm run build`, `npm run lint` (0 errors, same 16 warnings as before), `npm test`, `npm run typecheck:tests`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (175). Visual checks were done with a private headless Chromium against the dev mock, not the shared browser pane.
