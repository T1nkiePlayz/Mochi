import { describe, expect, it } from "vitest";
import type { Piko } from "../models";
import { librarySignature, playtimeSignature } from "./achievementSignature";

const piko = (over: Partial<Piko> = {}) => ({ id: "a", name: "A", tofus: [{ id: "default", mods: 0 }], ...over }) as unknown as Piko;

describe("achievement signatures", () => {
  it("changes for inputs that feed achievements", () => {
    const base = librarySignature([piko()]);
    expect(librarySignature([piko({ favorite: true })])).not.toBe(base);
    expect(librarySignature([piko({ tags: ["x"] })])).not.toBe(base);
    expect(librarySignature([piko({ tofus: [{ id: "default", mods: 2 }] } as Partial<Piko>)])).not.toBe(base);
    expect(librarySignature([piko(), piko({ id: "b" })])).not.toBe(base);
  });
  it("ignores unrelated edits", () => {
    expect(librarySignature([piko({ name: "Renamed" })])).toBe(librarySignature([piko()]));
  });
  it("rounds playtime to whole minutes", () => {
    const entry = (seconds: number) => [{ gameId: "a", name: "A", seconds, lastPlayed: 0 }];
    expect(playtimeSignature(entry(125))).toBe(playtimeSignature(entry(140)));
    expect(playtimeSignature(entry(125))).not.toBe(playtimeSignature(entry(185)));
  });
});
