import { describe, expect, it } from "vitest";
import { cleanLink, cleanLinks, withCleanNotes, NOTES_MAX, LINKS_MAX } from "./gameNotes";

describe("game notes", () => {
  it("keeps only http(s) links and labels them by host when unnamed", () => {
    expect(cleanLink({ label: " Guide ", url: "https://example.com/a" })).toEqual({ label: "Guide", url: "https://example.com/a" });
    expect(cleanLink({ url: "http://example.com" })?.label).toBe("example.com");
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url", 5]) expect(cleanLink({ label: "x", url })).toBeNull();
  });
  it("caps the number of links and ignores junk", () => {
    expect(cleanLinks("nope")).toEqual([]);
    expect(cleanLinks(Array.from({ length: LINKS_MAX + 5 }, (_v, i) => ({ url: `https://e.com/${i}` })))).toHaveLength(LINKS_MAX);
  });
  it("trims notes, drops empty values and caps the length", () => {
    expect(withCleanNotes({ id: "a", notes: "   ", links: [] })).toEqual({ id: "a" });
    expect(withCleanNotes({ notes: "x".repeat(NOTES_MAX + 10) }).notes).toHaveLength(NOTES_MAX);
  });
});
