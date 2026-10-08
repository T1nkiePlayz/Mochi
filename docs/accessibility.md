# Accessibility

Mochi's accessibility settings live in **Settings > Accessibility** (and a short version in first-run setup). They are stored per device under `mochi:accessibility`, are not synced, and are applied before the first paint (`bootAccessibility()` in `src/main.tsx`).

## Options

| Group | Option | How it is applied |
|---|---|---|
| Vision | Text and interface size 85-150% | `--mochi-ui-scale` on `<html>`, applied with CSS `zoom` (the UI is px-based); viewport-height rules are divided by the scale |
| | High contrast (System / On / Off) | `data-high-contrast`; follows `prefers-contrast: more` |
| | Colour-blind palettes | `data-color-blind`; remaps success/warning/danger, adds icons to status text |
| | Reduce transparency, simple backgrounds, large pointer | `data-reduce-transparency`, `data-simple-background`, `data-large-cursor` |
| Motion | Reduce motion (System / On / Off) | `data-reduce-motion="true"`; follows `prefers-reduced-motion` |
| Keyboard and focus | Ring thickness, colour, offset, always visible, double ring | `--mochi-a11y-focus-*`, `data-focus-*` |
| | Keep controls visible | `data-keep-controls` (no hover-only controls) |
| Reading | Readable font (Atkinson Hyperlegible, bundled, OFL), line/letter/word spacing, underline links | `data-dyslexia-font`, `data-line-spacing`, `data-letter-spacing`, `data-word-spacing`, `data-underline-links` |
| Interaction | Larger click targets (44px), text labels on icon buttons | `data-large-targets`, `data-text-labels` |
| Screen reader | Announcements | `announce(message)` from `src/state/accessibility.ts` |

Everything is plain `<html>` data attributes, so feature code and themes can react to them:

```css
html[data-reduce-motion="true"] .my-animation { animation: none; }
```

Any new animation, parallax or transition must either use `var(--mochi-transition)` or be covered by `html[data-reduce-motion="true"]`; the global rule in `src/styles/features/accessibility.css` already zeroes every animation and transition duration. Anything revealed only on hover must also appear on `:focus-within` and under `html[data-keep-controls="true"]`.

## Global behaviour

`src/lib/dialogs.ts` (mounted once in `App.tsx`) enhances the DOM without each component opting in:

- Every `.modal` (and the discover/picker windows) gets `role="dialog"`, `aria-modal`, a name from its heading, initial focus, a Tab focus trap, Escape to close (it clicks the dialog's close button or the backdrop) and focus restoration to the opener.
- Icon-only buttons without a name take it from their `title`; `role="button"` elements get `tabindex` and Enter/Space.
- A "Skip to content" link jumps to `#main-content`.
- `?` opens the keyboard shortcuts dialog (`src/components/ShortcutsHelp.tsx`, `openShortcuts()`), showing ⌘ on macOS and Ctrl elsewhere.

For a polite status message use `announce("Saved")`; use `announce(text, "assertive")` for errors.

## Authoring rules

1. Interactive elements are real `<button>`/`<a>`/inputs with an accessible name (visible text, `aria-label` or `aria-labelledby`).
2. Never remove `outline` without drawing another focus indicator; the theme validator enforces it for `theme.css`.
3. Do not convey state by colour alone: pair it with an icon or word.
4. Dialogs: use `.modal-backdrop` > `.modal` with a heading and a close button; the enhancer does the rest.

## Theme contrast validation

See "Accessibility checks" in `docs/theme-architecture.md`. The check lives in `scripts/lib/contrast.mjs` and runs from `scripts/check-themes.mjs` during `npm run build`. Errors fail the build; input borders below 3:1 are warnings.
