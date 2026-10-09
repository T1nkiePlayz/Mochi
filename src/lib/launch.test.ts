import { describe, expect, it } from "vitest";
import { buildLaunchConfig, defaultLaunchConfig, formatArgs, hasLaunchOptions, parseArgs, parseEnv, runtimeIdOf } from "./launch";
import { addEnvRow, duplicateEnvNames, envNameError, removeEnvRow, setEnvRow, updateLaunchOptions } from "./launchOptionsState";
import type { LaunchOptions } from "../models";

describe("launch parsing", () => {
  it("splits quoted arguments", () => { expect(parseArgs(`--a "b c" 'd e' ""`)).toEqual(["--a", "b c", "d e", ""]); });
  it("handles escapes like a shell", () => {
    expect(parseArgs(String.raw`a\ b "c\"d" 'e\f' "g\h" i\\j`)).toEqual(["a b", 'c"d', String.raw`e\f`, String.raw`g\h`, String.raw`i\j`]);
    expect(parseArgs(`  a   b\t c  `)).toEqual(["a", "b", "c"]);
    expect(parseArgs(`--x="a b"`)).toEqual(["--x=a b"]);
    expect(parseArgs(`unterminated "quote`)).toEqual(["unterminated", "quote"]);
    expect(parseArgs("")).toEqual([]);
  });
  it("never expands shell syntax", () => { expect(parseArgs("$(rm -rf ~) `id` ; | &&")).toEqual(["$(rm", "-rf", "~)", "`id`", ";", "|", "&&"]); });
  it("round-trips through formatArgs", () => {
    for (const args of [["a", "b c", ""], ["it's", 'say "hi"', "$HOME", String.raw`back\slash`], []]) expect(parseArgs(formatArgs(args))).toEqual(args);
  });
  it("parses env lines and cannot poison the prototype", () => {
    const env = parseEnv("A=1\n# c\nbad line\n__proto__=x\r\nB=two=2");
    expect(env.A).toBe("1");
    expect(env.B).toBe("two=2");
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Object.keys(env)).toContain("__proto__");
    expect(({} as Record<string, string>).x).toBeUndefined();
  });
});

describe("buildLaunchConfig", () => {
  const options: LaunchOptions = { env: [["A", "1"], ["B", "piko"]], args: ["-x"], workingDir: "/piko", runtime: { kind: "proton", id: "proton:/p/proton" }, gamemode: true, gamescope: { enabled: true, args: ["-f"] } };
  it("works without options", () => {
    expect(buildLaunchConfig(undefined)).toEqual({ runtime: null, wrappers: [], args: [], env: {}, workingDir: null, gamescope: { enabled: false, args: [] } });
  });
  it("uses the Piko options", () => {
    const config = buildLaunchConfig(undefined, options);
    expect(config).toMatchObject({ runtime: "proton:/p/proton", wrappers: ["gamemoderun"], args: ["-x"], env: { A: "1", B: "piko" }, workingDir: "/piko", gamescope: { enabled: true, args: ["-f"] } });
  });
  it("lets the Tofu override piko -> tofu", () => {
    const tofu = { ...defaultLaunchConfig(), runtime: "wine", wrappers: ["mangohud"], args: "-y", env: "B=tofu\nC=3", workingDir: "/tofu" };
    expect(buildLaunchConfig(tofu, options)).toMatchObject({ runtime: "wine", wrappers: ["mangohud", "gamemoderun"], args: ["-y"], env: { A: "1", B: "tofu", C: "3" }, workingDir: "/tofu" });
    expect(buildLaunchConfig(defaultLaunchConfig(), options).args).toEqual(["-x"]);
  });
  it("passes invalid names through for the launcher to reject and skips blank rows", () => {
    expect(buildLaunchConfig(undefined, { env: [["", ""], ["1BAD", "x"], [" OK ", "v"]], args: [] }).env).toEqual({ "1BAD": "x", OK: "v" });
  });
  it("maps runtime choices", () => {
    expect(runtimeIdOf(undefined)).toBeUndefined();
    expect(runtimeIdOf({ kind: "native" })).toBeUndefined();
    expect(runtimeIdOf({ kind: "wine" })).toBe("wine");
    expect(runtimeIdOf({ kind: "proton", id: "proton:/x" })).toBe("proton:/x");
  });
});

describe("launch options editor state", () => {
  it("stores nothing for an untouched set", () => {
    expect(hasLaunchOptions(undefined)).toBe(false);
    expect(updateLaunchOptions(undefined, { env: [], args: [] })).toBeUndefined();
    expect(updateLaunchOptions(undefined, { runtime: { kind: "native" }, workingDir: "", gamemode: false })).toBeUndefined();
  });
  it("keeps what the user set and drops what they cleared", () => {
    const set = updateLaunchOptions(undefined, { gamemode: true, args: ["-a"] });
    expect(set).toEqual({ env: [], args: ["-a"], gamemode: true });
    expect(updateLaunchOptions(set, { gamemode: false, args: [] })).toBeUndefined();
    expect(updateLaunchOptions(undefined, { gamescope: { enabled: false, args: [] } })).toBeUndefined();
    expect(updateLaunchOptions(undefined, { gamescope: { enabled: true, args: [] } })?.gamescope?.enabled).toBe(true);
  });
  it("edits env rows", () => {
    let env = addEnvRow([]);
    env = setEnvRow(env, 0, ["A", "1"]);
    env = addEnvRow(env);
    expect(env).toEqual([["A", "1"], ["", ""]]);
    expect(removeEnvRow(env, 0)).toEqual([["", ""]]);
    expect(updateLaunchOptions(undefined, { env: [["", ""]] })).toBeDefined();
  });
  it("validates names inline and finds duplicates", () => {
    expect(envNameError("GOOD_1")).toBeNull();
    expect(envNameError("")).toBeNull();
    expect(envNameError("1bad")).not.toBeNull();
    expect(envNameError("a-b")).not.toBeNull();
    expect(duplicateEnvNames([["A", "1"], [" A ", "2"], ["B", "3"]])).toEqual(new Set(["A"]));
  });
});
