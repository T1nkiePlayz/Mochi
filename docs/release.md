# Releasing Mochi

Push a tag `vX.Y.Z` (or `vX.Y.Z-beta.1` for a pre-release) on the commit you want to ship, normally the tip of `main`:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The workflow `.github/workflows/release.yml`:

1. **prepare** syncs the version from the tag into `package.json`, `tauri.conf.json` and `Cargo.toml` (`scripts/sync-version.mjs`), commits that to `main` when the tag is the tip of `main` (a failed push only warns), and creates a **draft** GitHub Release. If the Apple secrets are missing the notes get the right-click-Open / `xattr -dr com.apple.quarantine` instructions.
2. **linux** builds AppImage, deb and rpm and uploads them with the updater manifest `latest.json`.
3. **macos** (after linux, so `latest.json` is never written concurrently) builds one universal DMG (`--target universal-apple-darwin`, arm64 and Intel) and adds its updater entries. It then verifies the `.app`: bundle id, version, game category, the `mochi` URL scheme, `LSMinimumSystemVersion`, both architectures, `codesign --verify`, and when signed/notarized the Developer ID authority, `stapler` and `spctl`.
4. **publish** writes `SHA256SUMS.txt`, GPG-signs it and every file (`.asc`), creates GitHub build attestations, uploads them and turns the draft into a release (pre-releases are not marked "latest"; the updater reads `releases/latest`).

To rebuild a tag: Actions > Release Mochi > Run workflow > enter the tag. Existing assets of the same name are replaced by tauri-action.

## Secrets (repository Settings > Secrets and variables > Actions > New repository secret)

| Secret | Required | What |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | for in-app updates | Updater key. Create with `npm run tauri signer generate -- -w ~/.tauri/mochi.key`; the public half is already in `tauri.conf.json` (`plugins.updater.pubkey`). Without the secret the build still succeeds but has no updater artifacts. |
| `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` | for GPG signatures | Armored private key and its passphrase. Setup: [verify-downloads.md](verify-downloads.md#for-maintainers-one-time-gpg-key-setup). The public key must be committed as `docs/release-signing-key.asc` and match, or the publish job fails. Without the secret, files are published with attestations only. |
| `APPLE_CERTIFICATE` | for signing | A "Developer ID Application" certificate exported as `.p12`, base64 encoded: `base64 -i cert.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD` | for signing | The password chosen when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | for signing | Like `Developer ID Application: Your Name (TEAMID)`; shown by `security find-identity -v -p codesigning`. |
| `APPLE_ID` | for notarization | The Apple ID e-mail of the developer account. |
| `APPLE_PASSWORD` | for notarization | An **app-specific password** from appleid.apple.com > Sign-In and Security > App-Specific Passwords (not the account password). |
| `APPLE_TEAM_ID` | for notarization | The 10-character Team ID at developer.apple.com/account > Membership details. |

Getting the certificate: join the Apple Developer Program (99 USD/year), then Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application (or developer.apple.com > Certificates), open Keychain Access > My Certificates, right-click the certificate > Export as `.p12`.

Behaviour: all three signing secrets present = signed with your identity; plus the three notarization secrets = notarized and stapled. Anything missing = ad-hoc signed (`-`) unnotarized DMG, and the release notes explain how to open it. `GITHUB_TOKEN` is provided automatically; jobs ask only for `contents: write` where they upload.

## Checklist

* CI green on the tagged commit.
* Supabase redirect URLs include `mochi://auth/callback` and `mochi://auth/verify`.
* After publishing: open the DMG on a Mac, run the Gatekeeper steps if unsigned, test a `mochi://` link and Check for updates.
