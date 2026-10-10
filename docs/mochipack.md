# Modpack export and import (`.mochipack`)

Share a Tofu's mod list as a small file or a copyable code. A pack holds **ids and hashes only**, never mod files, so it is a few KB and carries no copyrighted content.

- **Export**: Manage Tofus > Share > *Export file* (saves `<name>.mochipack`) or *Copy code* (puts `mochipack:...` on the clipboard).
- **Import**: Manage Tofus > Share > *Import modpack...* then choose a file or paste a code. A preview sheet shows the game, loader, version and every mod with its availability. You pick the target: a **new Tofu** (on the current game folder) or the **current Tofu** (a snapshot is saved first, see `snapshots.md`).
- *Identify unknown files first* (on by default when online) runs the normal hash scan (`scanService.ts`: Modrinth by SHA-1, CurseForge by fingerprint, Nexus by MD5) before exporting, so unrecorded files get matched.

## Format (version 1)

```json
{
  "format": "mochipack", "version": 1, "name": "Fabric Fun",
  "game": { "name": "Minecraft", "pikoId": "minecraft", "minecraft": true, "cfGameId": 432, "nexusDomain": "skyrim" },
  "loader": "fabric", "gameVersion": "1.21.1",
  "mods": [
    { "provider": "modrinth", "projectId": "AANobbMI", "fileId": "u1Rzq6Id", "fileName": "sodium-0.6.0.jar", "sha1": "<40 hex>", "folder": "mods", "enabled": true }
  ],
  "unknown": [ { "fileName": "mystery.jar", "sha1": "<40 hex>" } ],
  "settings": { }
}
```

| Field | Rules |
| --- | --- |
| `format`, `version` | exactly `"mochipack"` and `1`; a higher version asks the user to update Mochi |
| `name` | optional, 1-60 chars (suggested Tofu name) |
| `game` | `name` 1-120 chars; optional `pikoId`, `minecraft` (bool), `cfGameId` (positive int), `nexusDomain` (`[a-z0-9_-]{1,64}`) |
| `loader` / `gameVersion` | optional; `[a-z0-9_-]{1,24}` / `[A-Za-z0-9._+ -]{1,40}` |
| `mods[].provider` | `modrinth`, `curseforge` or `nexus` only |
| `mods[].projectId`, `fileId` | Modrinth: `[A-Za-z0-9]{1,16}`; CurseForge and Nexus: decimal number |
| `mods[].fileName` | 1-255 chars, no `/`, `\`, control characters, `.` or `..`; informational |
| `mods[].sha1` | optional 40 hex. **CurseForge entries have no hash** (ids only) |
| `mods[].folder` | `mods`, `resourcepacks` or `shaderpacks` (default `mods`) |
| `mods[].enabled` | bool (default `true`) |
| `unknown[]` | files no provider matched: `fileName` + `sha1` (required). Informational, never installed |
| `settings` | optional flat map of text, numbers or booleans (max 32 keys). Reserved, ignored on import |

Limits: 2 MB per file or decoded code, at most 2000 `mods` and 2000 `unknown`. Unknown keys are dropped; everything is rebuilt field by field from validated values. Export output is sorted, so two exports of the same Tofu are identical.

### Short code

`mochipack:<base64url(deflate-raw(minified json))>`. Offered only when the compressed pack is under 4096 bytes and the web view has `CompressionStream("deflate-raw")` (WebKit 16.4+/WebKitGTK 2.40+, Chromium). Otherwise *Copy code* is disabled or reports that the pack is too big, and files always work. Decoding caps the decompressed size at 2 MB (no decompression bombs) and validates the result like a file.

## How import resolves downloads

The pack is **never trusted to choose a download host**. Each mod is looked up through the provider's own source object (`modrinthSource`, `curseforgeSource`, `nexusSource`) from the ids, then handed to the normal downloader (`startModDownload`), which re-checks the host against the provider allow-list and verifies SHA-1.

| Result | Meaning |
| --- | --- |
| Ready | the provider returned a direct URL. Downloaded with the pack's SHA-1 (or the provider's when the pack has none) as the required checksum |
| Manual download | CurseForge `allowModDistribution: false` or no `downloadUrl`; Nexus without an API key or without Premium; a provider turned off in Settings. A page link built by Mochi from the ids is shown |
| Changed | the provider's file has a different SHA-1 than the pack's: skipped and reported, never installed |
| Unavailable | the file is gone, the lookup failed, or the CurseForge project belongs to another game |
| Already installed | the target Tofu has a record for the same provider, project and file; not downloaded again |

Mods switched off in the pack are skipped unless *Also install mods that were switched off* is ticked (they are then installed switched on). Files in `unknown` are listed in the report but cannot be installed. After starting, the sheet shows a report (queued, failed to start, changed, manual, unavailable); download progress and checksum failures appear in Downloads. CurseForge data is only held in memory for the preview (no persistent caching).

A pack for Minecraft only opens in Minecraft: Java; other games must agree on the linked CurseForge game id or Nexus domain. A different loader or game version is a warning, not a block.

## Files

`src/lib/mods/mochipack.ts` (format, validation, short code), `mochipackPlan.ts` (availability, planning), `mochipackService.ts` (Tofu and provider glue), `src/components/mods/TofuShareSection.tsx`, `ImportModpackModal.tsx`, `src-tauri/src/mochipack.rs` (read and write the file: absolute path, `.mochipack` extension on write, 2 MB cap), `src-tauri/capabilities/mochipack.json` (save dialog).

## macOS

The open and save dialogs are the Tauri dialog plugin, native on macOS and Linux. Paths are handled by `Path`/`PathBuf`; the `.mochipack` extension is compared case-insensitively. Rust tests run on the macOS CI jobs.
