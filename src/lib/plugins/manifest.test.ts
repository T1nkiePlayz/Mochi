import { describe, expect, it } from "vitest";
import { parseManifest, toEntry } from "./manifest";

const good = { id: "hello", name: "Hello", permissions: ["notify"], commands: [{ id: "hi", title: "Say hi", keywords: ["greet"] }] };

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const result = parseManifest(JSON.stringify(good), "hello");
    expect("manifest" in result && result.manifest.commands[0].title).toBe("Say hi");
  });
  it("rejects bad JSON, a mismatched id, unknown permissions and duplicate commands", () => {
    expect(parseManifest("{", "hello")).toHaveProperty("error");
    expect(parseManifest(JSON.stringify(good), "other")).toHaveProperty("error");
    expect(parseManifest(JSON.stringify({ ...good, permissions: ["fs"] }), "hello")).toHaveProperty("error");
    expect(parseManifest(JSON.stringify({ ...good, commands: [good.commands[0], good.commands[0]] }), "hello")).toHaveProperty("error");
  });
  it("needs main.js when commands are declared", () => {
    expect(toEntry({ dir: "hello", manifest: JSON.stringify(good), script: null }).error).toMatch(/main\.js/);
    expect(toEntry({ dir: "hello", manifest: JSON.stringify(good), script: "1" }).error).toBe("");
  });
});
