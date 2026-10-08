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
