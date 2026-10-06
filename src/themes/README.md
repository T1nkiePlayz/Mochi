# Mochi Themes

Mochi themes are packages rather than simple accent presets.

A minimal theme can be one JSON file:

    my-theme.json

A full theme can be a directory:

    my-theme/
      theme.json
      theme.css
      assets/
        brand.png
        hero.webp

## Manifest

The manifest contains:

- schemaVersion
- id
- name
- version
- author
- description
- colors
- ui
- assets

Every color and UI property becomes a CSS custom property.

For example, colors.background becomes --mochi-background and ui.radiusMd becomes --mochi-radius-md.

## Custom CSS

A folder theme may include theme.css. Mochi loads it after the standard token bridge, so a theme can change layouts, borders, typography, backgrounds, cards, navigation, dialogs and other visual details rather than only changing colours.

Theme CSS can use asset variables declared by the manifest. For example:

    "assets": {
      "brand": "assets/brand.png"
    }

can be used as:

    background-image: var(--mochi-asset-brand);

Custom CSS is intentionally powerful and should only be installed from themes the user trusts.

## User configuration

Mochi uses the platform's application configuration directory with a human-readable Mochi folder.

Linux:

    ~/.config/Mochi/
      config.json
      themes/
        example.json
        example-folder/
          theme.json
          theme.css
          assets/

macOS and other supported platforms use the equivalent native configuration location.

config.json contains launcher configuration such as the selected theme. Future settings can be moved into this same configuration model without changing the theme storage contract.

## Importing

Settings provides separate import actions for:

- Theme file — imports a single theme.json file.
- Theme folder — imports a complete theme package with its CSS and assets.

The native backend validates the manifest and rejects unsafe theme IDs and asset paths that attempt to escape the theme directory.
