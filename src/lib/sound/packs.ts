import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { SoundEvent } from "./events";

/** An installed (user) sound pack, as listed by the native side. */
export type SoundPackInfo = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  events: SoundEvent[];
  volume: number;
  sizeBytes: number;
};

export const listSoundPacks = () => invoke<SoundPackInfo[]>("list_sound_packs");
export const removeSoundPack = (id: string) => invoke<void>("remove_sound_pack", { id });
export const readSoundPackFile = (id: string, event: SoundEvent) => invoke<ArrayBuffer>("read_sound_pack_file", { id, event });

/** Asks for a .zip (or a manifest.json inside a pack folder) and installs it. Resolves to null when cancelled. */
export async function importSoundPack(kind: "zip" | "folder"): Promise<SoundPackInfo | null> {
  const selected = kind === "folder"
    ? await open({ directory: true, multiple: false, title: "Choose a sound pack folder" })
    : await open({ multiple: false, title: "Choose a sound pack", filters: [{ name: "Sound pack", extensions: ["zip"] }] });
  if (!selected || Array.isArray(selected)) return null;
  return invoke<SoundPackInfo>("import_sound_pack", { sourcePath: selected });
}

/** Saves an installed pack as a zip. Resolves to false when cancelled. */
export async function exportSoundPack(pack: Pick<SoundPackInfo, "id">): Promise<boolean> {
  const destination = await save({ title: "Export sound pack", defaultPath: `${pack.id}.zip`, filters: [{ name: "Sound pack", extensions: ["zip"] }] });
  if (!destination) return false;
  await invoke<void>("export_sound_pack", { id: pack.id, destination });
  return true;
}

export const SOUND_PACKS_CHANGED = "mochi-sound-packs-changed";
export const announceSoundPacksChanged = () => window.dispatchEvent(new Event(SOUND_PACKS_CHANGED));
