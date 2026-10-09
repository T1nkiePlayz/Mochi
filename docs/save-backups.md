# Save backups

Mochi can keep zip snapshots of a game's save folders and put one back later. Open a game page and press **Saves**.

## Where saves are found

- **Minecraft**: every instance (Tofu) of the Minecraft Piko is searched for worlds, meaning folders with a `level.dat` in
  `<game folder>/saves` (also `.minecraft/saves` and `minecraft/saves` under the instance). Worlds are listed per instance.
- **Steam**: `<steam root>/userdata/<account>/<app id>/remote` (Steam Cloud files) for Steam games. Roots: `~/.steam/steam`,
  `~/.local/share/Steam`, Flatpak Steam (`~/.var/app/com.valvesoftware.Steam/.local/share/Steam`) and on macOS
  `~/Library/Application Support/Steam`. Roots that resolve to the same folder count once. Saves inside Proton prefixes or
  `Documents` are not guessed; add them yourself.
- **Added folders**: **Add folder** adds any folder to a game (any game, not only Steam). The list is stored on this device only
  (`Piko.saveBackup.folders`) and is never synced.

## Backups

- Stored under `<Mochi data>/save-backups/<location key>/<timestamp>.zip` with an `index.json` per location (the folder path and
  one record per backup) and a `settings.json` (limits).
- Zips are deflate, written file by file with a 64 KB buffer, so memory stays small however big the world is. A backup is written
  to a `.part` file and renamed when complete.
- **Dedupe**: a backup (manual or automatic) is skipped when the folder's fingerprint (sorted relative paths, sizes and
  modification times) equals the newest backup's.
- **Limits** (Apply in the dialog): keep the newest N backups per folder (default 10) and a total size cap (default 2 GB). When
  over the cap the oldest backups go first, but each folder's newest backup and the backup being restored always stay.
- A folder is limited to 200,000 entries and 8 GB; beyond that the backup is refused with a message.

## Restore

**Restore** (disabled while the game runs) does this, in order:

1. extracts the backup into a temporary folder next to the save folder, reading every entry so stored CRCs and the entry count
   are verified (a damaged backup fails here and nothing has changed);
2. takes a **safety backup** of the current folder (kind "Before restore"; if this fails the restore stops);
3. moves the current folder aside, moves the extracted folder into place, then deletes the old one. If the swap fails the old
   folder is moved back.

## Automatic backups

"Back up saves when the game closes" is a per-game setting, on by default for Minecraft and off for everything else. When a game
leaves the running list the app waits 3 seconds, skips the game if it is running again, and asks the native side to back up its
locations one after another (one backup, restore or delete runs at a time). Unchanged folders are skipped by the fingerprint, so
closing a game that changed nothing costs a quick directory walk. A short notice appears only when something was backed up or failed.

## Safety rules

- Folders must exist and be directories. Links at the folder itself are resolved once; **symlinks inside a folder are never followed
  and are left out of the backup**. Special files are skipped too.
- System folders (`/`, `/usr`, `/home`, `/Users`, `/Applications`, `/Library`, ...), the home folder itself or any parent of it, and
  Mochi's own backup store are refused.
- Zip entries are restored only if their names stay inside the target folder.
- Restores always use the folder recorded when the backup was made, never a path sent from the UI.

## Not covered

Saves kept in Wine/Proton prefixes, cloud-only saves, and registry-based saves are not discovered automatically. Files being written
by a running game can be captured mid-write; close the game first for a perfect snapshot.

## Code

`src-tauri/src/savebackup.rs` (commands `list_save_locations`, `create_save_backup`, `list_save_backups`, `restore_save_backup`,
`delete_save_backup`, `auto_backup_saves`, `get/set_save_backup_settings`), `src/lib/saveBackups.ts`,
`src/components/SaveBackups.tsx`, `src/state/useSaveBackupOnExit.ts`.
