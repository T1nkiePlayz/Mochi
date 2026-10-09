import { invoke } from "@tauri-apps/api/core";

export type ModDownloadProvider = "modrinth" | "curseforge" | "nexus";

/** What the native downloader needs. It re-checks the host against the provider's allow-list and verifies `sha1`. */
export type ModDownloadRequest = {
  provider: ModDownloadProvider;
  url: string;
  /** Tofu folder the file lands in. */
  path: string;
  tofuId: string;
  tofuName: string;
  itemName: string;
  filename: string;
  sha1?: string;
  /** Unpack a .zip into the folder instead of keeping the archive. */
  extract?: boolean;
  /** Minecraft content that lives beside `mods`: the file lands in `<path>/<subdir>`. */
  subdir?: "resourcepacks" | "shaderpacks";
  /** Where the file came from; saved with the Tofu's mod list so updates and the launch sync know it. */
  record?: ModRecordInput;
};

/** What Mochi remembers about an installed file (see `ModRecord` in lib/mods/instances). */
export type ModRecordInput = {
  source: ModDownloadProvider;
  projectId: string;
  fileId: string;
  version?: string;
  title?: string;
  iconUrl?: string;
  /** Publication date of the file, used to tell newer files from older ones. */
  fileDate?: string;
  /** Install-time facts for the offline conflict check (not kept for CurseForge files). */
  gameVersions?: string[];
  loaders?: string[];
  requires?: string[];
  incompatible?: string[];
};

/** Queues a download in the native layer and returns its id; progress shows in the Downloads list. */
export async function startModDownload(request: ModDownloadRequest): Promise<string> {
  try {
    return await invoke<string>("start_mod_download", { request });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Unable to start the download.");
  }
}

/** Stops a running download and discards its partial file. */
export const cancelModDownload = (id: string) => invoke<void>("cancel_mod_download", { id });
/** Removes finished entries from the Downloads list (the files stay on disk). */
export const clearFinishedDownloads = () => invoke<void>("clear_finished_downloads");
