# Security follow-up: safe temporary file creation

**Audit date:** 2026-10-10  
**Scope:** Rust file-writing paths for `.mochipack` exports, `.mochibackup` manual/scheduled backups, and downloaded mod files. This is a targeted follow-up, not a claim that every line of the repository has been exhaustively re-audited in this change.

## Finding A-01 — predictable temporary files followed symlinks

**Severity: Medium (local data integrity / arbitrary file overwrite within the current user's permissions).**

### Affected code

- `src-tauri/src/mochipack.rs` — `write_pack`
- `src-tauri/src/librarybackup.rs` — `write_atomic`, used by manual and scheduled library backups
- `src-tauri/src/downloads.rs` — `fetch_to_file`, which previously opened a predictable download temporary path with `File::create`

### What was wrong

The export/backup writers used predictable temporary pathnames and `fs::write`; the downloader similarly used a predictable `.mochi-download-N` path and `File::create`. These open calls follow an existing symlink and truncate its target. A pre-created symlink at one of those temporary paths could therefore redirect an export, backup, or mod download into a different file writable by the current user, instead of creating a fresh temporary file.

The practical impact is local and depends on a hostile or pre-existing filesystem entry; this is not a remote code-execution issue. It can nevertheless destroy user data or overwrite any file the current user can write.

## Improvements in this PR

### 1. Exclusive creation and unique sibling files

- Mod downloads now allocate their sibling temporary file with `create_new(true)` and retry up to 16 name collisions, just like the export/backup writers. The cleanup guard is only created after exclusive creation succeeds, so a failed attempt cannot accidentally remove a pre-existing symlink.

- Generate a sibling temporary name using the process ID and an atomic counter.
- Open it with `OpenOptions::create_new(true)`, which refuses existing files and symlinks rather than following or truncating them.
- Retry up to 16 times when a candidate name already exists. This handles stale files from a reused process ID and simultaneous export attempts instead of failing on the first collision.
- Write the complete contents, call `sync_all` before renaming the temporary file into place, and clean up after write/sync/rename errors. This flushes file data and metadata to the OS/device before publishing the completed file; it does not promise that the parent directory entry survives every possible power loss.

### 2. Private file permissions on Unix

Temporary export files are created with mode `0600` on Unix, so modpack contents and library backups are not exposed to other local users through permissive directory defaults. The mode is retained when the completed temporary file is renamed into place. On non-Unix platforms, the platform's normal inherited ACL behavior remains in effect.

### 3. Regression tests

Unix-only tests verify that a symlink at the download temporary path is rejected without changing its target. Export/backup tests verify existing files are replaced with complete new contents without leftover temporary files, and that successfully written modpack and library backup files have mode `0600`.

## Verification and remaining work

The change should remain a draft until the Rust tests and all required GitHub Actions checks pass. This is a targeted follow-up, not a claim that this PR exhaustively resolves every issue across the repository or replaces dependency, platform, and end-to-end security review.