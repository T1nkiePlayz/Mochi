// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Piko } from "../../models";

const artworkRenders = vi.fn();
vi.mock("../GameArtwork", () => ({ GameArtwork: () => { artworkRenders(); return null; } }));

import { GameCard } from "./GameCard";

const game = (id: string): Piko => ({ id, name: `Game ${id}`, description: "", accent: "#fff", artwork: "", tofus: [] });
const games = ["a", "b", "c"].map(game);
const handlers = { onOpen: vi.fn(), onToggleFavorite: vi.fn(), onToggleChecked: vi.fn(), onMenu: vi.fn() };

function Grid() {
  const [selected, setSelected] = useState("a");
  return <>
    <button onClick={() => setSelected("b")}>select b</button>
    {games.map((piko) => <GameCard key={piko.id} piko={piko} selected={selected === piko.id} running={false} synced selecting={false} checked={false} {...handlers} />)}
  </>;
}

afterEach(() => { cleanup(); artworkRenders.mockClear(); Object.values(handlers).forEach((fn) => fn.mockClear()); });

describe("GameCard", () => {
  it("re-renders only the cards whose props changed", () => {
    render(<Grid />);
    expect(artworkRenders).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByText("select b"));
    // a loses and b gains the selected state; c is untouched.
    expect(artworkRenders).toHaveBeenCalledTimes(5);
  });
  it("passes the game to the shared handlers", () => {
    render(<Grid />);
    fireEvent.click(screen.getByLabelText("Add Game b to favourites"));
    expect(handlers.onToggleFavorite).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByText("Game c"));
    expect(handlers.onOpen).toHaveBeenCalledWith(games[2]);
  });
});
