// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hasPin, removePin, setPin, verifyPin } from "./accountPin";

describe("account pins", () => {
  beforeEach(() => localStorage.clear());
  it("stores only a salted hash and verifies the right PIN", async () => {
    await setPin("u1", "1234");
    expect(hasPin("u1")).toBe(true);
    expect(localStorage.getItem("mochi:account-pins")).not.toContain("1234");
    expect(await verifyPin("u1", "1234")).toBe(true);
    expect(await verifyPin("u1", "4321")).toBe(false);
  });
  it("rejects bad PINs, treats accounts without a PIN as open, and can remove a PIN", async () => {
    await expect(setPin("u1", "12")).rejects.toThrow();
    expect(await verifyPin("none", "0000")).toBe(true);
    await setPin("u2", "55555");
    removePin("u2");
    expect(hasPin("u2")).toBe(false);
  });
});
