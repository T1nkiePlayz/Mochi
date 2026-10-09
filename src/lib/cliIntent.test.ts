import { describe, expect, it } from "vitest";
import { cleanQuery, parseCliPayload, parseCliUrl, resolveGame } from "./cliIntent";

const library = [{ id: "1", name: "Celeste" }, { id: "celeste-2", name: "Celeste Classic" }, { id: "3", name: "Hollow Knight" }, { id: "4", name: "Knight Club" }, { id: "5", name: "Hades" }];

describe("parseCliUrl", () => {
  it("reads launch and open links", () => {
    expect(parseCliUrl("mochi://launch/abc-123")).toEqual({ kind: "launch", query: "abc-123" });
    expect(parseCliUrl("mochi://launch/Hollow%20Knight/")).toEqual({ kind: "launch", query: "Hollow Knight" });
    expect(parseCliUrl("MOCHI://Open/Celeste?x=1#y")).toEqual({ kind: "open", query: "Celeste" });
  });
  it("ignores other verbs and bad queries", () => {
    for (const url of ["mochi://run/calc", "mochi://auth/callback", "mochi://bigpicture", "mochi://launch", "mochi://launch/", "mochi://launch/%zz", "mochi://launch/a%00b", "mochi://launch/a%0Ab", "https://launch/x", "mochi://launch/" + "a".repeat(201)]) expect(parseCliUrl(url), url).toBeNull();
  });
});

describe("cleanQuery / parseCliPayload", () => {
  it("bounds the query", () => {
    expect(cleanQuery("  hi ")).toBe("hi");
    expect(cleanQuery("")).toBeNull();
    expect(cleanQuery(5)).toBeNull();
    expect(cleanQuery("a\nb")).toBeNull();
  });
  it("validates native payloads", () => {
    expect(parseCliPayload({ kind: "launch", query: "x" })).toEqual({ kind: "launch", query: "x" });
    expect(parseCliPayload({ kind: "exec", query: "x" })).toBeNull();
    expect(parseCliPayload({ kind: "open" })).toBeNull();
    expect(parseCliPayload(null)).toBeNull();
  });
});

describe("resolveGame", () => {
  it("prefers exact id, exact name, prefix, then substring", () => {
    expect(resolveGame(library, "celeste-2")).toEqual({ status: "one", game: library[1] });
    expect(resolveGame(library, "celeste")).toEqual({ status: "one", game: library[0] });
    expect(resolveGame(library, "HADES")).toEqual({ status: "one", game: library[4] });
    expect(resolveGame(library, "hol")).toEqual({ status: "one", game: library[2] });
    expect(resolveGame(library, "knight")).toEqual({ status: "one", game: library[3] });
  });
  it("reports ambiguity and misses", () => {
    expect(resolveGame(library, "cel")).toEqual({ status: "many", matches: [library[0], library[1]] });
    expect(resolveGame(library, "night")).toEqual({ status: "many", matches: [library[2], library[3]] });
    expect(resolveGame(library, "zelda")).toEqual({ status: "none" });
    expect(resolveGame(library, " ")).toEqual({ status: "none" });
  });
  it("caps the chooser list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `Game ${i}` }));
    const result = resolveGame(many, "game");
    expect(result.status === "many" && result.matches.length).toBe(12);
  });
});
