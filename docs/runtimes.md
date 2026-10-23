# Compatibility tools (Proton-GE and Wine-GE)

Linux only. Settings > Compatibility tools installs the community-built runtimes that most Windows games need, so you no longer have to fetch them outside Mochi.

## Using it

1. Open Settings > Compatibility tools. Each runtime has its own list: what is installed, and the latest releases from GitHub.
2. Press **Install** on a release. Mochi shows download, verification and unpacking progress.
3. Pick the runtime in a game's launch options (Runtime). It appears in the same list as Wine and Steam's Proton builds, so the Windows prefix manager can use it too.
4. **Remove** deletes an installed runtime after a confirmation. Game prefixes are not touched.

## Where things go

| Runtime | Source | Installed to |
|---|---|---|
| Proton-GE | `GloriousEggroll/proton-ge-custom` | `compatibilitytools.d` inside the first Steam folder Mochi finds (it is created if Steam exists) |
| Wine-GE | `GloriousEggroll/wine-ge-custom` | `<Mochi data folder>/runtimes/wine/<name>` (listed as "<name> (Mochi)") |

Proton-GE needs Steam to be installed (run it once). Steam may need a restart to show a new Proton-GE.

## How it stays safe

- Release lists and files are fetched by Mochi (not the web view) from `api.github.com`, `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com` only, over HTTPS. Redirects to any other host are refused. Downloads are capped at 2 GiB.
- The archive's SHA-512 must match the release's `.sha512sum` file before anything is unpacked; a mismatch deletes the download.
- Unpacking refuses absolute paths, `..`, device files, and links that point outside the install folder. The runtime is unpacked in a temporary folder beside its destination and moved into place with one rename, so a failed install leaves nothing half-installed. An existing folder of the same name is never overwritten.
- Remove only works on folders directly inside the two folders above.

## Limits

- Only the 15 most recent stable releases are listed. Releases need a `.tar.gz` or `.tar.xz` archive with a `.sha512sum` file.
- One install runs at a time.
- Other runtimes (system Wine, Valve's Proton, CrossOver) are still detected, not installed.
