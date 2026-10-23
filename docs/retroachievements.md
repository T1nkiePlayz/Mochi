# RetroAchievements

Mochi can show your [RetroAchievements](https://retroachievements.org) progress on a game's page: earned of total,
hardcore and softcore counts, points, the badge grid and unlock dates.

## Set up
1. Settings > Achievements > RetroAchievements: enter your user name and your Web API key (from
   retroachievements.org/settings), then press **Test connection**.
2. Open a game's editor > Metadata > **RetroAchievements game**. Pick the console, search by title (or let Mochi
   suggest the obvious match when the game's platform is a known console), or type the game id from the
   retroachievements.org game URL. Use **Unlink** to remove the link.
3. The game's page now shows a RetroAchievements panel. **Refresh** fetches the latest progress.

## Privacy and security
- The user name and key are stored only on this device. They are never synced, never included in settings
  exports, backups or **Copy debug info**, and never logged.
- RetroAchievements requires the key as a URL query parameter, so Mochi never logs or displays request URLs and
  error messages never include them. All requests are made by Mochi's Rust side, only to
  `https://retroachievements.org/API/` (redirects to other hosts are refused). Badge images load from
  `https://media.retroachievements.org` (see [security-csp.md](security-csp.md)).
- The game link (which Mochi game is which RetroAchievements game) is also local to this device.

## Caching and offline
Progress is cached for 10 minutes and each console's game list for 7 days, on disk. Offline, or when
RetroAchievements cannot be reached, the last saved data is shown and marked as saved.

## Limits
- Mochi reads progress only; it does not identify ROMs by hash or unlock anything.
- Search covers games that have achievements, within the console you choose (the common consoles are listed).
- One RetroAchievements game per Mochi game.
