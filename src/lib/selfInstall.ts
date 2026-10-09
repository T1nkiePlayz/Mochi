import { invoke } from "@tauri-apps/api/core";

/** Pending "install this build over the managed copy" state; null from the backend means nothing to do. */
export type SelfInstallStatus = {
  /** Version of the running build. */
  version: string;
  installedVersion: string | null;
  firstInstall: boolean;
  sourcePath: string;
  targetPath: string;
};

export type VerifyResult = {
  status: "verified" | "mismatch" | "unavailable" | "offline";
  detail: string;
};

export const selfInstallStatus = () => invoke<SelfInstallStatus | null>("self_install_status");
export const selfInstallVerify = () => invoke<VerifyResult>("self_install_verify");
/** Installs and relaunches (the app exits on success); rejects with a message and keeps running on failure. */
export const selfInstallApply = () => invoke<void>("self_install_apply");
export const selfInstallSkip = () => invoke<void>("self_install_skip");
