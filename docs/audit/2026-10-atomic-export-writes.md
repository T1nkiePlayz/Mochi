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

### 1. One shared writer (`util/fsio.rs`)

The shared atomic writer now creates its sibling temporary file with `create_new(true)` (an existing file or symlink is refused, never followed or truncated) and retries up to 16 times on a name collision. Every caller of `write_atomic`, `write_atomic_durable` and the new `write_atomic_private` gets this, including config, themes, playtime and artwork writes.

- `write_atomic_private` also calls `sync_all` before the rename and creates the file with mode `0600` on Unix. `.mochipack` exports and `.mochibackup` manual/scheduled backups use it, so the library contents are not readable by other local users. On other platforms the inherited ACLs apply.
- `sync_all` flushes the file data before it is published; it does not promise that the parent directory entry survives every possible power loss.
- Temporary names start with `.`, so scheduled-backup listing and pruning never see them.

### 2. Downloads

`fetch_to_file` allocates its `.mochi-download-N` temporary file with `create_new(true)` and the same retry. The cleanup guard is created only after exclusive creation succeeds, so a failed attempt can never delete a pre-existing symlink.

### 3. Regression tests

Unix-only tests check that a planted symlink is refused and left untouched (shared writer and download temp), that replacing an existing export or backup leaves complete new contents and no temporary files, and that exports and backups have mode `0600`.

## Verification and remaining work

The change should remain a draft until the Rust tests and all required GitHub Actions checks pass. This is a targeted follow-up, not a claim that this PR exhaustively resolves every issue across the repository or replaces dependency, platform, and end-to-end security review.