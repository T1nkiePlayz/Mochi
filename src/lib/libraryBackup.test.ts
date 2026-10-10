import { describe, expect, it } from "vitest";
import { backupDue, buildBackup, collectBackupData, defaultSchedule, isBackupKey, parseBackup, sanitizeSchedule } from "./libraryBackup";

const memory = (entries: Record<string, string>) => { const keys = Object.keys(entries); return { length: keys.length, key: (index: number) => keys[index] ?? null, getItem: (key: string) => entries[key] ?? null }; };

describe("library backup", () => {
  it("only collects library keys, never accounts or tokens", () => {
    const data = collectBackupData(memory({ "mochi:pikos": "[{\"id\":\"a\"}]", "mochi:accounts": "[1]", "mochi:profile:u1:pikos": "[]", "sb-token": "{}", "mochi:collections": "not json" }));
    expect(Object.keys(data).sort()).toEqual(["mochi:pikos", "mochi:profile:u1:pikos"]);
    expect(isBackupKey("mochi:settings")).toBe(false);
  });
  it("round-trips and rejects foreign or damaged files", () => {
    const text = JSON.stringify(buildBackup({ "mochi:pikos": [{ id: "a", name: "A", tofus: [] }], "mochi:accounts": [1] }, "1.0", 5));
    const { file, summary } = parseBackup(text);
    expect(Object.keys(file.data)).toEqual(["mochi:pikos"]);
    expect(summary.games).toBe(1);
    expect(() => parseBackup("{}")).toThrow(/not a Mochi backup/);
    expect(() => parseBackup("nope")).toThrow(/not a Mochi backup/);
    expect(() => parseBackup(JSON.stringify({ ...buildBackup({ "mochi:pikos": "x" }, "1"), version: 9 }))).toThrow(/newer/);
  });
  it("schedules by days and needs a folder", () => {
    expect(sanitizeSchedule({ enabled: true })).toEqual({ ...defaultSchedule, enabled: false });
    const on = sanitizeSchedule({ enabled: true, folder: "/b", everyDays: 1, lastAt: 0 });
    expect(backupDue(on, 86_400_000)).toBe(true);
    expect(backupDue({ ...on, lastAt: 1000 }, 2000)).toBe(false);
  });
});
