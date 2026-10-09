# Achievements tab: 4 s to open

Symptom (real app, Linux, WebKitGTK, 58 games): switching Stats from Overview to Achievements took about 4 s.

## Root cause

`filter: grayscale(.7)` on `.ach-badge.locked .ach-icon` (stats.css). WebKitGTK without GPU compositing paints every
filtered node through its own offscreen surface. With ~45 locked badges that was 0.6-1.5 s per tab switch on a 2x-scaled
window, and it grows with window size and display scale. JavaScript was not the problem: the React render of the tab is about 50 ms.
The same pattern existed on locked Steam achievement rows (`.steam-ach-row.locked .steam-ach-icon`, a filter on an already grey icon).

Not the cause (measured): `color-mix(in oklab)` per badge (no difference when removed), `opacity: .82` on locked badges
(no difference), the lucide icon barrel, useSteamSync (no effects at mount), AchievementWatcher (not re-run by the tab),
lazy chunks (the panel ships in the StatsView chunk).

## Fix

- Locked icons are muted with colour tokens (`--ach-tint`, `--ach-fg` set on `.ach-badge.locked`) instead of a filter. Themes that
  override `.ach-icon` keep working; minecraft-ore reads `--ach-fg` for its icon colour.
- Removed the redundant filter on locked Steam rows (Steam already supplies a grey icon).
- `AchievementBadge` is `memo`, and the panel uses one timestamp per mount instead of `Date.now()` per render so props are stable.

## Numbers

Measured in real WebKitGTK 2.52 (system `webkit2gtk-4.1`, Gtk.OffscreenWindow, software rendering via
`WEBKIT_DISABLE_COMPOSITING_MODE=1`) against the Vite dev server with `src/devMock.ts`, 58 games, 64 visible badges.
Time from clicking the Achievements tab to the third animation frame (`docs/improvements/achievements-tab-wk-bench.py`):

| window | before | after |
| --- | --- | --- |
| 1280x800, scale 1, mochi | 280-345 ms | 83-99 ms |
| 2560x1440, scale 2, mochi | 675-1580 ms | 82-98 ms |
| 2560x1440, scale 2, minecraft-ore / pipboy / cyberpunk | not measured before | 83-113 ms |
| experiment: only the filter removed | | 82-128 ms (all of the gain) |

Headless Chromium with 6x CPU throttle: 290-980 ms before (theme dependent); about 155 ms after at 4x throttle.

## Not verified

The 4 s the user sees was not reproduced exactly: the real app has its own window size/scale, a GPU or compositing path and user
data I do not have. The filter is the only cost that scaled that way here and removing it removed nearly all the paint time, but the
final number on the user's machine needs confirming. Release builds, Tauri's own webview wrapper and macOS WKWebView were not tested.
`.stat-bar.peak { filter: brightness() }` (one node per chart) and theme filters on cover art (not on this tab) were left alone.

## Regression guard

`src/components/stats/AchievementsPanel.test.tsx` fails if a CSS filter is added to `.ach-*` / `.steam-ach-*` rules, checks badges stay
memoised, and has a render budget for the full catalogue.
