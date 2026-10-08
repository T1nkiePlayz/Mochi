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
};

/** Queues a download in the native layer and returns its id; progress shows in the Downloads list. */
export async function startModDownload(request: ModDownloadRequest): Promise<string> {
  try {
    return await invoke<string>("start_mod_download", { request });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Unable to start the download.");
  }
}
