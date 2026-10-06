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

The standard launcher stylesheet is connected to these tokens through a runtime bridge.

This means changing a token can affect many parts of the launcher at once without requiring a theme author to know every internal selector.

## Custom CSS

theme.css is loaded after the standard theme bridge.

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

## Built-in themes

Built-in themes are stored as real theme folders in the source tree.

Current built-ins:

- Mochi
- Minecraft Ore
- Subnautica
- Minecraft Dungeons

Minecraft Ore replaces the previous Minecraft accent-only implementation with a full Mochi-native visual theme. It uses block-like geometry, mineral greens, stronger borders and a custom ore asset while retaining Mochi's own layout and branding.

Built-in themes are bundled at build time through Vite's asset graph. User themes never need to be bundled.

## User theme precedence

A user theme with the same ID as a built-in theme takes precedence over the built-in theme.

This intentionally allows:

1. Installing a modified version of a built-in theme.
2. Testing a theme without changing Mochi's source.
3. Replacing a built-in visual package locally.

Removing the user theme restores the bundled built-in theme.

## Importing

The Settings page exposes:

- Import theme file
- Import theme folder

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
