# Duplicate games: merge into one Piko

Mochi notices when the same game was imported from several places (Steam, Heroic/GOG/Epic, Flatpak, a desktop entry) and offers to merge the copies into one Piko with a "Play via" choice. Nothing is deleted and no game files are touched.

## Detection (`src/lib/duplicates.ts`, pure)
- Same store id read from the launch target (`steam://rungameid/N`, Heroic `appName` + runner, `flatpak://id`), or the same normalised name.
- Normalised name: lower case, no accents, no trademark signs or punctuation, no leading "the", a trailing "(2016)" dropped, a trailing roman numeral II..XVI written as a digit. Editions and plain numbers stay, so "Portal" and "Portal 2" never match.
- Skipped: launchers, Minecraft, soundtracks/extras, games without a launch target.
- "Not the same" stores the pairs in localStorage `mochi:duplicate-dismissed`; they are never offered again.

## Merge model
- The primary (best metadata) keeps its id, tags, Tofus and cover. The others leave the library but stay whole in `mergedFrom` (hidden); every copy becomes a `launchSources` entry; `preferredSource` is the one "Play" uses (the first when unset).
- Unmerge (game page, "Sources": one source or all) restores the archived copies exactly and removes the merge fields. Restored games are not offered for merging again.
- Playtime: sessions keep being recorded per original id; `foldLegacyPlaytime` also aliases every id in `mergedFrom` to the primary, so totals are combined and come apart again on unmerge.
- Launch: `launchTargetFor` / `sourceInstallPathFor` follow the chosen source. A Tofu's own target still wins.
- Re-importing a source that was merged does not bring it back (import skips names found in `mergedFrom`).

## Limits
- Local to this device. The cloud schema has no columns for these fields; the cloud keeps only the primary's data, and a cloud copy of a merged-away game is not restored on pull. Other devices merge on their own.
- Tags, collections and favourite of the folded games are not copied onto the primary (they come back on unmerge). Their Tofus are not shown while merged.

## macOS
No platform-specific code: detection works on launch-target strings, `open`/app-bundle targets work as ordinary sources. Not tried on real macOS hardware.
