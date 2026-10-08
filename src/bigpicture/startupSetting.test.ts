// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("readStartupSetting", () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it("prefers the device-wide mirror over the shared settings", async () => {
    localStorage.setItem("mochi:settings", JSON.stringify({ bigPictureOnStartup: false }));
    localStorage.setItem("mochi:bigpicture-startup", "true");
    const { readStartupSetting } = await import("./mode");
    expect(readStartupSetting()).toBe(true);
  });

  it("falls back to the shared settings on older installs", async () => {
    localStorage.setItem("mochi:settings", JSON.stringify({ bigPictureOnStartup: true }));
    const { readStartupSetting } = await import("./mode");
    expect(readStartupSetting()).toBe(true);
  });
});
