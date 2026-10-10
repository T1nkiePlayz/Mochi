import { describe, expect, it } from "vitest";
import { launchHints, modUpdateHint, quickExits } from "./launchHints";
import { buildDiagnostics, redact } from "./diagnostics";

describe("launchHints", () => {
  it("matches known causes and falls back when the output is not captured", () => {
    expect(launchHints("./game: error while loading shared libraries: libfoo.so", "linux")[0]).toMatch(/library/);
    expect(launchHints(null, "linux")[0]).toMatch(/cannot see/);
    expect(launchHints("all fine", "linux")[0]).toMatch(/No known cause/);
  });
  it("finds sessions that ended quickly", () => {
    const previous = new Map([["a", 100], ["b", 50]]);
    expect(quickExits(previous, new Set(), 105)).toEqual(["a"]);
    expect(quickExits(previous, new Set(["a"]), 105)).toEqual([]);
  });
});

describe("modUpdateHint", () => {
  it("points at a recent update snapshot only", () => {
    const now = Date.parse("2026-05-01T12:00:00Z");
    expect(modUpdateHint([{ createdAt: now / 1000 - 3600, reason: "Before updating 3 mods", isRestore: false }], now)).toMatch(/updated 1 hour ago/);
    expect(modUpdateHint([{ createdAt: now / 1000 - 3 * 86400, reason: "Before updating 3 mods", isRestore: false }], now)).toBeNull();
    expect(modUpdateHint([{ createdAt: now / 1000 - 60, reason: "Manual snapshot", isRestore: false }], now)).toBeNull();
  });
});

describe("diagnostics", () => {
  it("redacts user names, emails and tokens", () => {
    const out = redact("/home/ashton/x a@b.com api_key=abc123 ghp_abcdefghijklmnopqrstuv");
    expect(out).not.toMatch(/ashton|a@b\.com|abc123|ghp_/);
  });
  it("builds a report", () => {
    const text = buildDiagnostics({ version: "1.0", platform: { platform: "linux", displayName: "Linux", isSteamDeck: false, isGamescope: false, launchMethods: ["file"] }, userAgent: "ua", online: true, gameCount: 2, gamesBySource: { game: 2 }, experimental: [], signedIn: false });
    expect(text).toContain("Version: 1.0");
  });
});
