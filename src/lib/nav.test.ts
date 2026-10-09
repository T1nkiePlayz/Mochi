import { describe, expect, it } from "vitest";
import { navLabel } from "./nav";

describe("navLabel", () => {
  it("renames the mods page and leaves other pages alone", () => {
    expect(navLabel("Installed")).toBe("Mods & Content");
    expect(navLabel("Library")).toBe("Library");
    expect(navLabel("Downloads")).toBe("Downloads");
  });
});
