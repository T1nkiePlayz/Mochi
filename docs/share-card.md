# Share card (experimental)

Enable **Settings > Experimental > Share card**, then open **Stats > Overview > Share card**.

It builds a 1080x1080 PNG of your stats that you can save or copy. Everything happens on this device: the card is
generated as an SVG (`src/lib/shareCard.ts`), drawn to a canvas and encoded as PNG. There is no network access.

## What you control

Tick what appears on the card; anything unticked is not drawn at all.

- Top games (up to five, with covers)
- Total playtime
- Achievements count (unlocked / total)
- Account name (off by default)
- Period: all time (including playtime from before Mochi kept history) or the last 30 days

## How it works

- Colours and fonts come from the current theme's computed `--mochi-*` CSS variables. Values are validated before
  they enter the SVG.
- Covers are read only from the local artwork cache (asset protocol or data URLs), inlined as data URLs, size-capped
  and type-checked. A game without a cached cover gets its initials, so the canvas is never tainted.
- Names are XML-escaped. The preview is an `<img>` so no script can run.
- **Save PNG** opens a save dialog and calls the `write_share_card` command (`src-tauri/src/sharecard.rs`), which
  requires an absolute path, a real PNG signature and at most 16 MB, and forces a `.png` extension.
- **Copy image** uses `navigator.clipboard.write` with a `ClipboardItem`. Some WebKitGTK builds lack image clipboard
  support; the dialog then says so and Save PNG remains available.

## Limits

- Card fonts are the theme's font stacks as available to the system, since webfonts are not loaded inside an
  SVG image; unavailable fonts fall back to the system sans-serif.
- Fixed square layout, one card style.
