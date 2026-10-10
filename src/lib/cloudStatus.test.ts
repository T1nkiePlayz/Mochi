// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudStatusFor, confirmedAfterClear, confirmedAfterPull, confirmedAfterPush, createSyncScheduler, eligibleForPush, isCloudEligible, isRetryableSyncError, loadConfirmedCache, saveConfirmedCache, CLOUD_MAX_PIKOS } from "./cloudStatus";

const p = (id: string, name = id) => ({ id, name });

describe("eligibility and confirmed sets", () => {
  it("skips nameless, idless and duplicate games and caps the list", () => {
    expect(isCloudEligible(p("a", ""))).toBe(false);
    expect(eligibleForPush([p("a"), p("a"), p("b", ""), p("c")]).map((x) => x.id)).toEqual(["a", "c"]);
    expect(eligibleForPush(Array.from({ length: CLOUD_MAX_PIKOS + 5 }, (_, i) => p(`g${i}`)))).toHaveLength(CLOUD_MAX_PIKOS);
  });
  it("derives the set from push, pull and clear", () => {
    expect([...confirmedAfterPush([p("a"), p("b", "")])]).toEqual(["a"]);
    expect([...confirmedAfterPull([{ id: "x" }, { id: "y" }])]).toEqual(["x", "y"]);
    expect(confirmedAfterClear().size).toBe(0);
  });
  it("shows a checkmark only for confirmed games and nothing when sync is off", () => {
    const confirmed = new Set(["a"]);
    expect(cloudStatusFor(p("a"), { enabled: true, confirmed, syncState: "synced" })).toBe("synced");
    expect(cloudStatusFor(p("b"), { enabled: true, confirmed, syncState: "syncing" })).toBe("pending");
    expect(cloudStatusFor(p("b"), { enabled: true, confirmed, syncState: "error" })).toBe("error");
    expect(cloudStatusFor(p("a"), { enabled: true, confirmed: confirmedAfterClear(), syncState: "empty" })).toBe("pending");
    expect(cloudStatusFor(p("a"), { enabled: false, confirmed, syncState: "offline" })).toBe("none");
    expect(cloudStatusFor(p("z", ""), { enabled: true, confirmed, syncState: "synced" })).toBe("none");
  });
  it("classifies Supabase/PostgREST errors using HTTP status, SQLSTATE and message", () => {
    expect(isRetryableSyncError({
      status: 403,
      code: "42501",
      message: 'new row violates row-level security policy for table "tofus"',
      details: null,
      hint: null,
    })).toBe(false);
    expect(isRetryableSyncError({
      status: 400,
      code: "23514",
      message: 'new row violates check constraint "pikos_source_id_check"',
    })).toBe(false);
    expect(isRetryableSyncError({ status: 401, code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isRetryableSyncError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isRetryableSyncError({ status: 408, code: "PGRST000", message: "Request timed out" })).toBe(true);
    expect(isRetryableSyncError({ status: 429, code: "PGRST003", message: "Too many requests" })).toBe(true);
    expect(isRetryableSyncError({ status: 503, code: "PGRST000", message: "Service unavailable" })).toBe(true);
    expect(isRetryableSyncError({ code: "40001", message: "serialization failure" })).toBe(true);
    expect(isRetryableSyncError({ message: "new row violates row-level security policy" })).toBe(false);
    expect(isRetryableSyncError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableSyncError({ name: "FunctionsFetchError", message: "Failed to send a request" })).toBe(true);
  });
  it("round-trips the per-user cache", () => {
    saveConfirmedCache("u1", new Set(["a", "b"]));
    expect([...loadConfirmedCache("u1")]).toEqual(["a", "b"]);
    expect(loadConfirmedCache("u2").size).toBe(0);
  });
});

describe("createSyncScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces a burst into one run", async () => {
    const run = vi.fn(async () => {});
    const s = createSyncScheduler(run, { debounceMs: 1000, maxWaitMs: 5000 });
    s.notify(); await vi.advanceTimersByTimeAsync(500); s.notify(); await vi.advanceTimersByTimeAsync(900);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("still runs during a continuous stream of changes (max wait)", async () => {
    const run = vi.fn(async () => {});
    const s = createSyncScheduler(run, { debounceMs: 1000, maxWaitMs: 5000 });
    for (let i = 0; i < 30; i++) { s.notify(); await vi.advanceTimersByTimeAsync(400); }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("retries with exponential backoff and stops after success", async () => {
    let fails = 2;
    const run = vi.fn(async () => { if (fails-- > 0) throw new Error("x"); });
    const s = createSyncScheduler(run, { debounceMs: 100, maxWaitMs: 1000, retryBaseMs: 1000, retryMaxMs: 8000 });
    s.notify(); await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(3);
  });
  it("does not schedule repeated retries for permanent client errors", async () => {
    const run = vi.fn(async () => { throw { status: 403, code: "42501", message: 'new row violates row-level security policy for table "tofus"' }; });
    const s = createSyncScheduler(run, { debounceMs: 100, retryBaseMs: 1000, shouldRetry: isRetryableSyncError });
    s.notify(); await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("continues retrying transient fetch failures with backoff", async () => {
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new TypeError("Failed to fetch");
      fail = false;
    });
    const s = createSyncScheduler(run, { debounceMs: 100, retryBaseMs: 1000, shouldRetry: isRetryableSyncError });
    s.notify(); await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("never overlaps runs and re-runs for changes made mid-flight; cancel stops everything", async () => {
    let release!: () => void; let active = 0; let maxActive = 0;
    const run = vi.fn(() => { active++; maxActive = Math.max(maxActive, active); return new Promise<void>((r) => { release = () => { active--; r(); }; }); });
    const s = createSyncScheduler(run, { debounceMs: 100, maxWaitMs: 1000 });
    s.notify(); await vi.advanceTimersByTimeAsync(100);
    s.notify(); await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
    release(); await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    s.cancel(); release(); s.notify(); await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2); expect(maxActive).toBe(1);
  });
});
