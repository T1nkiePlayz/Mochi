# Mochi Theme Architecture

Mochi themes are filesystem-backed UI packages. The theme engine is designed to make a theme a visual implementation of Mochi rather than an accent-colour preset.

## Storage model

The launcher uses the Tauri application configuration directory with the root overridden to a human-readable Mochi directory.

Linux:

    ~/.config/Mochi/

macOS:

    ~/Library/Application Support/Mochi/

The structure is:

    Mochi/
    ├── config.json
    └── themes/
        ├── example.json
        └── example/
            ├── theme.json
            ├── theme.css
            └── assets/
                ├── logo.png
                └── background.webp

The exact platform path is resolved by Tauri. Mochi does not hard-code HOME/.config into the native application.

## Theme forms

### Single-file theme

A single JSON file is intended for simple customisation.

It can change:

- Colours
- Typography
- Corner radii
- Sidebar width
- Content width
- Other tokenised UI properties

Example:

    {
      "schemaVersion": 1,
      "id": "midnight",
      "name": "Midnight",
      "version": "1.0.0",
      "colors": {
        "background": "#08090d",
        "accent": "#9b8cff"
      },
      "ui": {
        "radiusMd": "12px"
      }
    }

### Folder theme

A folder theme is the full extension format.

It can contain:

- theme.json
- theme.css
- images
- fonts
- future theme assets

The manifest maps logical asset names to relative files. Mochi loads those assets into safe data URLs and exposes them to CSS as variables.

For example:

    "assets": {
      "brand": "assets/brand.png"
    }

becomes:

    --mochi-asset-brand

A theme stylesheet can then use:

    background-image: var(--mochi-asset-brand);

## Theme token system

Every manifest property in colors and ui becomes a CSS variable.

CamelCase is converted to kebab-case.

Examples:

    colors.background -> --mochi-background
    colors.accentStrong -> --mochi-accent-strong
    ui.radiusMd -> --mochi-radius-md
    ui.sidebarWidth -> --mochi-sidebar-width

The standard launcher stylesheet is written against these tokens.

This means changing a token can affect many parts of the launcher at once without requiring a theme author to know every internal selector.

## Custom CSS

theme.css is loaded after the launcher's own stylesheets.

This is deliberately powerful. A theme can override:

- Layout
- Navigation
- Cards
- Dialogs
- Buttons
- Inputs
- Typography
- Borders
- Shadows
- Backgrounds
- Setup screens
- Game library presentation
- Responsive behavior

Theme CSS is treated as user-installed UI code. Mochi should therefore only install themes the user trusts.

## Layers

The launcher paints with four stylesheets, always in this order, and a theme comes last:

1. `src/styles/tokens.css` — every design token with Mochi's default value (103 of them; see `docs/theme-hooks.md`).
2. `src/index.css` — structure and per-screen layout, written entirely against tokens.
3. `src/styles/bridge.css` — maps remaining components onto tokens.
4. `src/styles/components.css` — one definition per primitive (buttons, inputs, cards, panels, dialogs, tabs) plus the shell presets below.
5. The theme: `theme.json` tokens (as a generated `:root` block), then `theme.css`.

Because every colour, radius, border width, shadow, font and surface is a token, a JSON-only theme can already reshape the whole launcher. `theme.css` is for what tokens cannot express: textures, clipped corners, pseudo-element ornaments, animation, structural changes.

## Token vocabulary

Manifest sections map to CSS variables by camelCase-to-kebab-case (`components.primaryBackground` becomes `--mochi-primary-background`). The sections are `colors`, `ui`, `typography`, `layout`, `effects` and `components`; the section a key lives in does not matter to the launcher, only its name.

