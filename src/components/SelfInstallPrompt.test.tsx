// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const confirmAction = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("../lib/confirm", () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));

import { SelfInstallPrompt } from "./SelfInstallPrompt";

const status = { version: "1.2.3", installedVersion: "1.2.0", firstInstall: false, sourcePath: "/dl/Mochi.AppImage", targetPath: "/home/u/Mochi.AppImage" };
const route = (map: Record<string, unknown>) => invoke.mockImplementation(async (cmd: string) => map[cmd]);

beforeEach(() => { invoke.mockReset(); confirmAction.mockReset(); });
afterEach(cleanup);

describe("SelfInstallPrompt", () => {
  it("renders nothing without a pending install", async () => {
    route({ self_install_status: null });
    const { container } = render(<SelfInstallPrompt />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("self_install_status"));
    expect(container.innerHTML).toBe("");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation on a mismatch and skips when declined", async () => {
    route({ self_install_status: status, self_install_verify: { status: "mismatch", detail: "" } });
    confirmAction.mockResolvedValue(false);
    render(<SelfInstallPrompt />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("self_install_skip"));
    expect(confirmAction).toHaveBeenCalledWith({
      title: "This version of Mochi couldn't be verified",
      message: "This file doesn't match the signed release of Mochi 1.2.3. It may be damaged or modified. Replace the installed version (1.2.0) with this one anyway?",
      items: ["From: /dl/Mochi.AppImage", "To: /home/u/Mochi.AppImage"],
      confirmLabel: "Replace anyway",
      danger: true,
    });
    expect(invoke).not.toHaveBeenCalledWith("self_install_apply");
  });

  it("applies without confirming when verified", async () => {
    route({ self_install_status: status, self_install_verify: { status: "verified", detail: "" } });
    render(<SelfInstallPrompt />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("self_install_apply"));
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
