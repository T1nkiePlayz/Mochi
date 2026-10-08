# Updates

Mochi updates itself from GitHub releases. Nothing is downloaded without the user pressing
**Install & restart**; background checks only look for a newer version.

## How a user sees it

- 10 seconds after start, then every 6 hours, Mochi checks for a new release (only if
  **Settings > Updates > Auto-update** is on and the machine is online). Startup is never blocked.
- When one is found: an in-app notification and a dismissible banner. **Settings > Updates** has
  the version, last-checked time, the Auto-update toggle, **Check now** (always allowed), release
  notes and **Install & restart** with a progress bar.
- **AppImage and macOS `.app`** installs update in place (signed download, then relaunch).
- **deb / rpm / AUR / dev builds**, or if the signed update fails for any reason, Mochi falls back to
  the GitHub releases API and shows "Open release page" instead. Offline or error states are shown
  as text, never thrown.

## How a release produces an update

1. Push a tag `vX.Y.Z` on the current `main` commit (see `.github/workflows/release.yml`).
2. `tauri-action` builds Linux (AppImage/deb/rpm) and macOS (Apple silicon + Intel DMG), because
   `bundle.createUpdaterArtifacts` is on (only the release workflow turns it on, via a `--config` override, so local `tauri build` works without the signing key) it also produces `*.AppImage.tar.gz`/`*.app.tar.gz` plus `.sig`
   files, and `includeUpdaterJson: true` uploads/merges `latest.json` into the release.
3. Installed apps read `https://github.com/T1nkiePlayz/Mochi/releases/latest/download/latest.json`
   (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`) and verify each download against
   `plugins.updater.pubkey`.

## Secrets

Repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file (not the `.pub`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty/unset when the key has no password |

Apple secrets are described in the README. The private key must never be committed; only the public
key lives in `tauri.conf.json`.

## Generating a new key

```sh
npx tauri signer generate -w ~/mochi-updater.key      # add a password when prompted if you want one
```

Put the public key (`mochi-updater.key.pub`, one line) into `plugins.updater.pubkey`, store the private
key in `TAURI_SIGNING_PRIVATE_KEY`. **Installed copies only trust the key they shipped with**, so
rotating the key means users on old versions can no longer auto-update and must install manually once.

## Development

In `npm run dev` (browser, no Tauri) `src/devMock.ts` makes the updater report a fake `9.9.9`
update and simulate the download, so the UI can be styled and tested. Pure helpers (`compareVersions`,
`parseGithubRelease`) in `src/lib/updater.ts` have no side effects.
