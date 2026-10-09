# Interface sound packs

Mochi plays short interface sounds in Big Picture (on by default) and, optionally, in the launcher window
(Settings > Sound). A sound pack replaces some or all of them.

## Built-in packs

`mochi` (default), `chiptune` and `glass` are synthesised at startup from a few lines of note data in
`src/lib/sound/synth.ts`: no audio files ship with Mochi and every sound is original. Themes pick one with
`"soundPack"` in `theme.json` (see `docs/theme-architecture.md`); the user's "Match theme" setting follows it.

## Pack format

A `.zip`, or a folder, with `manifest.json` at its root (or inside one top-level folder of the zip):

```json
{
  "schemaVersion": 1,
  "id": "soft-clicks",
  "name": "Soft clicks",
  "version": "1.0.0",
  "author": "You",
  "description": "Optional.",
  "volume": 0.8,
  "sounds": {
    "navigate": "move.wav",
    "select": "sfx/select.mp3",
    "back": "back.ogg"
  }
}
```

| Event | When |
| --- | --- |
| `navigate` | Focus moves (controller, arrow keys in Big Picture) |
| `tab` | Switching shelf or tab |
| `select` | A button or link is activated |
| `back` | Going back |
| `open` / `close` | A menu or dialog opens or closes |
| `launch` | A game starts |
| `error` | Something failed |
| `notification` | A new notification |
| `toggleOn` / `toggleOff` | A switch or checkbox changes |
| `achievement` | An achievement unlocks |
| `download` | A download finishes |

Events a pack leaves out use Mochi's own sound. `volume` (0 to 1) scales the whole pack.

## Rules (checked on import and on every read)

- `id`: letters, numbers, `-`, `_`, up to 64; the built-in ids (`mochi`, `chiptune`, `glass`, `theme`, ...) are reserved.
  Importing a pack with an id that is already installed replaces it.
- Paths are relative, without `..`, hidden segments or backslashes, at most three levels deep.
- Files must be `.wav`, `.ogg`/`.oga` or `.mp3` and start with a real WAV, Ogg or MP3 signature.
- At most 2 MiB per file, 16 MiB per pack, 64 KiB manifest, 512 entries in a zip. Symlinks are refused.
- Only the manifest and the files it names are copied; everything else in the folder or zip is ignored, and zip
  entries are looked up by exact name, so traversal names inside an archive are never used as paths.

WAV and MP3 decode everywhere. Ogg Vorbis decodes in WebKitGTK but may not on older macOS; Mochi then falls back
to its own sound for that event.

## Storage

Installed packs live in `<Mochi config>/sound-packs/<id>/` (Linux `~/.config/Mochi`, macOS
`~/Library/Application Support/Mochi`, or the moved data folder). Settings > Sound packs imports, exports (as a zip
that imports back) and removes them. Code: `src-tauri/src/soundpacks.rs`.
