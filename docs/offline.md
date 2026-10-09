# Offline behaviour

Mochi is local-first: the library, launching, playtime, themes and settings never need a network.
When the connection drops, a quiet banner ("You're offline...") appears above the page content
(`src/components/OfflineBanner.tsx`, driven by `useOnline()` in `src/lib/offline.ts`). It combines
`navigator.onLine` with real request outcomes: the Supabase client's fetch is wrapped so a failed request
calls `markNetworkFailure()` and the next success calls `markNetworkOk()`.

| Feature | Offline behaviour | Notes |
| --- | --- | --- |
| Library, launching, stopping games | Works | Local only. |
| Playtime and stats | Works | Tracked locally. |
| Installed games, import from Steam/Heroic/etc. | Works | Reads local launcher data. |
| Themes and fonts (built-in) | Works | Fonts are bundled with the app. |
| Themes and fonts (user/imported) | Works after first load | Google Fonts are downloaded once and cached; uncached and offline falls back to system fonts. |
| Settings, storage location, backups | Works | Local files. |
| Game artwork (cached) | Works | Covers are cached in `<config>/game-artwork/` as they are fetched. |
| Game artwork (not yet cached) | Degraded | Remote URL fallback may not load; the theme placeholder shows instead. |
| Screenshots in game details | Degraded | Images are hidden if they cannot load. |
| Trailer | Needs network | The play button is disabled with "Trailer needs internet". |
| IGDB metadata lookup, refresh | Needs network | Failures are skipped per game; cached results (`igdb` cache) still apply. |
| Account sign-in, MFA, passkeys | Needs network | A stored session is restored without a request; rejections are caught, nothing is shown as an error. |
| Account avatar | Degraded | Falls back to the initial letter when the image (provider or Gravatar) cannot load. |
| Cloud sync | Degraded | Shows "Cloud sync unavailable" instead of an error for connectivity failures; local edits keep working and sync resumes when the account reloads. |
| Provider credentials (IGDB, Nexus) | Needs network | Stored server-side; status check failures are logged quietly. |
| Modrinth / Nexus Discover and mod search | Needs network | Result icons are hidden if they cannot load. Discover's own offline cache is handled separately. |
| Installed mod management (enable/disable/delete, launch sync, rollback, game logs) | Works | Local files. |
| Mod update checks | Needs internet | Shows "You are offline"; nothing is cached on disk. |
| Mod downloads | Needs network | Fail with a message in the Downloads list. |
| First-launch setup | Mostly works | Launcher icons load remotely until bundled separately. |
| Opening external links (GitHub, Modrinth, YouTube) | Needs network | Opens the system browser. |

## How fonts are bundled

- `scripts/fetch-fonts.mjs` reads the `fonts` URLs of every `src/themes/*/theme.json` (plus the base UI fonts
  DM Sans, Manrope and JetBrains Mono), downloads the CSS and the latin and latin-ext woff2 files into
  `src/assets/fonts/<family>/`, and writes `src/styles/fonts.generated.css` with local `@font-face` rules
  (`font-display: swap`). Vite hashes and bundles the files.
- The downloaded files and generated CSS are committed, so builds and CI need no network. Re-run
  `node scripts/fetch-fonts.mjs` after changing a built-in theme's `fonts` list.
- Built-in themes keep their `fonts` list only as the input for that script; `applyTheme` ignores it.
- `scripts/check-themes.mjs` warns when a built-in theme references a font family that is neither bundled nor
  a system/generic family.
- Licences (SIL OFL 1.1) are in `src/assets/fonts/LICENSES.md`.

## How user theme fonts are cached

User or imported themes may still list `https://fonts.googleapis.com/css...` URLs. For these, `applyTheme`
calls the native command `cache_theme_fonts` (`src-tauri/src/fonts.rs`):

- Only Google Fonts CSS URLs and `https://fonts.gstatic.com/` woff2 files are fetched; everything else is
  rejected. Redirects are not followed, and counts and sizes are capped (6 stylesheets, 256 KiB per CSS,
  2 MiB per font, 48 fonts).
- Files go to `<Mochi config dir>/fonts/<theme-id>/` with sanitised names; only latin and latin-ext faces are kept.
- The CSS is rewritten to reference the local files and returned with the fonts inlined as data URLs, so no
  asset-protocol scope is needed.
- Later runs read the cache without touching the network. Offline and uncached returns an empty result and
  the theme uses its fallback font stack.
