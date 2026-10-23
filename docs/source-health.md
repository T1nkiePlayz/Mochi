# Source health check

Mochi reads other launchers' local files (Steam, Heroic, Epic, Lutris, itch.io and so on). When a launcher changes its file format, a scanner used to find nothing and Mochi showed no games without saying why. The source health check records what each scan could and could not read.

## Where
- Settings > Library tools > **Source health**: press **Run check**. Each launcher gets a status pill and an expandable list of files examined and failures with a short reason. Launchers that are not installed are hidden.
- After an import scan (or the background library watcher) one notification names launchers that are unreadable or partly unreadable, or that went from having games to none while their files still exist. The same problem is announced once, not on every re-scan.
- **Copy debug info** (Settings > Data) includes a "Source health" section.

## Statuses
- `ok`: files read, games found.
- `not_installed`: no launcher data found on this machine.
- `empty`: the launcher is present but has no games to import.
- `partial`: some files could not be read or parsed (the others still import).
- `parse_error`: every file examined failed.

## How it works
- `src-tauri/src/sources/health.rs` holds a per-thread collector that scanners report to while `detect_import_sources` / `scanner_health` run. Outside a check nothing is recorded, and scanners return exactly the same games as before.
- Failures are files that exist but are unreadable, invalid JSON/VDF/gzip, or valid files whose expected keys are gone. Missing files are not failures.
- Paths are shown with your home folder replaced by `~`.
- The last known game count per launcher is kept locally (`mochi:source-health-counts`) to spot games that vanished.

## Limits
- A launcher that silently changes semantics but keeps a readable format is not detected.
- Launcher CLIs (Lutris, Bottles) are checked by their output, not by files.
- Battle.net, GOG Galaxy and Prism paths are not checked in detail on macOS.
