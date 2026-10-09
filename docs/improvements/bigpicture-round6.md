# Big Picture, round 6

## Display options
- Menu > Display: layout (shelves or a wrapping grid of Favourites / All games / Launchers), tile shape (portrait,
  landscape, square), tile size (small, medium, large) and game titles (always, on focus, never). Saved per device
  (`mochi:bigpicture-display`, `src/bigpicture/display.ts`) and applied as `data-bp-*` attributes on `.bp-root`.
- Root cause of "squashed" games without metadata: `.generated-art` sets `position: relative`, which beat
  `.bp-art { position: absolute; inset: 0 }`, so generated covers (and the generated backdrop) collapsed to the
  height of their initials. Fixed; initials are now sized by the tile's shorter side (`container-type: size`), lifted
  above the title, and generated covers keep their title even when titles are hidden.

## Power and window menu
- Menu > Power: Sleep (macOS) / Suspend (Linux), Restart, Shut down (each needs a second press), Minimise and
  Toggle full screen (hidden in gamescope), Exit Big Picture, Quit.
- Rust `power_action` / `get_power_capabilities` in `bigpicture.rs`. Linux: `systemctl suspend|reboot|poweroff` when
  systemd is running, else `loginctl`; actions logind reports as `na`/`no` (busctl `CanSuspend` etc.) are hidden.
  macOS: `pmset sleepnow`; restart/shut down through `osascript` + System Events (Apple Events entitlement and
  `NSAppleEventsUsageDescription` added). polkit, inhibitor and macOS Automation errors become readable messages.
  Command selection and error mapping are unit-tested.

## Interface sounds (`src/lib/sound/*`)
- Web Audio engine: one AudioContext (`latencyHint: "interactive"`, `webkitAudioContext` fallback), every sound of
  the active pack pre-rendered into AudioBuffers, play = one buffer source; per-event rate limits and a voice cap.
  Audio is unlocked on the first pointer/key/touch input (silent buffer + resume) for WebKitGTK and WKWebView.
- 13 events: navigate, tab, select, back, open, close, launch, error, notification, toggleOn/Off, achievement,
  download. `src/bigpicture/InterfaceSounds.tsx` (mounted by `BigPictureGate`, so it covers the launcher too) maps
  controller actions, clicks (by role: switch, checkbox, tab, button), dialogs/menus appearing, game sessions
  starting, downloads finishing/failing, launch errors, notifications and achievement unlocks to sounds.
- Settings > Sound: Big Picture on (default), launcher off (default), mute, volume, movement sounds
  (always / never / off under reduced motion, default), pack choice ("Match theme" default) and a preview of every
  sound. The Big Picture menu has the same controls. The old controller `uiSounds` toggle is gone.

## Sound packs
- Three original built-in packs synthesised in code (`mochi`, `chiptune`, `glass`); pipboy, terraria, minecraft-ore
  and runescape suggest chiptune, subnautica and cyberpunk suggest glass (`soundPack` in theme.json, validated by
  `check-themes.mjs` and the Rust theme validator, also passed through for user themes).
- Rust `soundpacks.rs`: manifest validation, size caps, audio signature checks, symlink refusal, zip import that reads
  entries only by exact name, atomic install via a staging folder, export to zip, remove, raw-bytes file reads.
  Format documented in `docs/sound-packs.md`. Settings > Sound packs imports (zip or folder), exports and removes
  with an inline themed confirmation (to be swapped for the shared confirm dialog later).

## Not verified
Per the round's instructions no visual or headless pass was run. Not checked on real hardware: sound output and
autoplay unlock in WKWebView/WebKitGTK (gamepad-only input before any key/click may stay silent on macOS until the
first key or click), macOS sleep/restart/shut down and the Automation prompt, polkit prompts on Linux desktops,
Ogg decoding on macOS, and the look of the new menu pages and tile options across all themes.
