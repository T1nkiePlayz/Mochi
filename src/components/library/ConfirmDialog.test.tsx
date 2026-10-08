// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("does not pull focus back to Cancel when the parent re-renders with a new callback", () => {
    const { rerender } = render(<ConfirmDialog title="t" message="m" confirmLabel="Delete" onConfirm={() => undefined} onCancel={() => undefined} />);
    const confirm = screen.getByRole("button", { name: "Delete" });
    confirm.focus();
    rerender(<ConfirmDialog title="t" message="m" confirmLabel="Delete" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(document.activeElement).toBe(confirm);
  });
  it("Escape cancels with the latest handler", () => {
    const first = vi.fn(); const second = vi.fn();
    const { rerender } = render(<ConfirmDialog title="t" message="m" confirmLabel="x" onConfirm={() => undefined} onCancel={first} />);
    rerender(<ConfirmDialog title="t" message="m" confirmLabel="x" onConfirm={() => undefined} onCancel={second} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});
