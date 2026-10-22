# Security Policy

## Supported versions

Mochi is in early development. Only the latest release receives security fixes; there are no backports to older versions.

| Version | Supported |
| ------- | --------- |
| 0.1.x (latest release) | :white_check_mark: |
| Older releases, unreleased branches and forks | :x: |

Mochi checks for updates in the background (Settings > Updates). Install the latest release from the [Releases page](https://github.com/T1nkiePlayz/Mochi/releases) before reporting, if you can.

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Report privately through either channel:

- **GitHub:** [Report a vulnerability](https://github.com/T1nkiePlayz/Mochi/security/advisories/new) (private security advisory).
- **Email:** **support@ashtontink.com** with `[Mochi security]` in the subject.

Please include:

- The Mochi version and platform (Linux distribution and package type, or macOS version and chip).
- What the issue is and what an attacker could do with it.
- Steps to reproduce, or a proof of concept.
- Relevant logs, with secrets and personal data removed (*Copy debug info* in Mochi removes them for you).

### What to expect

Mochi is maintained by one person, so these are good-faith targets, not guarantees:

- **Acknowledgement** within 5 days.
- **Initial assessment** (accepted, needs more information, or not a vulnerability) within 14 days.
- **Fix** in a new release as soon as practical, prioritised by severity. You will be kept informed of progress.
- **Disclosure:** once a fix is released, a GitHub security advisory is published. You will be credited unless you ask not to be. Please give us the chance to release a fix before disclosing publicly; 90 days is the default if no fix has been agreed.

## Scope

In scope:

- The Mochi desktop app: the React UI, the Tauri/Rust backend, its IPC commands and Content Security Policy.
- Mod downloads and extraction (URL allow-lists, size and hash checks, zip path traversal), `.mochipack`, `.mochibackup`, theme, sound pack and plugin imports.
- `mochi://` and `nxm://` deep-link handling and the `mochi` command line.
- The auto-updater and the verification of newer builds (`install-hashes.json`).
- Mochi's Supabase backend: database policies, edge functions (including the CurseForge proxy) and how credentials stored in Supabase Vault are handled.
- The release pipeline: GitHub Actions workflows, checksums, GPG signatures and build attestations.

Out of scope:

- **Unsigned builds.** Mochi releases are not code-signed or notarized; this is documented and not a vulnerability by itself. A way to tamper with a release that defeats the checksum, GPG or attestation checks *is* in scope.
- Vulnerabilities in games, mods or other launchers (Steam, Heroic, Lutris, ...) that Mochi starts or reads from. Report those to their authors.
- Vulnerabilities in third-party services (Supabase, IGDB, SteamGridDB, Modrinth, CurseForge, Nexus Mods) unless Mochi's use of them causes the problem.
- Attacks that need an attacker who already controls your user account or machine, or physical access to an unlocked device.
- Commands you configure yourself, such as launch hooks and launch options, behaving as configured.
- Experimental features doing what their documented permissions allow.
- Reports from automated scanners with no demonstrated impact.

## Verifying releases

Every release ships `SHA256SUMS.txt`, GPG signatures and GitHub build attestations. The release key fingerprint is:

```
C735 859C E725 06BA 7BCD  C4F2 0F89 D3A3 E4B4 680F
```

See [docs/verify-downloads.md](docs/verify-downloads.md) for how to check a download, and the [Security model](README.md#security-model) section of the README for how Mochi is designed.
