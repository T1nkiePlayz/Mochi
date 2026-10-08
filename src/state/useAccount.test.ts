import { describe, expect, it } from "vitest";
import { sanitizeSavedAccounts, usernameOf } from "./useAccount";

describe("saved accounts from storage", () => {
  it("drops malformed entries and shortens e-mail names", () => {
    const out = sanitizeSavedAccounts([null, 1, { id: "a" }, { id: "b", refreshToken: "t", username: "me@x.io", email: "me@x.io" }, { id: "b", refreshToken: "t2" }, { id: "c", refreshToken: "t", username: 5 }]);
    expect(out.map((a) => a.id)).toEqual(["b", "c"]);
    expect(out[0]!.username).toBe("me");
    expect(out[1]!.username).toBe("Account");
    expect(sanitizeSavedAccounts("nope")).toEqual([]);
    expect(sanitizeSavedAccounts(Array.from({ length: 9 }, (_, i) => ({ id: String(i), refreshToken: "t" })))).toHaveLength(5);
  });
  it("usernameOf ignores non-string metadata", () => {
    expect(usernameOf({ user_metadata: { username: { x: 1 }, user_name: "gh" }, email: "a@b" } as never)).toBe("gh");
    expect(usernameOf(null)).toBe("Guest");
  });
});
