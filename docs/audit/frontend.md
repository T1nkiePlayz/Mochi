# Frontend audit (React/TS)

Scope: all of `src/`, build/test tooling. Severity: C critical, H high, M medium, L low, R robustness hardening.
Test column: file in `src/**/*.test.ts(x)` unless noted; "none" means not practical to unit test.

| id | sev | where | issue | fix | test |
|---|---|---|---|---|---|
| F01 | H | state/useCloudSync.ts effect 1 | On account switch the previous account's "ready to push" flag stayed true, so the local library was pushed to the NEW account's cloud (replacing it) before its sync setting loaded | reset `initialized` when the sync effect (re)starts | state/useCloudSync.test.tsx |
| F02 | H | lib/cloud.ts + useCloudSync | Cloud pull replaced local Pikos wholesale, losing installPath, collections, lockedFields, tofu paths/launch config, large artwork | `mergeCloudLibrary` keeps local-only fields | lib/cloud.test.ts |
| F03 | H | lib/storage.ts `readJson` | stored literal `null` returned null; callers (`bigpicture/mode.ts` at module load, accounts, achievements) crashed = white screen | null -> fallback | lib/storage.test.ts |
| F04 | H | state/useLibrary, useProfileStorage | library from storage/cloud not validated (missing tofus, duplicate ids, non-objects) -> render crashes, key collisions | `sanitizeLibrary` | lib/library.test.ts |
| F05 | H | state/useGameActions.ts | `/(?<=...)/` regex look-behind: SyntaxError at parse time on macOS WebKit < 16.4 breaks the whole app | regex without look-behind | none (parse-level) |
| F06 | H | styles / Topbar | At 150% text size (CSS `zoom`) the viewport is <700 CSS px: sidebar hidden and the menu button did nothing, so navigation was impossible | working drawer (`features/nav-drawer.css`, Topbar) | none (CSS) |
| F07 | M | useLibrary stored filter | unknown smart-filter id (renamed in an update) filtered the library to nothing | `sanitizeFilter`, `default` branch | lib/library.test.ts |
| F08 | M | lib/search.ts | `normalizeText` stripped every non a-z0-9 char: CJK/Cyrillic game names were unsearchable | Unicode-aware normalisation | lib/search.test.ts |
| F09 | M | lib/theme.ts `buildTokenSheet` | user theme token values / asset URLs could close the declaration or rule and rewrite the sheet | `isSafeCssValue`, escaped `url()` | lib/theme.test.ts |
| F10 | M | lib/theme.ts `selectTheme` | out-of-order loads when clicking themes quickly applied the wrong theme; initial load could override a user choice | sequence guard | none |
| F11 | M | lib/metadata/merge.ts, metadata.ts, Art/GameArtwork/MochiIcon/... | remote image URLs interpolated into `url('...')` without escaping | shared `cssUrl` | lib/metadata/merge.test.ts |
| F12 | M | discover/Markdown.tsx | remote markdown links of any scheme passed to the native opener; images of any scheme; unbounded size/nesting (stack overflow, quadratic scans) | http(s) only, size and depth caps, catch rejection | components/discover/Markdown.test.tsx |
| F13 | M | lib/mods/sanitizeHtml.ts | tag regex quadratic on `<a "` repeats (UI freeze from a hostile mod description) | bounded attribute run, smaller input cap | lib/mods/sanitizeHtml.xss.test.ts |
| F14 | M | state/useDeepLinks.ts | `decodeURIComponent` threw on malformed `mochi://launch/%E0` (unhandled in listener); startup URL re-handled on effect re-run; launch link before per-account library loaded reported "not in library" | try/catch, handled-once flag, deferred launch in AppContext | none |
| F15 | M | state/useAccount.ts authenticate | Enter in the MFA / e-mail-code field re-ran password sign-in (error or restarted MFA); double submit | route to the active step, busy guard | none |
| F16 | M | state/useAccount.ts | saved accounts from storage unvalidated (crash on `.includes`) | `sanitizeSavedAccounts` | state/useAccount.test.ts |
| F17 | M | useCredentials | previous account's status and typed secrets survived a user change; stale response could win | reset + cancel | none |
| F18 | M | useMetadata.refreshAll | launcher shortcuts (Steam, Lutris) were looked up and had name/art overwritten | filtered out | none |
| F19 | M | useGameMods | auto match result dropped if view closed meanwhile (and remembered as done); used stale piko (could overwrite user link) | functional library update | none |
| F20 | M | mods/ModalShell.tsx | Escape closed the whole dialog even when a dropdown inside was open | defer to open popup | none |
| F21 | M | library/ConfirmDialog.tsx | effect re-ran each parent render, stealing focus back to Cancel | refs, focus once | components/library/ConfirmDialog.test.tsx |
| F22 | M | GameEditor.tsx | saved diff computed against live game: metadata refreshed while editing was overwritten by the stale draft | diff against opening baseline | none |
| F23 | M | useGameActions | double click / repeat launched a game twice | per-game in-flight guard | none |
| F24 | M | useUpdater / lib/updater | update progress ticks wrote localStorage many times a second; GitHub check had no timeout (stuck "checking" forever); offline fetch error reported as error | persist only needed fields, timeouts, offline detection, catch | lib/updater.test.ts (semver) |
| F25 | M | LibraryModSearch | Nexus results unbounded (comment said 5) | slice(0,5) | none |
| F26 | L | usePlaytime, useDownloads, hooks.ts, ModrinthDiscover, useModFeed, useModrinthFeed, ArtworkPicker, ModsBrowser, ProjectDetails, useDiscover | out-of-order responses overwrote newer state; `inFlight` flag cleared by superseded request | sequence guards | none |
| F27 | L | hooks.ts | `isRunning` new function every render invalidated library memos | `useCallback` | none |
| F28 | L | lib/modrinth.ts | `getModrinthVersions` could loop forever; missing `hits`/`downloads` crashed | page cap, defaults | lib/modrinth.test.ts |
| F29 | L | lib/metadata/cache.ts | provider cache unbounded in localStorage (starves library saves) | 400 entry cap | lib/metadata/merge.test.ts |
| F30 | L | lib/launch.ts | env var named `__proto__` | `Object.fromEntries` | lib/launch.test.ts |
| F31 | L | AppContext.resetLocalData | signOut failure skipped reload | try/finally | none |
| F32 | L | useAchievements, StatsView | collections read from the shared key in per-account profile mode | `collectionsKeyFor` | none |
| F33 | L | lib/format.ts | "1 hours ago", NaN bytes | plural/guards | lib/format.test.ts |
| F34 | L | ArtworkCropper, lib/artwork | division by zero (collapsed stage / zero-size image) -> NaN crop | guards | none |
| F35 | L | useLibrary | tofu id collisions (Date.now), quadratic grouping | randomUUID, push | none |
| F36 | L | library/GameCard, TagEditor | long-press flag swallowed next click; IME Enter committed tag | reset flag; skip composing | none |
| F37 | L | settings sections | stale-closure `setBehavior({...behavior})` | functional updates | none |
| F38 | L | Help/ProjectDetails/GameDetails/LibraryModSearch | `target=_blank`/`invoke` opens without catch, unescaped slug | `openExternalUrl().catch`, encode | none |
| F39 | L | ModrinthManager/TofuManager | id collisions, `downloads` undefined crash | random ids, defaults | none |
| F40 | R | lib/cloud pushLibrary | NaN mods / missing tofus | guards | none |
| F41 | R | devMock.ts | missing handlers threw | added | none |

Tooling added: vitest + jsdom + testing-library (`npm test`, also runs the existing node tests), ESLint 10 flat config (`npm run lint`, hooks rules, no-floating-promises; 0 errors, hook-dependency warnings kept as intentional).
Stricter tsc flags (`noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`) were run: no real bugs beyond those above, but 63 index-access findings remain, so the config was not changed (`exactOptionalPropertyTypes` is far noisier and was not adopted).

## Backend findings for the lead
- `open_external_url` accepts `mochi://` URLs; a remote page link could re-enter the app (now blocked on the JS side for markdown).
- Deep link `mochi://launch/<id>` launches without confirmation when "Confirm before launching" is off (desktop shortcuts rely on it); consider a rate limit.
- `mochi:settings` is read at module load by Big Picture; in per-account profile mode the value lives in the profile key, so "Start in Big Picture" is read from a stale shared copy at boot.
- Saved account refresh tokens are stored in localStorage (Supabase session is too); acceptable but worth keychain storage later.

## CI change
`.github/workflows/ci.yml`, `build` job: added steps `npm run lint` and `npm test` right after "Build frontend".
