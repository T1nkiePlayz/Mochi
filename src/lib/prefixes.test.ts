import { describe, expect, it } from "vitest";
import { describePrefix, prefixKindLabel, type PrefixInfo } from "./prefixes";

const info = (change: Partial<PrefixInfo>): PrefixInfo => ({ path: "/p", exists: true, kind: "wine", hasBackup: false, supported: true, hasWinetricks: true, busy: false, verbs: [], ...change });

describe("describePrefix", () => {
  it("explains a prefix that does not exist yet", () => {
    expect(describePrefix(info({ exists: false, kind: "none" }))).toContain("first time");
  });
  it("names the kind and the size", () => {
    expect(describePrefix(info({}), 2_500_000_000)).toBe("Wine prefix · 2.5 GB");
    expect(describePrefix(info({ kind: "proton" }), 412_000_000)).toBe("Proton prefix · 412 MB");
    expect(describePrefix(info({ kind: "proton" }))).toBe("Proton prefix");
  });
  it("labels every kind", () => {
    expect(prefixKindLabel("unknown")).toMatch(/unrecognised/);
  });
});
