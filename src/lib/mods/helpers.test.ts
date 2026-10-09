import { describe, expect, it } from "vitest";
import { nexusFileDate } from "./helpers";

describe("nexusFileDate", () => {
  it("turns Nexus unix seconds into ISO text (what records and update checks compare)", () => {
    expect(nexusFileDate(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(nexusFileDate(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });
  it("keeps ISO text and drops unknown dates", () => {
    expect(nexusFileDate("2025-01-02T03:04:05Z")).toBe("2025-01-02T03:04:05.000Z");
    for (const value of [0, undefined, null, "", "yesterday", Number.NaN]) expect(nexusFileDate(value)).toBeUndefined();
  });
});
