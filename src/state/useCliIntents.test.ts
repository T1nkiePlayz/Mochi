// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Piko } from "../models";
import { useCliIntents } from "./useCliIntents";

const game = (id: string, name: string) => ({ id, name }) as Piko;
const library = [game("a", "Alpha"), game("b", "Alpine"), game("c", "Zed")];

function setup(ready = true) {
  const handlers = { launch: vi.fn(), open: vi.fn(), report: vi.fn() };
  const view = renderHook((props: { ready: boolean }) => useCliIntents({ ready: props.ready, library, ...handlers }), { initialProps: { ready } });
  return { ...view, ...handlers };
}

describe("useCliIntents", () => {
  it("launches a single match and opens without launching", () => {
    const { result, launch, open } = setup();
    act(() => result.current.handle({ kind: "launch", query: "zed" }));
    expect(launch).toHaveBeenCalledWith(library[2]);
    act(() => result.current.handle({ kind: "open", query: "c" }));
    expect(open).toHaveBeenCalledWith(library[2]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("reports a game that is not in the library and never launches", () => {
    const { result, launch, report } = setup();
    act(() => result.current.handle({ kind: "launch", query: "nope" }));
    expect(report).toHaveBeenCalledWith('No game in your Mochi library matches "nope".');
    expect(launch).not.toHaveBeenCalled();
  });

  it("asks which game when several match, then acts on the pick", () => {
    const { result, launch } = setup();
    act(() => result.current.handle({ kind: "launch", query: "al" }));
    expect(result.current.choice?.matches).toEqual([library[0], library[1]]);
    expect(launch).not.toHaveBeenCalled();
    act(() => result.current.pick(library[1]!));
    expect(launch).toHaveBeenCalledWith(library[1]);
    expect(result.current.choice).toBeNull();
  });

  it("waits for the library to load", () => {
    const { result, rerender, launch } = setup(false);
    act(() => result.current.handle({ kind: "launch", query: "zed" }));
    expect(launch).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(launch).toHaveBeenCalledWith(library[2]);
  });
});
