# Missing paths after sync

A game synced from another machine can point at an executable that does not exist here. Mochi checks for this and helps you fix it. Nothing is deleted and no game file is touched.

## What is checked

After startup and after a cloud sync or any edit that changes a path (debounced, in the background), Mochi checks the local paths of each game and its Tofus: executable, install folder, working directory and mod/instance folders. Launcher targets (`steam://`, `heroic://`, `flatpak://`, Epic, itch, Lutris ids and similar) are never reported as missing.

## Where it shows

- A *Missing on this device* badge on the game card, and a notice on the game page.
- On the game page, *Locate...* opens a file or folder picker for each missing path. *Find automatically* rescans your launchers (the same scan as Import) and proposes a path; you confirm it.
- *Settings > Data > Fix missing paths* and the command palette entry *Fix missing paths* open one review sheet with every proposal and a per-row *Accept*, plus *Accept all store ID matches*.

## How matches are found

1. By store identity: source plus store id (Steam appid, Heroic app name, Epic/GOG/itch/Lutris/Flatpak id, desktop entry name). Different sources never match.
2. Otherwise by exact normalized name from the same source, marked as a lower-confidence match. Names that match more than one installed game are not proposed.

## Where the fix is saved

The executable path is synced metadata, so a fix is stored as a device-local override: this device launches the new path, while Mochi keeps the originally synced value (`pathOverride`) and keeps uploading that value. Your other machines are not broken, and a pull from the cloud does not undo the fix. If the path changes in the cloud afterwards, the newer cloud value wins. Install folders, working directories and mod folders are already local to the device.

## Limits

Merged duplicates are checked per source: each Play via source path that is missing is listed and can be located by hand. Name-only matches for games that have no source are offered from any source, so check them before accepting. The check re-runs when a game path changes (and at startup), not on a timer, so a folder that disappears while Mochi is open is noticed at the next start.

Only local filesystem paths are checked, and only the sources Mochi can scan. Games from other machines that no launcher here lists must be located by hand.
