import { describe, expect, it } from "vitest";
import { parseArgs, parseEnv } from "./launch";

describe("launch parsing", () => {
  it("splits quoted arguments", () => { expect(parseArgs(`--a "b c" 'd e' ""`)).toEqual(["--a", "b c", "d e", ""]); });
  it("parses env lines and cannot poison the prototype", () => {
    const env = parseEnv("A=1\n# c\nbad line\n__proto__=x\r\nB=two=2");
    expect(env.A).toBe("1");
    expect(env.B).toBe("two=2");
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Object.keys(env)).toContain("__proto__");
    expect(({} as Record<string, string>).x).toBeUndefined();
  });
});
