# Playtime import

Mochi can add the playtime other launchers already recorded, so Stats and per-game totals are not empty after you switch.

Where: Settings > Data & privacy. "Import Steam playtime" handles Steam. "Import playtime from other launchers" handles the rest and only lists sources found on this device.

| Source | Read from | Platforms |
|---|---|---|
| Heroic | `store/timestamp.json` in Heroic's config folder (native and Flatpak on Linux, `~/Library/Application Support/heroic` on macOS) | Linux, macOS |
| Lutris | `pga.db` (`~/.local/share/lutris`, or the Flatpak data folder) | Linux |
| GOG Galaxy | `galaxy-2.0.db` in `/Users/Shared/GOG.com/Galaxy/Storage` | macOS |

How it works:
- Pick a source and press Preview. It lists each library game and the minutes an import would add. Nothing changes yet.
- Import adds the missing part per game as one earlier session dated by the source's last-played time. Mochi never removes or lowers anything.
- Importing twice adds nothing: a game only receives the difference between the source's total and what Mochi already tracks.
- Games are matched by store identity, not by name: Heroic `appName`, Lutris game id or slug, GOG game id. Playtime for games outside your library is skipped.
- The Lutris and Galaxy databases are copied to a temporary folder and read there, so a running launcher is never locked or modified.

Limits: Linux has no GOG Galaxy, but Heroic covers GOG games there. Heroic's `totalPlayed` is read as minutes and Lutris' `playtime` as hours. Galaxy entries for other stores (Steam, Epic) are ignored.
