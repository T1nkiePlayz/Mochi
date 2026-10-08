# Frontend performance pass

## Bundle (`npm run build`, no `chunkSizeWarningLimit` change)

| | Before | After |
|---|---|---|
| Entry chunk `index-*.js` | 523.3 kB (143.4 kB gzip), size warning | 322.3 kB (91.6 kB gzip), no warning |
| CSS | 243.6 kB (37.9 kB gzip) | 226.0 kB (35.1 kB gzip) |

Found by running a temporary rollup plugin that printed `renderedLength` per module for each chunk (not committed). What was in the entry chunk and is now elsewhere:

- `@tauri-apps/api/window` + `dpi` (about 95 kB unminified): only Big Picture's fullscreen toggle used it. It is now a dynamic import inside `bigpicture/mode.ts` (its own 14 kB chunk).
- All 11 built-in `theme.css` files (about 55 kB): `loadTheme` was already async, so `import.meta.glob` for the CSS is no longer eager. Only the applied theme's CSS is fetched. Manifests stay eager because the theme list needs them synchronously.
- Dialogs that mount on demand (`AddGameModals` with the import and artwork pickers, `AuthModal`, `GameEditor`, `TofuManager`, `FirstLaunchSetup`) are lazy in `App.tsx`; `AddGameModals` only mounts while one of its dialogs is open.
- The mod managers (`ModrinthManager`, `ModsBrowser`) are behind a lazy `GameMods` wrapper (`GameModsContent.tsx` holds the old body).
- `devMock` was already dev-only (`import.meta.env.DEV` guard); it was not leaking.

`manualChunks` was already sensible (react, supabase, icons). Supabase (227 kB) is imported statically by about 18 modules and is needed to restore a session at startup, so it stays a separate, preloaded vendor chunk; lazy-loading it would need an async client facade across the app and is not worth the risk.

## Runtime

- **Persistence debouncing** (`lib/storage.ts`: `writeJsonDebounced`, `flushPendingWrites`, `discardPendingWrites`). The library, notifications and settings were re-serialised into localStorage on every state change (metadata refresh updates the library many times in a row). Writes are now coalesced (400 ms) and flushed on `pagehide` and when the window is hidden. `readJson` of a key with a pending write flushes first, and a direct `writeJson` cancels an older pending value, so ordering stays correct. "Reset local data" discards pending writes before clearing so they cannot resurrect it.
- **No re-render on unchanged polling.** `getDownloads` (every 4 s forever), `getActiveSessions`, `getPlaytime` and the installed-status check replaced state with a fresh array on every tick, re-rendering everything under `useApp()`. They now keep the previous reference when the data is structurally equal (`lib/equal.ts`, `keepIfEqual`). Download polling also skips ticks while the window is hidden and catches up on `visibilitychange`.
- **Game cards are `memo`ised.** `GameCard` handlers take the game as an argument so one stable callback serves the whole grid; selecting a card re-renders 2 cards instead of all (`GameCard.test.tsx` counts renders).
- **Cover loading** (`lib/artworkCache.ts`). Every card used to call `get_cached_game_artwork` (returns a data URL) on every mount and keep a private copy. Now: one in-flight call per key, an LRU of 150 covers shared across views, and covers load only when within 400 px of the viewport (IntersectionObserver). Artwork cached natively by metadata refresh now calls `notifyArtworkChanged`, so covers appear without remounting (also invalidates the memory cache). Big Picture's `useArtworkUrl` shares the cache.
- **`MochiIcon`**: each icon instance added its own `mochi-theme-changed` listener and ran `getComputedStyle` on every theme change. Now one shared listener and one computed-style read per variable per theme change (`MochiIcon.test.tsx` asserts a single listener for 25 icons).
- **Images**: `RemoteImage` and the list thumbnails default to `loading="lazy" decoding="async"`.
- **CSS**: removed 170 rules (and dead selectors from grouped rules) for classes no component renders anywhere (legacy setup/import/discover/hero blocks in `index.css`, `bridge.css`, `components.css`, `offline.css`). Rules using `:is/:not/:has` and keyframes are left alone, as are `stats.css` and the achievements UI, which another change owns.

## Looked at and left alone

- **Splitting `AppContext`.** All domain hooks live in one controller, so any state change re-renders every `useApp()` consumer. Real isolation needs selector subscriptions or separate providers per domain, touching about 35 call sites and files other branches are editing. The cheap wins above remove the highest-frequency causes (polling) and protect the heaviest list (cards). Next step if needed: a `useSyncExternalStore`-based `useAppSelector` for Sidebar/Topbar/Footer.
- **Virtualising lists.** With memoised cards, lazy covers and lazy images, a few hundred games render acceptably; a windowing library would change keyboard/gamepad focus behaviour.
- **Intervals**: remaining ones (playtime 15 s only while a game runs, updater check, Stats 30 s, Big Picture clock) are cheap; no native download events exist to replace polling.

## Tooling

- `eslint.config.js` now parses against `tsconfig.test.json`, which includes tests, so `npm run lint` has 0 errors (previously every `*.test.ts` was a parser error after tests were excluded from the build tsconfig).
