import { describe, expect, it } from "vitest";
import { appendLog, handoffHelp } from "./gameLogs";

describe("game log buffer", () => {
  it("appends continuations and restarts on reset or a cut start", () => {
    expect(appendLog("a\n", { text: "b\n", reset: false, cutStart: false })).toBe("a\nb\n");
    expect(appendLog("old", { text: "new", reset: true, cutStart: false })).toBe("new");
    expect(appendLog("old", { text: "tail", reset: false, cutStart: true })).toBe("tail");
  });
  it("keeps only the newest characters", () => {
    expect(appendLog("1234", { text: "5678", reset: false, cutStart: false }, 6)).toBe("345678");
  });
  it("explains hand-offs per platform", () => {
    expect(handoffHelp("macos")).toContain("Console");
    expect(handoffHelp("linux")).toContain("PROTON_LOG");
  });
});
