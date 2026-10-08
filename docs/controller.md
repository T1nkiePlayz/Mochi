# Controller support

Mochi can be driven entirely with a controller: Xbox, PlayStation (DualShock 4 / DualSense), Nintendo Switch Pro, Steam Deck built-in controls, Steam Controller and most generic pads.

## How input reaches the UI

1. `src-tauri/src/gamepad.rs` runs a background `gilrs` thread (it never blocks or crashes startup; if the gamepad subsystem is unavailable it logs once and exits). It handles hot-plug and emits normalised `gamepad-event`s: `connected` (name + family `xbox|playstation|switch|steam|deck|generic`), `disconnected`, `button` and `axis`, with buttons named by physical position (`south`, `east`, `west`, `north`, `l1`, ...). `MOCHI_NO_GAMEPAD=1` disables it.
2. `src/controller/manager.ts` turns that into UI actions (`up/down/left/right`, `confirm`, `back`, `menu`, `options`, `tabPrev`, `tabNext`, `triggerLeft/Right`, `x`, `y`, `chord`) with dead zone, hysteresis and repeat-on-hold. If the native source is not available (browser dev server) it falls back to the web Gamepad API.
3. `src/controller/ControllerRuntime.tsx` applies those actions to the normal UI: spatial navigation, confirm, back, tab switching, scrolling (right stick, triggers). It respects modals (navigation stays inside the top-most dialog), `.mochi-select` popovers (arrows, confirm and back are forwarded as key presses), text fields (left/right move the caret, confirm opens the on-screen keyboard) and sliders.

Controller navigation turns on automatically the first time a controller is used, unless you turned it off in Settings. Big Picture always accepts controllers.

## Layouts

Confirm is the south button (A on Xbox, cross on PlayStation). Nintendo layouts put "A" on the east button, so Mochi confirms with east there automatically. Settings has "Swap confirm and back". Prompts (footer legends, keyboard hints) follow the connected controller family, or a style you pick.

## Settings

Stored under the local-storage key `mochi:controller` (not in `Behavior`): enabled, swap confirm/back, stick dead zone, repeat speed, prompt style, on-screen keyboard, interface sounds. See `src/controller/settings.ts`.

## Writing UI that works with a controller

- Use real buttons/links/inputs. Anything focusable with the keyboard is reachable.
- Add `data-nav` to a custom focusable that is not natively focusable, `data-nav-default` to the element that should receive focus first, and `data-nav-scope` to a container that must trap navigation (like a modal).
- Do not rely on hover.

## Rumble

`gamepad_rumble` is available for short haptic pulses; nothing uses it by default.