| Group | Tokens (examples) |
| --- | --- |
| Palette | `background`, `backgroundElevated`, `surface`, `surfaceRaised`, `surfaceHover`, `border`, `borderStrong`, `text`, `textStrong`, `textMuted`, `textFaint`, `accent`, `accentStrong`, `accentText`, `accentSoft`, `success`, `warning`, `danger`, `shadow` |
| Typography | `fontBody`, `fontDisplay`, `mono`, `headingWeight`, `headingTracking`, `headingTransform`, `labelWeight`, `labelTracking`, `labelTransform`, `textShadow`, `headingShadow`, `imageRendering` |
| Shape | `radiusSm/Md/Lg`, `cardRadius`, `buttonRadius`, `inputRadius`, `modalRadius`, `heroRadius`, `borderWidth` |
| Layout | `sidebarWidth`, `contentMaxWidth`, `contentPadding`, `topbarHeight`, `cardGap`, `coverAspect`, `coverMin` |
| Surfaces | `appBackground`, `sidebarBackground`, `topbarBackground`, `cardBackground`, `cardHoverBackground`, `cardBorder`, `cardShadow`, `panelBackground`, `modalBackground`, `modalShadow`, `inputBackground`, `heroOverlay`, `coverPlaceholder`, `navActiveBackground`, `navActiveShadow` |
| Buttons | `buttonBackground`, `buttonColor`, `buttonBorder`, `buttonShadow`, `buttonHoverBackground`, `buttonActiveTransform`, `buttonTransform`, `primaryBackground`, `primaryColor`, `primaryShadow`, `dangerBackground` |
| Effects | `blur`, `transition`, `focusRing`, `scrollbarThumb`, `scrollbarTrack`, `scrollbarWidth` |

`node scripts/check-themes.mjs` (run by `npm run build` and CI) rejects a theme that sets a token the launcher never reads.

## Shell presets

`"shell"` in `theme.json` chooses where navigation lives. The launcher sets `data-mochi-shell` on `<html>` and the base stylesheet rearranges the shell, so a theme only dresses the result:

| Value | Layout |
| --- | --- |
| `left` | Sidebar on the left (default) |
| `right` | Sidebar on the right |
| `top` | Navigation as a bar across the top, account on the right |
| `bottom` | Navigation as a hotbar along the bottom |
| `rail` | Narrow icon rail on the left |

## Fonts and colour scheme

`"fonts"` lists Google Fonts stylesheet URLs. Only `https://fonts.googleapis.com/` URLs are loaded, and the native backend rejects other hosts when importing a theme. `"scheme"` (`light` or `dark`) tells the webview how to draw native controls such as scrollbars and date inputs.

## Built-in themes

Built-in themes are real theme folders under `src/themes/`; every folder is discovered automatically at build time (`"order"` sorts the picker). Each uses a different shell and a different visual language:

