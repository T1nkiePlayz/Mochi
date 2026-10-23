import { describe, expect, it } from "vitest";
import { checkSourceHealth, healthAlerts } from "./sourceHealth";
import type { SourceHealth } from "./sources";

const health = (id: string, status: SourceHealth["status"], gameCount = 0, filesExamined = 1): SourceHealth => ({ id: id as SourceHealth["id"], name: id, status, filesExamined, failures: [], gameCount });

describe("source health alerts", () => {
  it("flags parse errors, partial reads and games that vanished while files remain", () => {
    const report = [health("steam", "ok", 3), health("heroic", "parse_error"), health("itch", "partial", 1), health("lutris", "empty"), health("gog", "not_installed", 0, 0)];
    expect(healthAlerts(report, { lutris: 4 }).map((item) => item.id)).toEqual(["heroic", "itch", "lutris"]);
    expect(healthAlerts(report, {}).map((item) => item.id)).toEqual(["heroic", "itch"]);
  });
  it("keeps the last good count through a broken scan", () => {
    let saved: Record<string, number> = { heroic: 5 };
    const store = { read: () => saved, write: (counts: Record<string, number>) => { saved = counts; } };
    checkSourceHealth([health("heroic", "parse_error")], store);
    expect(saved.heroic).toBe(5);
    expect(checkSourceHealth([health("heroic", "empty")], store).map((item) => item.id)).toEqual(["heroic"]);
  });
});
