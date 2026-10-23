# Flatpak

Mochi has a Flatpak manifest in `packaging/flatpak/` for a Flathub listing. **The Flathub listing is pending**; until it is accepted, build the Flatpak yourself.

The manifest repackages the released `.deb` (the approach Tauri documents), so the Flatpak runs the same binary as the other Linux packages. The metainfo and desktop file come from this repository.

## Building locally

```sh
flatpak install flathub org.gnome.Platform//48 org.gnome.Sdk//48
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/dev.sidequestgames.Mochilauncher.yml
flatpak run dev.sidequestgames.Mochilauncher
```

Only x86_64 is packaged (the release publishes an amd64 `.deb`).

## What changes inside the sandbox

- Mochi detects Flatpak (`FLATPAK_ID` or `/.flatpak-info`). Every process it starts for a game, launcher or tool (Steam, Heroic, Lutris, Wine/Proton, hooks, `flatpak run`, `xdg-open`, `notify-send`, prefix tools) goes through `flatpak-spawn --host`, with the environment passed as `--env=` and the working directory as `--directory=`. The wrapping is in one place, `src-tauri/src/platform/sandbox.rs`.
- Looking for a program (`steam`, `lutris`, `wine`, ...) asks the host's PATH, not the sandbox's.
- **Updates come from Flathub.** Mochi reports its install type as `flatpak` (`get_platform_capabilities`), the update check does nothing, and the "open a newer build" self-install is disabled.

## Permissions

| Permission | Why |
|---|---|
| `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc`, `--device=dri` | Window and GPU rendering |
| `--share=network` | Metadata, news, Discover, mod downloads, accounts and sync |
| `--socket=pulseaudio` | Interface sounds |
| `--device=all` | Controllers and rumble (Big Picture) |
| `--filesystem=home` | Mochi reads other launchers' data (Steam, Heroic, Lutris, Bottles, itch) and the game folders, Wine prefixes and mods under `$HOME`; no portal can express that. Add games outside `$HOME` with `flatpak override --user --filesystem=/path dev.sidequestgames.Mochilauncher` |
| `--talk-name=org.freedesktop.Flatpak` | Start host programs through `flatpak-spawn --host`. This is effectively host access, which is the point of a launcher |
| `--talk-name=org.freedesktop.Notifications` | Desktop notifications |
| `--talk-name=org.kde.StatusNotifierWatcher` | Tray icon |

## Known limitations

- **Playtime tracking.** The sandbox has its own PID namespace and cannot see host processes in `/proc`. Playtime for a game started directly follows the lifetime of its `flatpak-spawn` process (it stays alive while the game runs). Following a game handed to another launcher by process group or install folder is best effort and may not work.
- **Stopping games and hooks.** Mochi starts host programs through `flatpak-spawn`, which forwards SIGTERM and SIGINT but cannot forward SIGKILL. **Stop** sends SIGTERM; if the game ignores it, Mochi does not force-kill (that would only end `flatpak-spawn`), keeps the game marked as running and shows a notice that it may still be running on the host. A hook that exceeds its time limit gets SIGTERM and, if it ignores it, is abandoned (reported as "not killed") rather than reported as stopped.
- Application-menu shortcuts and the managed AppImage copy are written inside the sandbox's data folder and are not visible to the host desktop.
- Tools Mochi finds on the host must exist on the host; the sandbox's own runtime programs are not used.
- Not run on real hardware or through `flatpak-builder` yet: this change was validated only with `appstreamcli` and `desktop-file-validate` and unit tests.

## Submission TODO

- Flathub requires **PNG or JPEG screenshots**. `docs/screenshots` only has WebP: convert them, commit them, and update the URLs in the metainfo (the `screenshots` block has a comment marking this).
- The runtime version (`48`) must be a supported GNOME runtime when submitting; bump it and retest if it has been end-of-lifed.
- Verify that the tray icon library (built from the inlined modules) and web view work in the sandbox with a real build.

## Submitting to Flathub

1. Fork [flathub/flathub](https://github.com/flathub/flathub) and create a branch from `new-pr`.
2. Add the manifest (`dev.sidequestgames.Mochilauncher.yml`), the desktop file and metainfo it references, and a `flathub.json` (for example `{"only-arches": ["x86_64"]}`) at the top level of the branch. Flathub builds from a self-contained repository, so the manifest already inlines the tray library modules and vendors their patches in `packaging/flatpak/patches/`, so copy that folder too.
3. Open a pull request against `flathub/flathub` titled `Add dev.sidequestgames.Mochilauncher`, and answer the checklist.
4. Reviewers check that the metainfo validates, the permissions are justified (expect questions about `--filesystem=home`, `--device=all` and `org.freedesktop.Flatpak`; the table above is the answer), the license is stated, and that the app id belongs to a domain or project you control. Respond to review comments, then Flathub creates the `flathub/dev.sidequestgames.Mochilauncher` repository.
5. Later releases: bump the manifest in that repository (see [release.md](release.md)); Flathub's bot builds and publishes.
