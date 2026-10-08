import { openExternalUrl } from "./platform";

/**
 * Update checking and installation. Two paths:
 *  - native: Tauri's updater (signed bundles from latest.json) for AppImage and macOS .app installs;
 *  - manual: GitHub's "latest release" API for deb/rpm/AUR/dev builds or when the updater fails.
 * Everything here degrades to a plain result object; nothing throws into the UI.
 */

export const RELEASES_API = "https://api.github.com/repos/T1nkiePlayz/Mochi/releases/latest";
export const RELEASES_PAGE = "https://github.com/T1nkiePlayz/Mochi/releases/latest";

export type UpdateInfo = {
  version: string;
  notes: string;
  /** Page to open for a manual download. */
  releaseUrl: string;
  /** True when the app can download and install this update itself. */
  installable: boolean;
};

export type CheckResult =
  | { kind: "available"; info: UpdateInfo }
  | { kind: "current" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export type DownloadProgress = { downloaded: number; total?: number };

type NativeUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
};

let pendingNative: NativeUpdate | null = null;

/** Parses "v1.2.3-beta.1+build" into comparable parts, or null when it is not semver. */
export function parseVersion(raw: string): { core: number[]; pre: string[] } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split(".") : [] };
}

/** Semver precedence: negative when a < b, 0 when equal or unparsable, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export const isNewerVersion = (candidate: string, current: string) => compareVersions(candidate, current) > 0;

/** Extracts the fields Mochi needs from a GitHub release payload. Returns null for drafts, prereleases or junk. */
export function parseGithubRelease(json: unknown): { version: string; notes: string; url: string } | null {
  if (!json || typeof json !== "object") return null;
  const release = json as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  if (!parseVersion(tag)) return null;
  const url = typeof release.html_url === "string" && release.html_url.startsWith("https://github.com/") ? release.html_url : RELEASES_PAGE;
  return { version: tag.replace(/^v/, ""), notes: typeof release.body === "string" ? release.body : "", url };
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Vite dev server without Tauri (see src/devMock.ts). */
const isDevMock = () => import.meta.env.DEV && Boolean((window as unknown as Record<string, unknown>).__MOCHI_DEV_MOCK__);

async function checkGithub(currentVersion: string): Promise<CheckResult> {
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return { kind: "error", message: `GitHub returned HTTP ${response.status}.` };
    const release = parseGithubRelease(await response.json());
    if (!release || !isNewerVersion(release.version, currentVersion)) return { kind: "current" };
    return { kind: "available", info: { version: release.version, notes: release.notes, releaseUrl: release.url, installable: false } };
  } catch (error) {
    return isOffline() ? { kind: "offline" } : { kind: "error", message: messageOf(error) };
  }
}

export async function checkForUpdate(currentVersion: string): Promise<CheckResult> {
  pendingNative = null;
  if (isOffline()) return { kind: "offline" };
  if (isDevMock()) {
    return { kind: "available", info: { version: "9.9.9", notes: "Development mock release.\n\n- Faster startup\n- Fixes", releaseUrl: RELEASES_PAGE, installable: true } };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "current" };
    if (!isNewerVersion(update.version, currentVersion)) return { kind: "current" };
    pendingNative = update as unknown as NativeUpdate;
    return { kind: "available", info: { version: update.version, notes: update.body ?? "", releaseUrl: RELEASES_PAGE, installable: true } };
  } catch {
    // Not an AppImage/.app install, no signed manifest yet, or no network: use the public release feed.
    return checkGithub(currentVersion);
  }
}

/**
 * Downloads, installs and relaunches. Resolves "restarting" on success; "manual" means the native
 * updater could not do it (e.g. deb/rpm install) and the caller should offer the release page.
 */
export async function installUpdate(onProgress: (progress: DownloadProgress) => void): Promise<"restarting" | "manual"> {
  if (isDevMock()) {
    for (let i = 1; i <= 10; i++) { onProgress({ downloaded: i * 100, total: 1000 }); await new Promise((resolve) => setTimeout(resolve, 150)); }
    return "restarting";
  }
  const update = pendingNative;
  if (!update) return "manual";
  try {
    let downloaded = 0;
    let total: number | undefined;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") { total = event.data?.contentLength; onProgress({ downloaded, total }); }
      else if (event.event === "Progress") { downloaded += event.data?.chunkLength ?? 0; onProgress({ downloaded, total }); }
    });
  } catch {
    pendingNative = null;
    return "manual";
  }
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch { /* installed; the new version starts next launch */ }
  return "restarting";
}

export const openReleasePage = (url: string = RELEASES_PAGE) => openExternalUrl(url).catch(() => {});

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
