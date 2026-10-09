# Tofu snapshots

A snapshot is a saved state of one Tofu's mod files plus its `mods.json` records. Mochi takes one before it rewrites mods, so a bad update can be undone with one click: **Manage Tofus > Snapshots > Restore last working state**.

## When snapshots are taken

- Before a single mod update (`applyModUpdate`) and before "Update all" / automatic updates at launch (one snapshot for the whole batch, `applyUpdates`).
- Manually with "Take snapshot now".
- Before every restore (a "Before restore" safety copy, so a restore can itself be undone). Safety copies are never offered as the "last working state".
- Other features that rewrite many files (dependency installs, multi-installs) should wrap their work in `withSnapshot(tofu, reason, fn)` from `src/lib/mods/snapshots.ts`.

If nothing changed since the latest snapshot, no new one is stored; the latest is reused.

### If the snapshot cannot be saved

`withSnapshot` runs the snapshot first and then `fn`. If the snapshot fails (disk full, unreadable file), `fn` is not run and a `SnapshotError` explains that nothing was changed. Two cases are not failures and `fn` runs anyway: the Tofu is larger than the size limit (`snapshot-too-large:`), or there is no mod folder yet (`snapshot-empty:`). A Tofu without a folder just runs `fn`.

## What is stored

`<app data>/snapshots/<tofu id>/<timestamp-id>/` holds `manifest.json` (folders, and per file: folder index, name, size, SHA-1, mtime), `mods.json` (copy of the Tofu's records) and `files/<folder index>/<file name>`.

- Covered folders: the Tofu's mods folder and its resourcepacks and shaderpacks folders (those that exist).
- Only regular files with a mod/content extension directly inside those folders (including `.disabled` ones). Sub-folders, symlinks and other files are ignored.
- Files are hard-linked, to the previous snapshot's copy when the SHA-1 matches, otherwise to the live file, so snapshots cost almost no disk. If the filesystem cannot hard-link (another volume), files are copied and verified.
- Limits: last 5 snapshots per Tofu; 2 GB of unique file data per Tofu (hard-linked duplicates count once). Older snapshots are pruned first. A Tofu whose files alone exceed the limit is not snapshotted.

## Restore

1. The snapshot is verified (every file present, size and SHA-1 match). A damaged snapshot is refused before anything changes.
2. The current state of the same folders is saved as a "Before restore" snapshot.
3. Each folder is made to match the snapshot: changed or missing files are copied back (through a temp file, SHA-1 checked before the rename), mod files that are not in the snapshot are removed, and `mods.json` is restored.
4. Restored files are verified again. Any failure rolls back to the safety snapshot.

In a folder shared by several Tofus, the whole folder (including other Tofus' disabled files) is restored together, since the files are not separable.

## Safety

- Folders must be absolute, free of `..`, real directories (a symlinked folder is refused), not near the filesystem root and not Mochi's own snapshot store. Paths are canonicalised; restore refuses a folder that now resolves elsewhere.
- Symlinked files are never read, linked or deleted. Nothing outside the folders is written.
- Hard links share data with the live file: a mod file edited in place (rather than replaced) also changes its snapshot copy. The SHA-1 check at restore detects this and refuses the snapshot. Mochi's own updates replace files, so they never do this.
- Snapshots are local data only and never contain data from mod sites beyond what is already in `mods.json`.

## Commands

`create_tofu_snapshot(tofuId, folders, reason)`, `list_tofu_snapshots(tofuId)`, `restore_tofu_snapshot(tofuId, snapshotId)`, `delete_tofu_snapshot(tofuId, snapshotId)` in `src-tauri/src/modsnapshot.rs`. All run on the blocking pool and are serialised.
