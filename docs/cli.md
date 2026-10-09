# Command line and `mochi://` links

Mochi understands a small, fixed set of commands. They only ever act on games that are already in your library, and
they never run anything you type: the game is started inside Mochi through the normal launch path, so playtime
tracking, launch options and mod sync all apply (and so does "confirm before launching", if you turned it on).

| Command | Link | Does |
| --- | --- | --- |
| `mochi launch <game>` | `mochi://launch/<game>` | Starts the game |
| `mochi open <game>` | `mochi://open/<game>` | Shows the game's page (never starts it) |
| `mochi list [--json]` | | Prints your library (id and name, tab-separated) and exits, without opening Mochi |
| `mochi help` | | Prints the usage |
| `mochi --big-picture` | `mochi://bigpicture` | Opens Big Picture mode (existing) |

`<game>` is a game's id or its name. Spaces are fine (`mochi launch Hollow Knight`); in links write them as `%20`.

```sh
mochi list
mochi launch Celeste
mochi launch "hollow knight"
xdg-open "mochi://launch/Hollow%20Knight"
```

## How a game is found

The first rule that matches anything decides: exact id, exact name (ignoring case), a name that starts with your
text, a name that contains it. One match runs; several matches open a chooser inside Mochi (arrow keys and Enter, Esc
cancels). No match shows "No game in your Mochi library matches ..." in Mochi, and on the command line prints that to
stderr and exits with code 2.

## Running Mochi

- Mochi closed: it starts and then runs the command once your library has loaded.
- Mochi running (also hidden in the tray): the command is forwarded to it, the window is brought back, and no second
  copy starts.

Exit codes: `0` done (or handed to Mochi), `2` the game is not in the library, `1` anything else (unknown command, no
library index yet).

## Library index (`mochi list`)

The library lives inside Mochi's own storage, so the command line cannot read it. While Mochi runs it writes
`library-index.json` (ids, names, kind; read-only, nothing else) to its data folder two seconds after the library
changes:

- Linux: `~/.local/share/dev.sidequestgames.Mochilauncher/` (or under `$XDG_DATA_HOME`)
- macOS: `~/Library/Application Support/dev.sidequestgames.Mochilauncher/`

`mochi list` therefore shows the library as of the last time Mochi ran, and a game added a moment ago may be reported as
not found until the index is written. Mochi keeps one library per signed-in account; the index follows whichever one was
open last.

## Safety

- Only the verbs above are accepted. Any other link or command is ignored.
- A query is plain text of up to 200 characters without control characters; it is compared with library entries and
  is never passed to a shell or used as a path or command.
- `open` and `launch` need the game to exist in your library. Links from web pages can therefore only start games you
  already added.
- `mochi://auth/...` (sign-in) and `nxm://` (Nexus Mods) links are handled separately and unchanged.

## Link registration

- Linux: the `.desktop` entry declares `MimeType=x-scheme-handler/mochi`, and Mochi registers itself at startup
  (`plugins.deep-link.desktop.schemes` in `tauri.conf.json`).
- macOS: the bundle declares the `mochi` scheme (`CFBundleURLTypes`, generated from the same deep-link configuration).
  macOS only learns about it once Mochi is in /Applications (or has been opened once).
