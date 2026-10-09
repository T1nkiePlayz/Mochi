// @vitest-environment jsdom
import { memo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../hooks", () => ({ useGameSessions: vi.fn() }));
vi.mock("../components/stats/AchievementWatcher", () => ({ AchievementWatcher: () => null }));
vi.mock("../components/ui/ConfirmHost", () => ({ ConfirmHost: () => null }));
vi.mock("../components/SelfInstallPrompt", () => ({ SelfInstallPrompt: () => null }));

import { AppStoreProvider, shallowEqual, useAppSelector, type AppController } from "./AppContext";

const renders = vi.fn();
const Name = memo(function Name() { const name = useAppSelector((app) => app.account.name); renders(); return <span data-testid="name">{name}</span>; });

let bump: () => void = () => {};
let rename: () => void = () => {};
function Harness() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState("ann");
  bump = () => setCount((value) => value + 1);
  rename = () => setName("bob");
  // Fresh controller object every render, like useAppController.
  const controller = { account: { name }, count } as unknown as AppController;
  return <AppStoreProvider controller={controller}><Name /></AppStoreProvider>;
}

afterEach(() => { cleanup(); renders.mockClear(); });

describe("useAppSelector", () => {
  it("skips re-renders for unrelated changes and updates when the slice changes", () => {
    render(<Harness />);
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => bump());
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => rename());
    expect(screen.getByTestId("name").textContent).toBe("bob");
    expect(renders).toHaveBeenCalledTimes(2);
  });
});

describe("shallowEqual", () => {
  it("compares own enumerable values by identity", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 } as never)).toBe(false);
    expect(shallowEqual(null, { a: 1 })).toBe(false);
  });
});
