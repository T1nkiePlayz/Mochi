# Mochi on macOS

## Where things live

| What | Location |
| --- | --- |
| Config, themes, artwork cache | `~/Library/Application Support/Mochi` (Tauri `config_dir()` + `Mochi`; `app.appDirectoriesOverride.config` in `tauri.conf.json` points `app_config_dir()` at the same place) |
| Playtime, sessions, Wine prefixes | `~/Library/Application Support/dev.sidequestgames.Mochilauncher` |
| Caches (API responses) | `~/Library/Caches/dev.sidequestgames.Mochilauncher` |
| Logs | `~/Library/Logs/dev.sidequestgames.Mochilauncher` |
| Start at login | `~/Library/LaunchAgents/dev.sidequestgames.Mochilauncher.plist` |

Linux keeps XDG semantics (`$XDG_CONFIG_HOME/Mochi`, `$XDG_DATA_HOME/<id>`). `platform::resolve_user_dir` is the single helper for native code; it is unit-tested for both OSes.

"Clear app data" removes the config folder, the API cache and playtime history. Wine prefixes are left alone.

## Installing

Mochi never copies itself. Drag `Mochi.app` to Applications. The start-at-login setting refuses to register an app that runs from a mounted DMG or from Gatekeeper's temporary "App Translocation" path, because that path disappears. The LaunchAgent starts the bundle through `open -a`, loads at the next login, and is removed again by switching the setting off (no `launchctl` is run, so toggling never starts a second copy or stops the running one).

## Sign-in links (`mochi://`)

* The scheme is declared once, in `tauri.conf.json` under `plugins.deep-link.desktop.schemes`. The Tauri bundler turns it into `CFBundleURLTypes` in the built `Info.plist`; the release workflow checks this on the macOS runner. On macOS it cannot be registered at runtime, and it does not work with `tauri dev` (only a built `.app` is registered with Launch Services).
* macOS delivers the URL to the running (or starting) app as an Apple event. The deep-link plugin turns it into `onOpenUrl` / `getCurrent()` for the frontend; Mochi also handles `RunEvent::Opened` to bring a window hidden in the menu bar forward. Single-instance does not see URLs on macOS (nothing is passed in argv).
* Linux receives the URL as the only argument of a new process; single-instance forwards it to the running one and the window is shown. Mochi rewrites the `x-scheme-handler/mochi` desktop entry to the installed AppImage copy.
* Provider sign-in (Google, GitHub, account linking) opens the system browser and returns through `mochi://auth/callback` (`src/lib/auth.ts`, `src/lib/deepLinkAuth.ts`); Google rejects embedded web views such as WKWebView. The callback may carry tokens in the query or the URL fragment, or a PKCE `code`. The user is asked to confirm before a session is installed. Email-verification links use `mochi://auth/verify?token_hash=...&type=email`.
* **Owner action:** add `mochi://auth/callback` and `mochi://auth/verify` to Supabase > Authentication > URL Configuration > Redirect URLs. Without it Supabase falls back to the site URL and the browser never returns to Mochi.

Testing: build (`npm run tauri build -- --bundles app`), run `open -a Mochi`, then in Terminal `open "mochi://launch/some-game-id"` and `open "mochi://auth/callback?access_token=x&refresh_token=y"` (the app asks for confirmation; x/y fail with an error, which proves the path works). Do it with the window closed to the menu bar to check it comes forward. Linux: `xdg-open "mochi://bigpicture"`.

## Importing games

| Source | Where Mochi looks | Launch |
| --- | --- | --- |
| Steam | `~/Library/Application Support/Steam/steamapps`, every library in `libraryfolders.vdf` (both formats), `userdata/*/config/shortcuts.vdf` | `open steam://rungameid/<id>` |
| Heroic | `~/Library/Application Support/heroic`: Legendary, GOG, Nile and sideloaded installs, names from the library caches | `open heroic://launch?...` |
| Epic Games Launcher | `.../Epic/EpicGamesLauncher/Data/Manifests/*.item` | `open com.epicgames.launcher://apps/<AppName>?action=launch&silent=true` |
| itch.io | receipts under `~/Library/Application Support/itch` | the game's own `.app` when it is unique, otherwise `itch://games/<id>` |
| Whisky | `~/Library/Containers/com.isaacmarovitz.Whisky/Bottles/*/Metadata.plist` pins (format inferred from Whisky's source, not verified on a real machine) | `open -a Whisky.app <exe>` |
| Battle.net | `/Users/Shared/Battle.net/Agent/product.db` (the agent's protobuf database: installed products and their folders) | `open battlenet://<code>` (WoW, D3, Pro, WTCG, ...) |
| GOG Galaxy | `.app` bundles with a `goggame-<id>.info` file in /Applications, ~/Applications and the library folder from `/Users/Shared/GOG.com/Galaxy/Configuration/config.json` (no SQLite needed) | `open <bundle>` |
| Minecraft instances | `~/Library/Application Support/{PrismLauncher,FjordLauncher,PolyMC,multimc}/instances` (or `InstanceDir` from the launcher's `.cfg`); version and loader from `mmc-pack.json` | `open -b <launcher bundle id> --args --launch <instance>` |
| Applications | `.app` bundles in /Applications and ~/Applications (two levels, symlinked bundles followed) whose `Info.plist` says `LSApplicationCategoryType` games, CrossOver program launchers, and known launchers (Battle.net, GOG Galaxy, Epic, Prism, CrossOver, ...) | `open <bundle>` |

Not imported: CrossOver bottle contents. Bundle icons (`CFBundleIconFile`, the largest PNG inside the `.icns`) become the cover of games that have no artwork yet. Not verified on a real Mac: the Battle.net launch codes for newer products, the Fjord/PolyMC bundle identifiers, and Galaxy's `config.json` key names (several spellings are read).

## Playtime

Games started with `open` are children of launchd, not Mochi. Mochi matches processes from `ps -axww` output by the bundle path or install folder (and Steam's folder), follows their children, and ends the session 12 seconds after the last one exits. Steam app-id environment variables are not readable on macOS, so only paths are used.

## Entitlements

`entitlements.plist` only contains `com.apple.security.network.client`. The web view runs in Apple's WebContent process, Mochi has no JIT, and games are separate processes, so `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation` were removed. This could not be tested on a Mac here: if a notarized build refuses to start, the first thing to try is re-adding `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`.

## Other notes

Minimum macOS is 12.0. Notifications go through the notification centre (`mac-notification-sys`) with Mochi's bundle identifier, so they show Mochi's name and icon; outside a `.app` bundle (dev builds) or if the centre refuses, Mochi falls back to `osascript` (shown under "Script Editor"). Text is escaped and length-limited. The default Tauri menu supplies the Edit menu (Cmd+C/V/A), Cmd+W hides to the menu bar, Cmd+Q quits and credits running games, clicking the Dock icon reopens the window. The tray icon is the colour app icon (not a template image).
