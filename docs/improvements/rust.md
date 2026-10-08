# Rust backend improvements

Branch `improve/rustq`. Behaviour is unchanged; each item has a reason (perf, correctness, duplication).

## Release binary (`cargo build --release`, Linux x86_64)

| Profile | Size |
| --- | --- |
| before (cargo defaults) | 27,498,072 B (26.2 MiB) |
| `lto="fat"`, `codegen-units=1`, `strip`, opt-level 3 | 14,778,880 B (14.1 MiB) |
| same with `opt-level="s"` (chosen) | 11,485,568 B (11.0 MiB), -58% |

`panic = "abort"` was deliberately not used: the code relies on contained panics (`JoinHandle` errors from
`spawn_blocking`, poison recovery), and abort would turn a bug in one task into an app crash.
Dependency trimming: dropped the unused `base64 0.21` duplicate (now 0.22, already in the tree) and enabled reqwest `gzip`.
`image`, `zip`, `reqwest` already had default features off; `zip` needs `deflate` (it enables flate2's backend).

## Shared helpers (`src-tauri/src/util/`)

Replaced several private copies, each with tests:

- `util::fsio::write_atomic` / `write_atomic_durable`: was 5 copies (themes, fonts, game_artwork, steam_store, playtime) with
  different temp-name schemes (two shared a fixed `.tmp` name, so concurrent writers could clash). Now one unique-temp,
  clean-up-on-failure implementation; durable (fsync) for config/playtime, plain for re-fetchable caches.
- `util::http`: `builder()` (gzip, keep-alive, pooled idle connections), `SharedClient` (build-once client with remembered
  failure), `read_capped` (the "stream with a byte cap" loop that existed 5 times: modrinth, fonts, artwork x2, steam).
- `util::{hex, valid_id, now_secs, now_ms, epoch_secs, blocking, MutexExt::lock_recover}`: hex encoding (4 copies),
  id validation (3 copies), clocks (4 copies), poison-tolerant locking.

## Efficiency

- **HTTP clients**: artwork, custom-image download, fonts and Steam store built a new `reqwest::Client` (new pool, new TLS
  config) on every call. All are now process-wide `SharedClient`s, so connections and TLS sessions are reused. gzip enabled.
- **Blocking work off async workers** (`util::blocking` = `spawn_blocking`): Modrinth API cache reads/writes, artwork cache
  probe + base64 + write, custom artwork save, font cache read/base64/write, Steam cache read/write, `analyze_mod_files`
  directory listing. Cache writes after a network fetch no longer delay the response.
- **Process table** (`process.rs`): Linux `/proc/<pid>/stat` parsing no longer allocates a `Vec` per process;
  `group_alive` (polled every 3 s per running game) reads only `stat` instead of `stat` + `cmdline` for every process;
  `shared_snapshot(max_age)` lets several watchers/games share one scan.
- **dirsize**: `get_dir_size` results are cached for 30 s and invalidated at once when the folder's mtime changes
  (the Installed view re-measured every Tofu on each visit); truncated/failed measurements are never cached.
- **Import sources**: `detect_import_sources` already scans every source; its results are now handed once (15 s TTL) to the
  following `scan_import_games` for the chosen source, so the dialog no longer walks the same folders and runs the same
  launcher CLIs twice. A manual rescan always hits the disk (entries are consumed on use).
- **Modrinth cache pruning** listed and `stat`ed up to 400 files after every cache write; it now only stats when the folder is over its limit.
- **Downloads**: file writes go through a 256 KiB `BufWriter` instead of one syscall per ~16 KiB chunk.
- **Playtime startup**: `sessions.jsonl` is rewritten (and fsynced) at start only when its canonical content differs;
  `playtime.json` is only rewritten when crash recovery changed it or it does not exist.

## Startup

- The Linux `mochi://` registration (`deep_link().register_all()`, which writes desktop files and runs helper commands)
  moved from the setup path into the existing background integration thread, in front of `ensure_platform_integration`
  (which rewrites the entry it creates, so the order is preserved). A failure is now logged instead of aborting setup.
- Set `MOCHI_STARTUP_TRACE=1` to print per-step timestamps. Measured (empty profile): config 0.1 ms, playtime 0.2 ms,
  tray 29.7 ms (GTK appindicator, main-thread only), gamepad 29.8 ms cumulative.

## Locking / errors

- Playtime tracker, watcher environment cache, download registry and config lock all recover from poisoning
  (`lock_recover`) instead of failing every later call with "lock is poisoned".
- All commands keep `Result<_, String>` errors (the frontend contract); helpers map typed errors (`BodyError`) to the same messages as before.

## Not done / notes

- macOS-only paths (`ps` parsing, `group_alive` fallback) are unchanged in behaviour but were not built here (Linux only).
- Dead code: only platform-gated `allow(dead_code)` remain, each needed by the other OS.
