# Steam Deck and Big Picture

## Big Picture mode

A full-screen, controller-first view of your library (`src/bigpicture/`): artwork-backed home with a hero for the focused game and shelves (Continue playing, Favourites, Recently added, one per platform, Launchers), a game page (Play/Stop, playtime, genres, description, screenshots), a top bar (clock, battery, controller, downloads), a side menu (Library, Downloads, Theme, interface sounds, Controller settings, Suspend on Linux, Exit, Quit) and a context-aware button legend. A "Now playing" pill with Return and Stop appears while a game runs. Motion respects `prefers-reduced-motion` and the accessibility "reduce motion" setting. It is themed with the same tokens as the rest of Mochi; the root element carries `data-mochi-mode="bigpicture"` on `<html>`.

Ways in: the TV button in the top bar, F11, holding Start + Select on a controller, "Open Big Picture" in the tray menu, `mochi --big-picture`, the `mochi://bigpicture` link, or the "Start in Big Picture" setting. Starting `mochi --big-picture` while Mochi is already running switches the running instance. Ways out: Menu > Exit Big Picture, F11, or Start + Select again.

Keyboard: arrows move, Enter selects, Esc/Backspace goes back, M menu, X favourite, Y search, Q/E jump between shelves.

## Start in Big Picture, including at login

Settings > "Big Picture & Steam Deck" > "Start in Big Picture". It is stored in `Behavior.bigPictureOnStartup`, which `AppContext` reads synchronously from local storage, and the Big Picture state is initialised from the same value (plus the launch flags injected by `window.__MOCHI_BOOT__`) before the first render, so Mochi opens straight into Big Picture without flashing the normal UI, then goes full screen.

"Start with Mochi at login" writes an autostart entry that runs `mochi --autostart` (`~/.config/autostart/*.desktop` on Linux, the LaunchAgent plist on macOS). The flag is only informative; the setting decides the mode.

## Steam Deck

Detected in Rust (`src-tauri/src/bigpicture.rs`) via DMI `product_name`/`board_name` (`Jupiter`, `Galileo`), `SteamDeck=1`, `os-release` (`ID=steamos`, `VARIANT_ID=steamdeck`); gamescope via `GAMESCOPE_WAYLAND_DISPLAY` or the session desktop. Both are exposed by `get_platform_capabilities` (`isSteamDeck`, `isGamescope`; always false on macOS).

- In a gamescope session (Steam Gaming Mode) Big Picture is the default, until you choose otherwise in Settings.
- The window is 1280x800 by default; Big Picture uses fluid sizes and large touch targets. On a Deck, the normal UI also gets 44px minimum touch targets (`html[data-steam-deck="true"]`).
- Text fields open the built-in on-screen keyboard when confirmed with a controller or Steam Input.
- Fullscreen uses the Tauri window API (capability `src-tauri/capabilities/bigpicture.json`); gamescope already presents windows fullscreen so Mochi does not toggle it there.

### Adding Mochi to Steam

In Desktop Mode: Steam > Add a Non-Steam Game > Mochi, then set the launch options to `--big-picture` if you want it to open straight into Big Picture. Use the default Steam Input "Gamepad" template; the Deck's own controls then appear as an Xbox pad that Mochi recognises as a Deck.

## Developing without a Deck

`npm run dev` and open `/?bigpicture` (Big Picture), `/?deck` (pretend Steam Deck) or `/?deck&gamescope`. Connect a controller to a browser and the web Gamepad API fallback drives it.

## macOS

The same code runs on macOS; Steam Deck detection is always false, battery uses `pmset -g batt`, suspend uses `pmset sleepnow`. The macOS paths could not be built or run in the Linux development environment and need a check on a real Mac.
