# Achievements: Steam achievements and a bigger Mochi catalogue

## Steam achievements in a game's Overview

Imported Steam games (and any game launching `steam://rungameid/<appid>`) show a **Steam achievements** section in
`GameDetails`: unlocked/total, a progress bar, and a list with icon, name, description and unlock date. Locked ones are
greyed (the grey icon Steam provides, or a grayscale filter), hidden ones are masked until unlocked. The first 8 are shown
with a "Show all" toggle.

### Where the data comes from (no key required)

`src-tauri/src/steam_achievements.rs` (commands `get_steam_achievements`, `get_steam_achievement_totals`):

1. **Account**: SteamID64 from the local Steam install, `config/loginusers.vdf` (most recent account), falling back to
   `userdata/<accountid>` folders. Install folders come from `sources::steam_install_roots`, which uses the existing
   per-OS `steam_roots` (Linux native and Flatpak, macOS `~/Library/Application Support/Steam`). The user may override the
   id in the section's "Connect your Steam profile" disclosure.
2. **Profile XML**: `https://steamcommunity.com/profiles/<id64>/stats/<appid>/?xml=1&l=english`. Works when the profile's
   "Game details" are public.
3. **Optional Web API key**: if the user typed their own key there, `GetPlayerAchievements` + `GetSchemaForGame` are used
   first (works for private profiles). The key is stored only in this device's localStorage, never synced, never shipped, and
   errors are mapped without their URL so the key cannot leak into messages. If the key route fails, the XML route is tried.

Results: `ok`, `private`, `no-achievements`, `no-steam-user`, `offline`, `error`, plus `stale` when an older cached copy is
served because the network failed. The command never rejects, so the UI always shows a clear message.

Safety and limits: 4 MB body cap, 8 s connect / 20 s total timeout, at most 1000 achievements, at most 3 redirects and only
to `steamcommunity.com`, `www.steamcommunity.com` or `api.steampowered.com` over https. Icon URLs are kept only when https
(http upgraded) on `*.steamstatic.com` or `steamcdn-a.akamaihd.net`; everything else is dropped. Added
`https://steamcdn-a.akamaihd.net` to the `img-src` CSP (the `*.steamstatic.com` host was already allowed). No `connect-src`
change: requests are made by Rust, not the webview.

Cache: `<app data>/steam-achievements/<id64>_<appid>.json` (Steam data, fine to keep offline) plus a small `index.json` of
per-game totals used for library-wide numbers. Fresh for 20 minutes; the Refresh button forces a reload. Stale copies are
used on any failure.

macOS: the code is OS-neutral apart from `steam_roots` (already per-OS). Not built on macOS here.

## Stats > Achievements

The catalogue grew from 22 to 77 achievements in 8 categories (Playtime, Streaks, Habits, Variety, Library, Explore,
Mods, Steam). Definitions live in `src/lib/achievementDefs.ts` (add one entry, or one tier of a `ladder`), types in
`achievementTypes.ts`, the engine in `achievements.ts`.

- **Tiers**: ladders (hours, sessions, streaks, collection size, themes, mods, Steam unlocks...) carry `tier`/`tierCount`;
  locked tiers collapse to the next one so the grid stays readable, earned tiers all show. Rarity runs common to legendary,
  and some are hidden mysteries.
- **UI**: category chips with `done/total`, All/Unlocked/Locked filter, progress bars with `aria-valuetext`, "Tier II of V".
- **Steam achievements**: unlock totals and perfect-game counts. They are `requires: "steam"`: until any Steam data has been
  loaded they show "Needs Steam data" instead of a misleading 0. A **Sync Steam achievements** button loads every Steam game
  one by one (stops cleanly on private profile / offline), and opening a game's Overview also feeds the totals.
- **New signals**: controller used (native pads or input device), Big Picture opened, sections of the app visited, themes,
  mods, favourites, distinct tags, collection sizes, genres/launchers played, festive days, returning after a long break.

### Efficient evaluation

`buildFacts` makes one pass over history (sessions are split at midnight once and indexed by day) and one over the library;
every rule is then a constant-time function of the resulting `Facts`, so more achievements add no extra scans. The
"games in a week" rule is a sliding window over sorted days (previously 7 lookups per played day). A 30,000 session history
with 300 games is evaluated in a unit test with a loose 2.5 s ceiling (it takes a few tens of ms).

### Unlock safety

Unlocks are stored by id forever (existing ids unchanged). Because the catalogue grew, `CATALOG_VERSION` makes the first run
after the update unlock whatever is already earned silently; later bursts of more than three unlocks collapse to one summary
toast.

## Tests

- Rust (11 new, fixtures in `src-tauri/fixtures/steam_*`): XML parsing, private/no-data/hostile inputs, 1000 cap, Web API
  merge, icon and host allow-lists, loginusers and userdata detection, cache + index round trip.
- Vitest: catalogue integrity (unique ids, tier monotonicity, shipped ids preserved), every new fact, Steam availability,
  tier collapsing and filters, performance; `steamAchievements.test.ts` for sorting and totals.

## Not done / notes

- Local `appcache/stats/UserGameStats_*.bin` (offline unlock data from the Steam client) is not parsed; offline relies on the
  cache from a previous online load.
- Steam achievement counts only include games whose achievements were loaded (Overview or Sync button).
- Dev mock: app 440 simulates a private profile, 570 no achievements, others show 4 of 8.
