import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCommands, commandsVersion, getCommand, listCommands, register, subscribeCommands, type CommandContext } from "./commands";

const context = {} as CommandContext;
beforeEach(() => clearCommands());

describe("command registry", () => {
  it("registers, lists in order and replaces by id", () => {
    register("a", "Alpha", [], "Help", () => undefined);
    register("b", "Beta", ["x"], "Help", () => undefined);
    register("a", "Alpha 2", [], "Help", () => undefined);
    expect(listCommands(context).map((c) => c.title)).toEqual(["Alpha 2", "Beta"]);
    expect(getCommand("b")?.keywords).toEqual(["x"]);
  });
  it("unregister removes only its own registration", () => {
    const off = register("a", "Old", [], "Help", () => undefined);
    register("a", "New", [], "Help", () => undefined);
    off();
    expect(getCommand("a")?.title).toBe("New");
  });
  it("hides commands whose `when` is false or throws", () => {
    register("on", "On", [], "Help", () => undefined, () => true);
    register("off", "Off", [], "Help", () => undefined, () => false);
    register("bad", "Bad", [], "Help", () => undefined, () => { throw new Error("x"); });
    expect(listCommands(context).map((c) => c.id)).toEqual(["on"]);
  });
  it("notifies subscribers and bumps the version", () => {
    const listener = vi.fn(); const stop = subscribeCommands(listener); const before = commandsVersion();
    const off = register("a", "A", [], "Help", () => undefined); off(); stop(); register("b", "B", [], "Help", () => undefined);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(commandsVersion()).toBeGreaterThan(before);
  });
  it("runs with the context", async () => {
    const run = vi.fn(); register("a", "A", [], "Help", run);
    await getCommand("a")!.run(context);
    expect(run).toHaveBeenCalledWith(context);
  });
});
