# Reproducible builds and SBOMs

## What is reproducible

- **The Rust binary** (`src-tauri/target/release/mochi`) and **the frontend bundle** (`dist/`): the same commit built twice, in different directories, gives byte-identical files. The `Reproducible build check` workflow (`.github/workflows/reproducible.yml`, weekly, on tags and by hand) builds both twice in fresh clones and fails if a SHA-256 differs.
- What makes that work: the toolchain is pinned (`rust-toolchain.toml`, Rust 1.99.1), builds use `--locked` with the committed `Cargo.lock` and `npm ci`, `SOURCE_DATE_EPOCH` is the commit time, and `scripts/repro-env.sh` adds `--remap-path-prefix` for the checkout, `~/.cargo` and the rustup directory so no build path ends up in the binary.

## What is not

- **AppImage, deb, rpm and DMG containers**: filesystem images, timestamps, compression and (on macOS) ad-hoc or Developer ID code signing and notarization are not deterministic. Compare the contained binary instead.
- The macOS universal binary and the Tauri updater signatures are not covered by the CI check (it runs on Linux x86_64 only).
- System libraries (WebKitGTK and friends) are the runner's apt packages; a different distro or package version may change the result.

## Rebuild and compare locally

```bash
git clone https://github.com/T1nkiePlayz/Mochi && cd Mochi
git checkout v<version>
rustup toolchain install 1.99.1              # rust-toolchain.toml picks it automatically
eval "$(scripts/repro-env.sh --shell)"       # SOURCE_DATE_EPOCH and RUSTFLAGS
npm ci && npm run build
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
sha256sum src-tauri/target/release/mochi
(cd dist && find . -type f | LC_ALL=C sort | xargs sha256sum) > dist.sha256
```

Do it twice (in different directories) and compare the hashes. To see where two binaries differ: `cmp -l a b | head`, or `strings -a` on both and `diff`. Release assets are built by the release workflow with the same settings, but they are packaged by Tauri, so extract the AppImage (`--appimage-extract`) to find the `mochi` binary.

## SBOMs

Every release has two CycloneDX 1.5 JSON files, listed in `SHA256SUMS.txt`, GPG-signed and attested (see [verify-downloads.md](verify-downloads.md)):

- `mochi-<version>-rust.cdx.json`: Rust crates (`cargo-cyclonedx`, from `src-tauri/Cargo.lock`).
- `mochi-<version>-npm.cdx.json`: production npm packages (`@cyclonedx/cyclonedx-npm --omit dev`, from `package-lock.json`).

To generate them locally: `cargo install --locked cargo-cyclonedx --version 0.5.9 && cargo cyclonedx --manifest-path src-tauri/Cargo.toml --format json --spec-version 1.5`, and `npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --package-lock-only --omit dev --spec-version 1.5 --output-format JSON package.json`.
