# Launch options

Per-game launch settings, edited under **Edit game, Launch, Launch options**. They are stored on the game (Piko) as `launchOptions` (`LaunchOptions` in `src/models.ts`) and applied every time Mochi starts it.

## What can be set

| Option | Notes |
| --- | --- |
| Environment variables | Name/value rows. Names must match `^[A-Za-z_][A-Za-z0-9_]*$`; at most 64 variables. |
| Arguments | One text field, split into words like a POSIX shell would (single quotes literal, double quotes with `\"` and `\\`, backslash escapes). Nothing is expanded, and the words are passed as separate arguments (argv), never through `sh -c`. At most 256 arguments. |
| Working directory | Must exist and be a folder. |
| Windows runtime (Linux) | Automatic, system Wine, or a detected Proton (`steamapps/common/Proton*` and `compatibilitytools.d/*` in `~/.steam/steam`, `~/.local/share/Steam` and the Flatpak Steam folder). Only used for `.exe`, `.bat`, `.msi`, `.lnk`. Each game gets its own prefix under `<appdata>/prefixes/<game>-<tofu>`, created on first launch (`WINEPREFIX`, or `STEAM_COMPAT_DATA_PATH` and `STEAM_COMPAT_CLIENT_INSTALL_PATH` for Proton). |
| GameMode, MangoHud, gamescope (Linux) | Wrappers; gamescope takes its own arguments. Each must be on `PATH`, otherwise the launch fails with a clear message. |

On macOS only environment variables, arguments and the working directory are shown; Linux-only options are hidden and ignored.

## The final command

The command is `[gamescope args --] [gamemoderun] [mangohud] [wine | proton run] program [args]`, with the environment applied through `Command::env` and the directory through `current_dir`. The "Final command" box is produced by the launcher itself (`preview_launch_command`, `src-tauri/src/platform/launchopts.rs`), so it is exactly what a launch runs. The quoting in it is for reading only.

## Which games it applies to

| Launch target | Applies |
| --- | --- |
| Program, script, AppImage, `.exe` | Everything. |
| `flatpak://id` | Environment (as `flatpak run --env=K=V`) and arguments. No wrappers, runtime or working directory. |
| `steam://` | Not applied by Mochi. The editor shows the matching Steam launch option string (`K=V gamescope .. -- gamemoderun mangohud %command% args`) with a Copy button. |
| `.desktop`, Minecraft launcher instances, Heroic, Lutris, Bottles, itch, Battle.net | Not applicable; the editor says so. Set options in that launcher, or point the target at the program. |

## Tofu overrides and validation

A Tofu's own launch settings (Manage Tofus) are applied on top of the game's: its variables and working directory win, its arguments replace the game's when set, its runtime wins, and its wrappers are added. Invalid options (bad variable names, NUL characters, oversized values, a missing working directory) are rejected with a message in the editor and at launch. The preview uses the game's first Tofu.

## Limits

Proton and gamescope launches are built and unit-tested but depend on the user's installation. Detected runtimes are cached for ten seconds. Lutris and Bottles runners are not listed.
