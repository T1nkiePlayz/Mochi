# Game news (experimental, id `game-news`)

Off by default; enable it in Settings > Experimental. It adds a **News** tab to the notification popover (the bell in the top bar).

## What it shows
- **Steam news** for every Steam game in the library (games that launch through Steam; launchers are skipped): the latest posts from the keyless `ISteamNews/GetNewsForApp` endpoint (3 posts per game, plain-text excerpt of at most 300 characters). Clicking a post opens it in the browser.
- **Mod updates**: updates already found by the mod update checks (see [mods.md](mods.md)). Nothing extra is requested; the list is read from the in-memory results.

## How it works
- The request runs in Rust (`src-tauri/src/steam_news.rs`, command `get_steam_news`) so the web view's CSP is not widened. Responses are size-capped, only `https` links are kept.
- Polling (`src/state/useGameNewsPoller.ts`, rules in `src/lib/gameNews.ts`) runs only while the feature is on, Mochi is online (`src/lib/offline.ts`) and the window is visible. Each game is fetched at most once every 6 hours, up to 50 games per cycle (oldest first), one at a time with a 1.5 s pause. The first check happens 20 s after start, then a cycle is attempted every 10 minutes and when the window becomes visible.
- Posts are de-duplicated by their Steam `gid`. A game's first fetch fills the News tab without notifying, so a new library does not flood you. Later new posts and new mod update versions are announced through the notification centre as one grouped notice per burst (`group: "news"`, e.g. "5 news updates").
- The latest 100 items and the seen ids are stored in the browser storage key `mochi:game-news`. Steam news is public data; mod update information is never written to disk.

## Limits
- Only Steam games get news; other stores are not covered. News is not fetched offline and a failing game is retried after 6 hours.
- The unread count on the bell is based on post dates versus the last time the News tab was opened.
