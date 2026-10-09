# Desktop shortcuts and Add to Steam

The game page has a **Shortcuts...** menu (keyboard: Tab to the button, Enter, arrow/Tab through the items, Escape closes).
Every shortcut opens `mochi://launch/<pikoId>`, the link scheme Mochi registers at start-up (the `mochi launch <id>` CLI from
the deep-link work uses the same ids). A link is used instead of a hard-coded binary path so shortcuts survive an AppImage being
moved or updated and work for packaged installs; the handler is re-pointed at the current binary every time Mochi starts.

## Linux

* **Application menu**: `~/.local/share/applications/mochi-<id>.desktop` (`$XDG_DATA_HOME` is honoured).
* **Desktop**: the same file in the folder reported by `xdg-user-dir DESKTOP` (or `~/Desktop`), marked executable, plus a best-effort
  `gio set <file> metadata::trusted true` so GNOME lets you run it. Only offered when that folder exists.
* `Exec=xdg-open mochi://launch/<id>` (`%` doubled as the Desktop Entry spec requires); the name has backslashes escaped and control characters removed.
* `Icon=` is the game cover, fitted into a transparent 256 px square at `<Mochi config>/shortcut-icons/<id>.png` (the Mochi icon when there is no cover).

## macOS

A small app bundle in `~/Applications/<Name>.app`: `Contents/Info.plist` (`CFBundleIdentifier` = `app.mochi.shortcut.<id>`, `LSUIElement` so no Dock flash),
`Contents/MacOS/launch` (`exec /usr/bin/open "mochi://launch/<id>"`) and `Contents/Resources/icon.icns` (PNG-based icns built in Rust, no `sips`/`iconutil`).
If another game's shortcut already uses the name, the folder becomes `<Name> (<id>).app`. The bundle is unsigned; it is created locally so Gatekeeper does not quarantine it.

## Add to Steam (non-Steam game)

Steam stores these in `userdata/<account>/config/shortcuts.vdf` (binary VDF). Mochi looks in `~/.local/share/Steam`, `~/.steam/steam`,
the Flatpak Steam data folder and, on macOS, `~/Library/Application Support/Steam`, and lists each account (names from `loginusers.vdf`); with several accounts you pick one.

* The new entry: `appid` (CRC-32 of the quoted exe + name, high bit set, as Steam computes it), `AppName`, `Exe` (`"xdg-open"` / `"/usr/bin/open"`),
  `StartDir`, `icon`, `LaunchOptions` = the `mochi://launch/<id>` link, and the usual flag fields. An entry with the same launch options or app name is not added twice.
* Before writing, the existing file is copied to `shortcuts.vdf.mochi-backup-<unix time>` and the new file is written atomically. The file is parsed strictly and
  written back byte-for-byte; if it has a layout Mochi does not understand it is left untouched and an error is shown.
* **Steam rewrites this file when it exits**, so if Steam is running Mochi asks before writing (and the change may be lost); close Steam first for a reliable result, then restart it.

## Limits

* Steam shows the game with the cover as icon only; grid/hero artwork is not written. Steam tracks the short-lived `xdg-open`/`open` process, not the game, so Steam playtime/"Playing" status is not accurate. Flatpak Steam needs access to the host `xdg-open`.
* Removing a game from Mochi does not delete its shortcut files or Steam entry.
* Not verified on real Steam / real macOS hardware; unit tests simulate the file layouts.
