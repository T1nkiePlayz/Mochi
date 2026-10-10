# Command palette

`Ctrl+K` (`⌘K` on macOS) opens a palette that searches your games and runs actions. It replaces the old "focus the library search box" behaviour; the Topbar search box still filters the library.

## Using it
- No prefix: games plus actions. With an empty box it shows your recent actions (last 8, `mochi:palette-recents` in localStorage), then the top actions.
- `>` prefix: actions only (`>theme`, `>settings sound`).
- `install <name>` / `mod <name>`: first result opens Discover with the search box prefilled (Discover > All).
- Results are capped at 50. Typing a game plus Tofu name finds Tofus; Enter opens the Tofu manager.
- Keyboard: type, `Enter` runs the first result, `ArrowDown/ArrowUp` move focus through the rows, `Esc` closes. Rows are real buttons, so controller D-pad (spatial nav), A (confirm) and B (back, via the dialog enhancer) work with the existing mapping. The palette is not offered inside Big Picture or during first-launch setup.

## Built-in actions
Go to Library/Discover/Mods & Content/Downloads/Stats/Settings, `Settings: <section>` (scrolls to it), `Theme: <name>` per theme, Add game, Import games, Install mod, Open Tofu manager, Create snapshot of the current Tofu, Check mods for updates, Toggle Big Picture, Show keyboard shortcuts, Open documentation, Report a problem. Snapshot/check/Tofu actions are hidden when no Tofu with a folder is selected.

## Adding commands (`src/lib/commands.ts`)
```ts
const off = register("saves.backup", "Back up saves now", ["save", "backup"], "Library",
  ({ app }) => { /* app() is the latest AppController */ },
  ({ app }) => app().lib.library.length > 0 /* optional `when` */);
// call off() to remove it (e.g. from a useEffect cleanup)
```
Use a stable namespaced id (recents are stored by id). A save-backup command is not registered yet because `src/lib/saveBackups*` is not on main; the feature can register one with the call above.

## How it works
- `src/lib/fuzzy.ts`: token scorer (substring beats subsequence, word starts and runs score higher, accents and case ignored). `src/lib/search.ts` only offers boolean matching, so it is not reused.
- `src/lib/palette.ts`: query parsing, recents, ranking. Folded strings are cached per game/command, ranking 2,000 games + 100 actions takes about 1 ms (benchmark in `palette.test.ts` asserts < 5 ms warm). The list is capped at 50 rows, so no virtualisation is needed.
- `src/lib/discoverQuery.ts`: prefill channel for Discover.
- `src/components/CommandPalette.tsx` + `src/styles/features/command-palette.css`: UI, themed with `--mochi-*` tokens.

## macOS
No platform-specific code. The shortcut label comes from `get_platform_capabilities` (`⌘K`); the key handler accepts `metaKey` or `ctrlKey`. Not verified on real macOS: that `⌘K` is not swallowed by a system shortcut inside the webview.
