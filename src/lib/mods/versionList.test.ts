import { describe, expect, it } from "vitest";
import { collapseList, filterVersions, listGameVersions, listLoaders, versionFit, type VersionRow } from "./versionList";

const v = (date: string, game: string[], loaders: string[], type: VersionRow["version_type"] = "release"): VersionRow => ({ date_published: date, game_versions: game, loaders, version_type: type });
const rows = [v("2024-01-01", ["1.20.1"], ["forge"]), v("2024-06-01", ["1.21", "1.21.1"], ["fabric", "quilt"]), v("2024-07-01", ["1.21.1"], ["fabric"], "beta")];

describe("version list", () => {
  it("filters by loader, game version and release type, newest first", () => {
    expect(filterVersions(rows, {}, true).map((row) => row.date_published)).toEqual(["2024-07-01", "2024-06-01", "2024-01-01"]);
    expect(filterVersions(rows, { loader: "fabric" }, true)).toHaveLength(2);
    expect(filterVersions(rows, { gameVersion: "1.21.1", channel: "release" }, true)).toHaveLength(1);
  });
  it("lists loaders and game versions for the filter menus", () => {
    expect(listLoaders([...rows, v("2024-01-01", ["1.20"], ["iris", "minecraft"])])).toEqual(["fabric", "forge", "quilt"]);
    expect(listGameVersions(rows)).toEqual(["1.21.1", "1.21", "1.20.1"]);
  });
  it("highlights what fits the Tofu and hides the incompatible when asked", () => {
    const tofu = { loader: "fabric" as const, gameVersion: "1.21.1" };
    expect(versionFit(rows[1], tofu, true).status).toBe("compatible");
    expect(versionFit(rows[0], tofu, true).status).toBe("incompatible");
    expect(filterVersions(rows, { fit: tofu }, true)).toHaveLength(2);
    // shaders ignore the loader
    expect(versionFit(v("2024-01-01", ["1.21.1"], ["iris"]), tofu, false).status).toBe("compatible");
  });
  it("collapses long lists", () => {
    expect(collapseList(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: 2 });
  });
});
