// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), convertFileSrc: (path: string) => path }));

import { SourceGamePicker, type PickerSelection } from "./SourceGamePicker";

const game = { id: "prism:A", name: "Pack A", source: "prism", launchTarget: "mc-instance://prism/A", installPath: "/p/A", minecraft: { version: "1.21", loader: "fabric", gameDir: "/p/A/minecraft" } };

describe("Minecraft import mode in the picker", () => {
  it("defaults to copy and reports the chosen mode with the selection", async () => {
    const seen: PickerSelection[] = [];
    render(<SourceGamePicker sources={[{ id: "prism", name: "Minecraft instances", description: "", detected: true, gameCount: 1 }]} scan={async () => [game]} onSelectionChange={(selection) => seen.push(selection)} />);
    const copy = await screen.findByRole("radio", { name: /Copy instances/ });
    expect((copy as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ minecraftMode: "copy", games: [{ id: "prism:A" }] }));
    fireEvent.click(screen.getByRole("radio", { name: /in place/ }));
    await waitFor(() => expect(seen.at(-1)?.minecraftMode).toBe("in-place"));
  });
});
