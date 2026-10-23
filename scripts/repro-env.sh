#!/usr/bin/env bash
# Exports the settings that make release builds reproducible (see docs/reproducible-builds.md).
# Usage in CI: scripts/repro-env.sh >> "$GITHUB_ENV"   (run after checkout and after the Rust toolchain is installed)
# Usage locally: eval "$(scripts/repro-env.sh --shell)"
# Prints KEY=VALUE lines; values never contain newlines. Existing RUSTFLAGS are kept and extended.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
epoch="${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct)}"
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
sysroot="$(rustc --print sysroot)"
rustup_home="$(dirname "$(dirname "$sysroot")")"

flags="${RUSTFLAGS:-}"
for map in "$root=/build/mochi" "$cargo_home=/build/cargo" "$rustup_home=/build/rustup"; do
  flags="$flags --remap-path-prefix=$map"
done

if [[ "${1:-}" == "--shell" ]]; then
  echo "export SOURCE_DATE_EPOCH='$epoch'"
  echo "export RUSTFLAGS='${flags# }'"
else
  echo "SOURCE_DATE_EPOCH=$epoch"
  echo "RUSTFLAGS=${flags# }"
fi
