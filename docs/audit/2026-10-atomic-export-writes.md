# Security follow-up: atomic export temporary files

**Audit date:** 2026-10-10  
**Scope:** Rust file-writing paths for `.mochipack` exports and `.mochibackup` manual/scheduled backups. This is a targeted follow-up, not a claim that every line of the repository has been exhaustively re-audited in this change.

## Finding A-01 — predictable temporary files followed symlinks

**Severity: Medium (local data integrity / arbitrary file overwrite within the current user's permissions).**

### Affected code

- `src-tauri/src/mochipack.rs` — `write_pack`
- `src-tauri/src/librarybackup.rs` — `write_atomic`, used by manual and scheduled library backups

### What was wrong

Both writers used a predictable temporary pathname by appending `.part` to the selected destination, then called `fs::write`. On Unix-like systems, `fs::write` opens an existing path for truncation and follows a symlink. If a symlink existed at that temporary pathname, saving a modpack or library backup could truncate and replace the symlink target instead of creating a temporary file. This bypassed the intended safety property of writing to a temporary file beside the destination.

The practical impact is local and depends on a hostile or pre-existing filesystem entry; this is not a remote code-execution issue. It can nevertheless destroy user data or overwrite any file the current user can write.

## Improvements in this PR

### 1. Exclusive creation and unique sibling files

- Generate a sibling temporary name using the process ID and an atomic counter.
- Open it with `OpenOptions::create_new(true)`, which refuses existing files and symlinks rather than following or truncating them.
- Retry up to 16 times when a candidate name already exists. This handles stale files from a reused process ID and simultaneous export attempts instead of failing on the first collision.
- Write the complete contents before renaming the temporary file into place, and clean up after write/rename errors.

### 2. Private file permissions on Unix

Temporary export files are created with mode `0600` on Unix, so modpack contents and library backups are not exposed to other local users through permissive directory defaults. The mode is retained when the completed temporary file is renamed into place. On non-Unix platforms, the platform's normal inherited ACL behavior remains in effect.

### 3. Regression tests

Unix-only tests verify that a symlink at the temporary path is rejected without changing its target, and that successfully written modpack and library backup files have mode `0600`.

## Verification and remaining work

The change should remain a draft until the Rust tests and all required GitHub Actions checks pass. This is a targeted follow-up, not a claim that this PR exhaustively resolves every issue across the repository or replaces dependency, platform, and end-to-end security review.