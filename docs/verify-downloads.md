# Verifying Mochi downloads

Every Mochi release file has up to three independent proofs. Use whichever you can; using two is best.

| Proof | Shows | Needs |
| --- | --- | --- |
| `SHA256SUMS.txt` | The file was not corrupted in transit | nothing |
| GPG signature (`<file>.asc`) | The file was signed with the Mochi release key | `gpg` |
| GitHub build attestation | The file was built by the official release workflow from a specific commit | the `gh` CLI |

None of these replace platform code signing: macOS builds are still ad-hoc signed and not notarized (see the README).

Every release page also lists these commands with the exact file names filled in, so you can copy them.

## 1. Checksums

Put `SHA256SUMS.txt` next to the downloaded files:

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt        # Linux
shasum -a 256 -c --ignore-missing SHA256SUMS.txt    # macOS
```

## 2. GPG signature

Import the public key from this repository over HTTPS, then check its fingerprint against the one published here and in the README before trusting it:

```bash
curl -fsSL https://raw.githubusercontent.com/T1nkiePlayz/Mochi/main/docs/release-signing-key.asc | gpg --import
gpg --fingerprint "Mochi Releases"
```

**Release key fingerprint:**

```
C735 859C E725 06BA 7BCD  C4F2 0F89 D3A3 E4B4 680F
```

The release workflow refuses to sign with any key other than `docs/release-signing-key.asc`.

Verify a file and the checksum list (the `.asc` files are attached to the same release):

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
gpg --verify <file>.asc <file>     # <file> is the name of the file you downloaded
```

You want `Good signature from "Mochi Releases"` and the primary key fingerprint above. A "not certified with a trusted signature" warning is normal unless you have signed the key yourself.

## 3. Build attestation

```bash
gh attestation verify <file> --repo T1nkiePlayz/Mochi
```

This checks a signature from GitHub that ties the file to this repository's `release.yml` workflow and the tagged commit.

---

## For maintainers: one-time GPG key setup

Do this on your own machine; the private key never goes in the repository.

1. Create a signing-only key with a strong passphrase (expires in 2 years; renew by extending expiry, which keeps the fingerprint):

   ```bash
   gpg --quick-generate-key "Mochi Releases <support@ashtontink.com>" ed25519 sign 2y
   gpg --list-secret-keys --keyid-format long "Mochi Releases"      # note the fingerprint
   ```

2. Publish the public key in the repository, and put the fingerprint in this file and the README:

   ```bash
   gpg --armor --export "Mochi Releases" > docs/release-signing-key.asc
   ```

3. Add two repository secrets (Settings > Secrets and variables > Actions > New repository secret):

   | Secret | Value |
   | --- | --- |
   | `GPG_PRIVATE_KEY` | Output of `gpg --armor --export-secret-keys "Mochi Releases"` (the whole block including the `BEGIN`/`END` lines) |
   | `GPG_PASSPHRASE` | The passphrase you chose |

4. Back the key up offline (`gpg --armor --export-secret-keys` into a password manager or an encrypted drive plus a revocation certificate: `gpg --gen-revoke "Mochi Releases" > revoke.asc`), then delete any plain-text exports.

If the key is ever exposed, revoke it, generate a new one, replace `docs/release-signing-key.asc` and both secrets, and announce the new fingerprint.

How the workflow behaves:
- It imports the key into a temporary keyring, refuses to sign unless its fingerprint equals `docs/release-signing-key.asc`, signs `SHA256SUMS.txt` and every release file, then verifies every signature with the public key from the repository before uploading.
- Without `GPG_PRIVATE_KEY` the release still publishes (attestations only) and prints a warning.
- Build attestations need no secrets: the `publish` job has `id-token: write` and `attestations: write`, and `actions/attest-build-provenance` is pinned to a commit.
