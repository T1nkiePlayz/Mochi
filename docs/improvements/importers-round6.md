# Importers, launchers and notifications (round 6)

## What changed

| Area | Change | Where |
| --- | --- | --- |
| Desktop icons | `.desktop` `Icon=` is resolved (absolute path, hicolor 512/256 PNG, then scalable SVG, then smaller PNGs, other themes, pixmaps; XDG data dirs, Flatpak and Snap exports; 4 MB cap, XPM skipped). Flatpak games use their exported icon, macOS bundles the largest PNG in their `.icns`, Prism instances their custom icon. | `sources/icons.rs` |
| Icon covers | `cache_icon_cover` draws the icon (or a launcher's IGDB logo) centred on a gradient taken from its own colour (light background for dark marks) and stores a 600x800 JPEG in the artwork cache. It never replaces an existing cover unless asked. SVGs are rasterised by the web view and sent back as PNG. | `icon_cover.rs`, `src/lib/iconCover.ts` |
| Import flow | After an import: icon covers first (works offline), then launcher logos, then metadata lookups (which replace icons with real art). `artworkSource: "icon"` is local only (synced as null). | `src/state/useAddGame.ts` |
| Launchers | Table extended (Hytale, Modrinth App, CurseForge, GDLauncher, HMCL, XMCL, Fjord, Lunar, Game Jolt, EmuDeck, `steam-native`) with bundled art. `src/lib/launchers.ts` mirrors the Rust table (test fails on drift) and `sanitizeLibrary` re-classifies old entries into "Game launchers", fills `launcherId`, and drops trailers from launchers. | `sources/classify.rs`, `src/lib/launchers.ts`, `src/lib/library.ts` |
| Launcher logos | Launchers get their company's IGDB logo through the deployed `igdb-company` action (slugs tried in order). Launcher "refresh" only refreshes the logo; launchers never get game metadata or trailers. | `src/lib/iconCover.ts`, `src/state/useMetadata.ts` |
| Notifications | Linux: `notify-send --icon=<installed mochi.png> --hint=string:desktop-entry:dev.sidequestgames.Mochilauncher` (icon written on demand). macOS: notification centre via `mac-notification-sys` with the bundle id when running from `Mochi.app`, `osascript` fallback. | `platform/linux.rs`, `platform/macos.rs` |
| Battle.net | Minimal protobuf reader for `product.db` (uid, product code, install path, installed flag). Linux: Wine prefixes under `~/.wine`, `~/Games/*`, Heroic prefixes, Bottles (native + Flatpak); launched with `wine Battle.net.exe --exec="launch CODE"` in that prefix. macOS: `/Users/Shared/Battle.net/Agent/product.db`, launched with `battlenet://CODE`. | `sources/battlenet.rs` |
| GOG | No SQLite: every GOG install has a `goggame-<id>.info`. macOS: Galaxy `.app` bundles in /Applications, ~/Applications and Galaxy's library folder. Linux: `~/GOG Games/*/start.sh` (offline installers, Minigalaxy); Heroic GOG games stay in the Heroic source. | `sources/gog.rs` |
| Minecraft instances | Prism, Fjord, PolyMC, MultiMC (native + Flatpak on Linux, Application Support on macOS, `InstanceDir` honoured, portable folder via manual scan). Each instance is a Minecraft game; its default Tofu points at the instance's `mods` (version + loader from `mmc-pack.json`). Launch: `<launcher> --launch <instance>`. | `sources/prism.rs`, `src/lib/importMapping.ts` |

## Needs the lead

- Apply `supabase/migrations/20261009150000_more_import_sources.sql`, then add `epic`, `whisky`, `battlenet`, `gog`, `prism` to `CLOUD_SOURCE_IDS` in `src/lib/cloud.ts` (until then those source ids sync as null instead of failing the `pikos_source_id_check` constraint; Epic/Whisky on macOS were already affected before this round).

## Not verified

- macOS code paths (cannot build macOS here): `mac-notification-sys` call, `open -b` for the Prism family (Fjord/PolyMC bundle ids are guesses), Galaxy `config.json` keys, real `.icns` files.
- Battle.net: field numbers of `product.db` follow the community-documented schema; launch codes for newer products and the `--exec` hand-off under Wine were not tried against a real install.
- IGDB company slugs were not checked against IGDB (the site blocks automated reads); each launcher falls back to the company name.
- Visual result of icon covers in the running app (only unit-tested pixel checks and the dev mock).
