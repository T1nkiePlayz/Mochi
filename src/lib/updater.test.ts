import { describe, expect, it } from "vitest";
import { compareVersions, formatBytes, isNewerVersion, parseGithubRelease, parseVersion } from "./updater";

describe("updater semver", () => {
  it("orders releases and prereleases", () => {
    const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.10.0", "2.0.0"];
    for (let i = 0; i < order.length - 1; i++) expect(compareVersions(order[i]!, order[i + 1]!), `${order[i]} < ${order[i + 1]}`).toBeLessThan(0);
  });
  it("ignores build metadata and a v prefix", () => { expect(compareVersions("v1.2.3+build", "1.2.3")).toBe(0); });
  it("treats garbage as not newer", () => { expect(isNewerVersion("nightly", "1.0.0")).toBe(false); expect(parseVersion("1.2")).toBeNull(); });
  it("parses release payloads defensively", () => {
    expect(parseGithubRelease({ tag_name: "v1.2.3", html_url: "https://github.com/a/b/releases/1", body: "x" })).toMatchObject({ version: "1.2.3", url: "https://github.com/a/b/releases/1" });
    expect(parseGithubRelease({ tag_name: "v1.2.3", html_url: "https://evil.example/x" })!.url).toMatch(/^https:\/\/github\.com\//);
    expect(parseGithubRelease({ tag_name: "v1.2.3", prerelease: true })).toBeNull();
    expect(parseGithubRelease({ tag_name: "latest" })).toBeNull();
    expect(parseGithubRelease(null)).toBeNull();
  });
  it("formatBytes", () => { expect(formatBytes(NaN)).toBe("0 MB"); expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB"); });
});
