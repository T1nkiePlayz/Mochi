import { isBigPictureActive } from "../../bigpicture/mode";
import type { SoundEvent } from "./events";
import { play, soundAllowed } from "./engine";

export { SOUND_EVENTS, SOUND_LABELS, type SoundEvent } from "./events";
export { useSoundSettings, getSoundSettings, updateSoundSettings, type SoundSettings, type MovementSounds } from "./settings";
export { BUILTIN_PACKS, DEFAULT_PACK_ID, isBuiltinPack } from "./synth";

/** Plays an interface sound if the user's settings allow it in the current view (Big Picture or the launcher). */
export function playSound(event: SoundEvent): void {
  if (soundAllowed(event, isBigPictureActive() ? "bigpicture" : "launcher")) play(event);
}
