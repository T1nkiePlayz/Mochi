# Storage manager (Settings > Storage)

Shows where disk space goes and frees Mochi's own caches. It never deletes game installs or your mod folders; for those it only offers "Open".

## What is measured
- **Game installs**: each game's install folder (`installPath`).
- **Mods & content**: each Tofu's folder and Minecraft `contentRoot`.
- **Mochi-owned** (found by the Rust side, not sent by the UI): artwork cache, themes and theme fonts, sound packs, game logs, snapshots, save backups, mod records, Wine prefixes. Missing folders count as empty.
- **Rollback copies** (`.mochi-rollback`) and **unfinished downloads** (`*.mochi-download-N`, `.mochi-backup-*`) live inside Tofu folders. They are listed on their own and subtracted from "Mods & content" in the stacked bar so the total is not double counted.

## How it works
`scan_storage` returns a job id and the list of rows, then measures on two background threads and emits `storage-scan-progress` (`{job, key, bytes, files, truncated, done, error}`) so rows fill in as they finish. `cancel_storage_scan(job)` stops it; starting a new scan cancels the old one. It reuses the bounded walker and 30 s cache from `dirsize.rs` (250k entries, 24 levels, 8 s per folder; larger folders show "≥" sizes). Scans only run when you press "Measure disk usage" / "Scan again".

## Clearing
`clear_storage_location(kind, olderThanDays?)` accepts only the `ClearKind` enum: `artworkCache`, `downloadTemp`, `rollbackCopies`, `snapshots`, `logs`. There is no path argument.
- Rollback copies and unfinished downloads only look inside the Tofu folders of the latest scan.
- Unfinished downloads younger than one hour are always kept. Snapshots always need an age.
- Symlinks are never followed; a symlinked cache folder is refused.
- Every action asks for confirmation. Removing rollback copies removes the "Roll back" option of the affected mods.

## Limits
Nested folders (a Tofu inside a game folder) can overlap in the table. The table shows the top 200 rows and a "Show more" button, so thousands of entries stay cheap.