| Theme | Shell | Character |
| --- | --- | --- |
| Mochi | left | Soft glass, mint highlights |
| Mochi Light | left | Porcelain and sage |
| Minecraft Ore | top | Ore UI "Dark Diamond": charcoal panels, bevelled stone buttons, diamond-blue toolbar (after Prism Launcher's theme) |
| Minecraft Dungeons | left | Gilded dungeon tablet, ember glow, carved gold frames |
| Subnautica | rail | Pressurised-hull HUD, bubbles, chamfered scanner glass |
| Stardew Valley | bottom | Meadow, parchment menu box, toolbar hotbar |
| RuneScape | right | Carved stone panels, shadowed yellow text |
| Fallout Pip-Boy | top | Phosphor CRT, scanlines, bracketed controls, green-dithered artwork |
| Cyberpunk 2077 | rail | Sliced neon panels, glitch hover, hazard stripes |
| Animal Crossing | top | Pastel island, bubbly pill controls |
| Terraria | left | Inventory-blue slots, outlined gold titles |

Built-in themes are bundled at build time through Vite's asset graph. User themes never need to be bundled.

## Accessibility checks

`npm run build` (and `npm run check:themes`, add `--verbose` for every row) runs a WCAG 2.2 contrast check on every built-in theme using the resolved token values: manifest tokens over the defaults in `tokens.css`, plus literal `:root` overrides and the `.nav-item.active`, `.secondary-button` and `.play-button` colours in `theme.css`. It requires 4.5:1 for text, body and muted text on every surface, accent text, button, primary button, input and active-nav text, 3:1 for faint text, status colours and the focus ring (`accentStrong`) against the page and surfaces, and warns when input borders are below 3:1. It also fails a theme whose `theme.css` removes a focus outline without drawing another indicator.

A theme that must break a rule says so in the manifest, with a reason:

```json
"a11y": { "exempt": ["text-faint"], "reason": "Decorative captions only; never carries information." }
```

Exempt ids are the check ids in the report (`text-muted`, `text-faint`, `accent-text`, `button`, `primary`, `nav-active`, `status`, `focus-ring`, `focus-outline`) or `foreground:background` token pairs. See `docs/accessibility.md`.

## Authoring a theme

1. Copy `src/themes/mochi` and change the id, name and `colors`.
2. Pick a `shell` and `scheme`, add `fonts`.
3. Override primitives through tokens first (`buttonBackground`, `cardBorder`, `modalShadow`...).
4. Use `theme.css` for ornament. Class names are listed in `docs/theme-hooks.md`; scope structural rules with `[data-mochi-theme="your-id"]` only when needed, since the stylesheet is only loaded while your theme is active.
5. Preview in a browser with `npm run dev` (a dev-only mock backend stands in for Tauri), then run `npm run check:themes`.

## User theme precedence

A user theme with the same ID as a built-in theme takes precedence over the bundled version.

This intentionally allows:

1. Installing a modified version of a built-in theme.
2. Testing a theme without changing Mochi's source.
3. Replacing a built-in visual package locally.

Removing the user theme restores the bundled built-in theme.

## Importing

The Settings page exposes:

- Import theme file
- Import theme folder

After an import, Mochi reloads the available theme list so the new theme can be selected without restarting the launcher.

The native backend validates the manifest before installation.

Theme IDs are restricted to:

- ASCII letters
- Numbers
- Hyphens
- Underscores

Asset paths must be relative and may not contain parent-directory traversal.

## Configuration persistence

The selected theme is stored in:

    ~/.config/Mochi/config.json

The configuration file is JSON rather than an opaque database so advanced users can inspect and back up their launcher configuration.

The file currently contains:

    {
      "schemaVersion": 1,
      "theme": "mochi",
      "settings": {}
    }

The empty settings object is intentional. It provides a stable namespace for moving the remaining launcher preferences out of browser localStorage in a future storage migration.

## Future theme capabilities

The engine is intentionally designed so the manifest can grow without replacing the architecture.

Potential future schema sections include:

    typography
    icons
    spacing
    motion
    surfaces
    shadows
    library
    gameDetails
    tofuCards
    setup
    navigation
    accessibility
    windowChrome

The same package model can also support:

- Custom font files
- Custom icon sets
- Custom game-card templates
- Animated backgrounds
- Per-page layouts
- Custom empty states
- Custom settings controls
- Theme-specific assets
- Light and dark variants
- High-contrast variants
- Reduced-motion variants

These should be added as schema capabilities rather than hard-coded theme IDs.

## Security boundaries

Theme files are local user content.

The native loader validates:

- Manifest schema version
- Theme ID
- Asset path traversal
- Manifest structure

Future package handling should additionally enforce:

- Maximum package size
- Maximum individual asset size
- Symbolic-link rejection
- CSS size limits
- Atomic installation
- Temporary extraction directories
- No executable files in theme packages

Themes should never gain access to arbitrary native commands merely because they contain CSS or assets.

## Relationship to launcher configuration

Themes are presentation data.

Launcher state such as:

- Accounts
- Pikos
- Tofus
- API configuration
- Provider credentials
- Import preferences
- Window preferences

should remain separate from theme packages.

A theme should never be able to change a user's game launch target or execute a native command.

This separation is important as Mochi grows into a full launcher and mod manager.

## Long-term package format

The current folder format is intentionally simple and human-editable.

A future distributable theme package can use an archive containing the same structure:

    theme.json
    theme.css
    assets/

The archive importer can extract into a temporary directory, validate the complete package, and atomically install it into the user's themes directory.

That means the user-facing theme format does not need to change when a theme marketplace or theme sharing system is introduced later.
