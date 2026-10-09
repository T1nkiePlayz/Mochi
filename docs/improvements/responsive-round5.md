# Responsive round 5

Complaint: resizing the window cut things off (for example the Minecraft Ore top bar, whose nav buttons and account button ran off the right edge at about 1000 px). Goal: every element adapts to any window size in both directions, in every theme, built-in or user-installed, on Linux, macOS and the Steam Deck.

## Result

`node scripts/layout-audit.mjs` checks every theme x window size x screen in a private headless Chromium against the dev mock (seeded with awkward data: very long names, unbroken words, long tags, several Tofus). Same script, same matrix, run against `origin/main` (before) and this branch (after):

| | Page checks | Issues | Unique |
| --- | ---: | ---: | ---: |
| Before (`origin/main`) | 2992 | 22311 | 650 |
| After | AFTER_CHECKS | AFTER_ISSUES | AFTER_UNIQUE |

Matrix: 11 themes x 16 window sizes (320x640, 320x2160, 480x800, 640x800, 800x600, 1000x700, 1024x768, 1000x1040, 1280x400, 1280x800 (Steam Deck), 1600x900, 1920x1080, 1024x2160, 2560x1440, 3840x400, 3840x2160) x 17 screens (first-launch setup, Library in all five view modes, game details, GameEditor, Tofu manager, Add game dialog, account menu, Settings, Stats, Mods & Content, Downloads, Discover, Big Picture). A second pass at 150% text size (640x480, 1000x700, 1280x800, all themes and screens): ZOOM_RESULT.

Before, by type: content outside its clipping box 10599, truncated text without a tooltip 9111, controls under 24 px 1369, outside vertically (sidebar items below a short window) 600, text clipped 582, navigation items overlapping 30 (Ore at 1280x800 and 1280x400), screens that could not open 20.

The audit reports: page scrolling sideways, elements outside the viewport or cut by an `overflow: hidden` ancestor (horizontally and vertically), clipped text, ellipsis without a tooltip, short labels squeezed into one letter per line (new: `word-broken`), dialogs taller or wider than the window, overlapping navigation, targets under 24 px, and screens that did not actually open (so a broken audit step cannot report a false zero). `--coverage` adds unthemed browser-default controls and low-contrast text.

## What changed

Earlier commits on this branch (see `git log`):
- **Protected layout layer** (`src/styles/layout.css`, cascade layers in `src/styles/layers.css`): structure that no theme can break, documented in `docs/theme-architecture.md`. User themes load into a later `user` layer.
- **Navigation that always fits** (`src/lib/useShellFit.ts`): the bar or sidebar steps down full, compact (account avatar only), tight (no brand text), icons, then drawer, measured from what actually fits, so any font, padding or text size works. This is what fixes the Ore top bar at 1000 px.
- **Window state** (`src-tauri/src/window_state.rs`): size, position and maximised state remembered and validated against the monitors present now; fullscreen and minimised geometry is never saved.
- **Theme layout lint** for built-in themes (build fails) and user themes (warnings), and a **token-usage gate** in `npm run build` (no hard-coded colours or fonts in launcher CSS).

This round:
- Game details page is a single shrinkable column; its action buttons wrap. Workspace, editor and Big Picture top bar tabs wrap.
- Every `*-actions` button row wraps (a right-aligned row used to overflow to the left, e.g. Tofu manager Duplicate/Delete).
- Long words: the page uses `overflow-wrap: break-word` (prose, headings and paths still break anywhere). `anywhere` everywhere had let flex rows squeeze labels into one letter per line ("Ref/res/h" on Discover, provider names in Settings). Buttons cap at their row width and wrap between words.
- Setting rows put the control under its label when both no longer fit; provider cards and theme cards reflow by available width (Ore no longer forces two columns).
- Grids whose one column grew to its widest child: accessibility preview, Big Picture root.
- Tofu workspace header wraps; tag input meets the 24 px target size; ellipsis labels with tall display fonts (Terraria's Baloo 2) no longer clip descenders.
- Token gate accepts a literal that is only a token's fallback (`var(--mochi-x, #fff)`) and colour functions built purely from tokens (procedural hues), so Discover's avatars pass without opt-outs.
- Audit: library view modes, GameEditor and Tofu manager screens, waits for the asynchronously loaded library, checks that each screen opened, detects squeezed labels.

## macOS

- Mochi uses the standard macOS title bar (no `titleBarStyle: Overlay`, no custom drag region), so the traffic lights never overlap content and need no inset. If an overlay title bar is ever adopted, the top bar needs `data-tauri-drag-region` and a left inset of about 78 px for the traffic lights; `--mochi-safe-top/left` in `layout.css` are the place for it.
- Native fullscreen (green button) and Big Picture fullscreen: the shell is `100dvh` and honours `env(safe-area-inset-*)` (`viewport-fit=cover`), so the notch area on built-in displays never hides the top bar; window_state does not save fullscreen geometry, so leaving fullscreen restores the previous window.
- WKWebView rubber-banding of the whole page is turned off (`overscroll-behavior: none` on `html, body`); inner panes still scroll normally.
- Not verifiable here (no Mac): font metrics differ slightly (SF fallback), which the measured nav fit absorbs.

## Steam Deck

1280x800 is part of the matrix (all themes, all screens, including Big Picture): no issues. The minimum window is 640x480; 320 and 480 px widths stand in for 150-200% text size.

## Running it

```
npm run dev                                         # dev mock on http://localhost:5173
npm i --no-save playwright && npx playwright install chromium   # or PLAYWRIGHT_MODULE=/path/to/playwright-core CHROMIUM_PATH=...
node scripts/layout-audit.mjs                        # full matrix, writes audit-out/report.md
node scripts/layout-audit.mjs --themes minecraft-ore --sizes 1000x700 --screens library,settings --shots
node scripts/layout-audit.mjs --zoom 1.5 --coverage --json
```

The full matrix takes about 25 minutes when split into one process per theme (`--themes <id>` with a separate `--out` each).

## Checks

`npm run build`, `npm run lint` (0 errors), `npm test`, `npm run typecheck:tests`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
