# Per-game controller profiles

A controller profile changes how SDL sees your controllers for one game. Mochi cannot remap input for an arbitrary program (that would need a virtual input device), but most native Linux games, Proton/Wine games and many emulators read their controllers through SDL, and SDL is configured through environment variables. Mochi sets those variables when it starts the game.

## Where

Game editor, Launch tab, "Controller profile". Pick a profile or "None (use system default)", or create a new one. Profiles are stored on this device (`mochi:controller-profiles` in local storage, next to the controller settings) and can be assigned to several games.

## What a profile holds

- **Button layout**: Xbox layout (nothing changes), Nintendo layout (swaps A/B and X/Y), or Custom: pick what each of A, B, X, Y, the shoulders, triggers, stick clicks, Start and Back acts as. Two buttons cannot act as the same button.
- **Controller type**: Automatic, Xbox, PlayStation or Nintendo (`SDL_GAMECONTROLLERTYPE`, for the controllers connected at launch).
- **Use only this controller**: one of the controllers connected now (`SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT`, by vendor and product).
- **Ignore Steam virtual controllers**: `SDL_GAMECONTROLLER_IGNORE_DEVICES` for the pad Steam Input creates.
- **hidraw** (Linux): `SDL_JOYSTICK_HIDAPI=1`, and for Proton also `PROTON_ENABLE_HIDRAW=1` and `PROTON_PREFER_SDL=1`.

The remap is written as an `SDL_GAMECONTROLLERCONFIG` line for each connected controller. The "Variables this profile adds" box and the "Final command" preview show exactly what a launch will use. Variables you set yourself in the launch options always win over the profile's.

## Limits

- Only for programs Mochi starts itself (including Wine and Proton). Games handed to Steam are controlled by Steam Input, Flatpak apps and games started by other launchers do not get the profile; the editor says so.
- gilrs (Mochi's input library) does not expose SDL mapping strings, so the remap works only for controllers whose exact SDL GUID is in Mochi's bundled table of Linux mappings (Xbox 360/One/Series, DualShock 4 and DualSense, each driver variant listed separately). Mochi never guesses a mapping from the controller family; other controllers are listed in the editor as skipped. The remap is built when the game starts from the controllers connected at that moment; with none connected it is skipped.
- Games that do not use SDL (or that read input another way) ignore the profile.
- The bundled mappings are copied from [SDL_GameControllerDB](https://github.com/mdqinc/SDL_GameControllerDB) (zlib license, Copyright (C) 2014-present the SDL_GameControllerDB contributors). The SDL variables are not tested against real hardware or every SDL version.
