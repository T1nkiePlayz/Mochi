// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushLibrary = vi.fn(async () => undefined);
let settingsGate: Promise<void> = Promise.resolve();
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../lib/cloud", async (original) => ({
  ...(await original<typeof import("../lib/cloud")>()),
  getCloudAccountSettings: vi.fn(async () => { await settingsGate; return { syncEnabled: true, metadataSyncAllowed: true }; }),
  pullLibrary: vi.fn(async () => [{ id: "cloud", name: "C", description: "", accent: "", artwork: "", tofus: [] }]),
  pushLibrary: (...args: unknown[]) => (pushLibrary as (...a: unknown[]) => Promise<undefined>)(...args),
}));

import { getCloudAccountSettings, pullLibrary } from "../lib/cloud";
import { useCloudSync } from "./useCloudSync";

const user = (id: string) => ({ id }) as never;
const lib = [{ id: "a", name: "A", description: "", accent: "", artwork: "", tofus: [] }] as never;

beforeEach(() => { vi.useFakeTimers(); pushLibrary.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("useCloudSync account switch", () => {
  it("never pushes the previous account's state to the new account while its settings load", async () => {
    const { rerender } = renderHook(({ u }) => useCloudSync(u, lib, vi.fn(), true, "shared"), { initialProps: { u: user("A") } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    pushLibrary.mockClear();
    // Account B signs in; its settings take a long time to arrive.
    let release!: () => void;
    settingsGate = new Promise<void>((resolve) => { release = resolve; });
    rerender({ u: user("B") });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(pushLibrary).not.toHaveBeenCalled();
    release();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    settingsGate = Promise.resolve();
  });
});

describe("useCloudSync initialization recovery", () => {
  it("recovers after the initial library pull fails transiently", async () => {
    const settings = vi.mocked(getCloudAccountSettings);
    const pull = vi.mocked(pullLibrary);
    settings.mockClear();
    pull.mockClear();
    pull.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useCloudSync(user("A"), lib, vi.fn(), true, "shared"));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.syncState).toBe("retrying");
    expect(pull).toHaveBeenCalledTimes(1);

    // Startup failures use backoff; once the transient pull error clears, the
    // next initialization must pull successfully and leave the retrying state.
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(pull).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(pull).toHaveBeenCalledTimes(2);
    expect(result.current.syncState).not.toBe("retrying");
    expect(result.current.syncState).not.toBe("error");
  });
  it("retries initialization after a local library change following a permanent settings error", async () => {
    const settings = vi.mocked(getCloudAccountSettings);
    settings.mockClear();
    settings.mockRejectedValueOnce({
      status: 403,
      code: "42501",
      message: "Cloud sync is not enabled for this account",
    });

    const setLibrary = vi.fn();
    const { result, rerender } = renderHook(
      ({ library }) => useCloudSync(user("A"), library, setLibrary, true, "shared"),
      { initialProps: { library: lib } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.syncState).toBe("error");
    expect(settings).toHaveBeenCalledTimes(1);

    // A user edit is an explicit recovery signal; permanent failures should
    // not spin on a timer, but should not require an app restart either.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(settings).toHaveBeenCalledTimes(1);

    rerender({ library: [{ ...lib[0], name: "Edited locally" }] as never });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(settings).toHaveBeenCalledTimes(2);
    expect(result.current.syncState).not.toBe("error");
  });
});
