import { invoke } from "@tauri-apps/api/core";

/** Whether Mochi receives nxm:// links. `configurable` is false on macOS, where the app bundle declares the scheme. */
export type NxmHandler = { configurable: boolean; registered: boolean };
export const getNxmHandler = () => invoke<NxmHandler>("get_nxm_handler");
/** Linux: makes Mochi the default nxm:// handler (or gives it back). Other mod managers may want it, so it is opt-in. */
export const setNxmHandler = (enabled: boolean) => invoke<NxmHandler>("set_nxm_handler", { enabled });
