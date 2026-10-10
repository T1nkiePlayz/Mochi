# Backlog, wishlist and "What should I play?"

Everything here is local and works offline.

## Backlog (owned games)
`Piko.backlog?: { status: "want" | "playing" | "finished" | "dropped"; note?: string; addedAt: number }` (`src/lib/backlog.ts`).
Set it from the game page (Backlog chips + note), the card context menu (Backlog...), or the editor (General tab).
The **Backlog** smart filter in the library lists games that are `want` or `playing`; finished and dropped games leave it.

**Cloud sync:** `src/lib/cloud.ts` pushes and pulls explicit columns, so `backlog` is not synced (local-only). `mergeCloudLibrary`
keeps the local value (`...mine, ...remote`), so a sync never erases it. No SQL changes were made.

## Wishlist (games you do not own)
`src/lib/wishlist.ts`, stored in localStorage key `mochi:wishlist` (max 500 items). Open it with the **Wishlist** chip in the library filter bar;
add games by name with an optional note. Items: `{ id, name, source?: "igdb"|"steam"|"manual", externalId?, coverUrl?, note?, addedAt, priceWatch? }`
(`priceWatch` is reserved for a later feature).

Programmatic API for other features (e.g. game search): `addToWishlist(item)` (de-duplicates by source + externalId, else by name; returns the stored
item, or `null` for an empty name / full list), `removeFromWishlist(id)`, `updateWishlistItem(id, changes)`, `isWishlisted(items, probe)` and the
`useWishlist()` hook (`useSyncExternalStore`, also reacts to other windows via the `storage` event). `coverUrl` must be http(s) and is loaded lazily.

## What should I play?
Button in the library toolbar (`PickerDialog`, logic in `src/lib/picker.ts`). Inputs: mood (relaxed / focused / social / competitive),
time (15 min / 1 hour / an evening) and length (any / short). Candidates: installed non-launcher games that are not finished/dropped and are either
"want"/"playing" or played less than 5 hours. Weighted random: want x4, playing / unplayed x2.5, otherwise x1; then genre/tag heuristics
(IGDB genre names and tags) multiply the weight for the mood (x3), quick time favours arcade-like genres and avoids long ones, an evening favours long ones,
and "short" favours short genres. "Pick again" skips games already shown until all were shown. `seededRandom` makes it deterministic in tests.

**Time to beat:** when IGDB is connected, the picker asks the edge function (`igdb-time-to-beat`, IGDB `game_time_to_beats`) for the main-story hours of
games that have an IGDB id. 8 hours or less counts as short, 25 or more as long, and 4 or less as quick. The hours are fetched when the dialog opens and are
not stored. Games without data (or without IGDB) fall back to the genre heuristic.

## macOS
Frontend only (localStorage, no paths or platform APIs); nothing platform-specific.
