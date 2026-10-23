# Emulators and ROM libraries

Mochi can scan folders of ROMs and disc images, show each one as a game, and start it in the emulator you choose. Nothing is installed or downloaded: Mochi only uses emulators that are already on the computer, and it never touches your ROM files.

## Where
- **Settings > Emulators**: add ROM folders, map each to a system (or leave "Auto by extension"), pick the emulator and RetroArch core per system, and add extra arguments. The settings are stored in `emulators.json` in Mochi's data folder, on this device only (they are not synced).
- **Import**: the "Emulators and ROMs" source lists everything found in the configured folders. Importing creates normal library entries whose launch target is `mochi-emu://<system>?rom=<path>`.

## Systems
NES, SNES, Nintendo 64, Game Boy, Game Boy Color, Game Boy Advance, Nintendo DS, GameCube, Wii, PlayStation, PlayStation 2, PSP, Genesis / Mega Drive, Master System, Saturn, Dreamcast and Arcade (MAME zips). Each has its own ROM extensions; `.zip` and `.7z` are accepted only for the cartridge systems and Arcade, never for disc systems.

In "auto" folders a ROM is assigned by a folder name between it and the folder root (`SNES`, `Sega Genesis`, `psx`, ...), otherwise by an extension only one system uses (`.sfc`, `.gba`, `.gdi`, ...). Shared extensions (`.iso`, `.zip`, `.bin`, `.chd`, `.cue`) in an unnamed folder are skipped: map that folder to a system instead.

## Scanning
- Folders are searched up to 6 levels deep, hidden files and folders are skipped, and symlinked folders are not followed.
- A `.m3u` playlist hides the discs it lists; a `.cue` sheet hides the `.bin` tracks it references. Only the playlist (or the cue) appears as a game.
- Titles lose region and revision tags such as `(USA)`, `(Rev 1)` and `[!]`, and "Zelda, The" becomes "The Zelda". The file name is not changed.

## Emulators
| Emulator | Command | Notes |
|---|---|---|
| RetroArch | `retroarch -L <core> <rom>` | the default core per system is the first installed of a built-in list; override it in Settings |
| Dolphin | `dolphin-emu -b -e <rom>` | GameCube, Wii |
| PCSX2 | `pcsx2-qt -batch -- <rom>` | PlayStation 2 |
| DuckStation | `duckstation-qt -batch -- <rom>` | PlayStation |
| PPSSPP | `ppsspp <rom>` | PSP |
| melonDS, mGBA, Flycast | `<emulator> <rom>` | DS, Game Boy family, Dreamcast |
| MAME | `mame -rompath <folder> <name>` | Arcade |

Found on PATH, as Flatpak apps (Linux; `flatpak run --filesystem=<rom folder>:ro <id> ...`) or as `.app` bundles in `/Applications` and `~/Applications` (macOS, the bundle's own executable is run). RetroArch cores are read from its cores folder (system packages, `~/.config/retroarch/cores`, the Flatpak's own folder, `~/Library/Application Support/RetroArch/cores`). Discontinued emulators (Citra, Yuzu, Ryujinx) are not supported.

Launching builds an argv and never uses a shell. The emulator is the game process, so playtime is tracked like any other direct launch. Per-game launch arguments are added after the system's extra arguments; wrappers (GameMode, MangoHud) and runtimes do not apply to emulators.

## Limits
- Only the emulators above are detected; a custom emulator or portable build is not.
- Flatpak apps cannot be given a ROM folder whose path contains a colon.
- Command lines are verified by unit tests, not against every emulator version or on macOS hardware.
