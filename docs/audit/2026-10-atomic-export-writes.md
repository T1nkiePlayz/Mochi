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

### Fix

- Generate a distinct sibling temporary name using the process ID and an atomic counter to avoid normal collisions and stale `.part` files.
- Open the temporary path with `OpenOptions::create_new(true)`. The exclusive create fails if a file or symlink already occupies that exact name; it does not truncate or follow the existing entry.
- Write the full contents, remove the temporary file after a write/rename failure where safe, and rename the completed file into place.
- Keep the existing size limits, extension validation, and same-directory rename behavior.

### Regression coverage

Both Rust modules now have Unix-only regression tests that place a symlink at the temporary path, attempt the write, and assert that the operation fails, the symlink remains a symlink, and its target contents are unchanged.

## Verification and remaining work

The code change adds focused regression tests, but those tests and the complete CI workflow must pass before this PR should be considered ready to merge. This patch does not claim to resolve unrelated audit items or replace dependency, platform, and end-to-end security review.