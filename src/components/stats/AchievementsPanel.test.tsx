// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AchievementBadge } from "./AchievementsPanel";
import statsCss from "../../styles/features/stats.css?raw";
import steamCss from "../../styles/features/steam-achievements.css?raw";
import { buildFacts, emptyFlags, evaluate } from "../../lib/achievements";

describe("achievements tab performance guards", () => {
  // WebKitGTK paints every node with a CSS filter through its own surface; 40+ locked badges took ~0.7-1.5 s (see docs/improvements/achievements-tab-perf.md).
  it("does not use CSS filters on the repeated achievement rows", () => {
    for (const [file, source] of [["stats.css", statsCss], ["steam-achievements.css", steamCss]] as const) {
      const offenders = source.split("\n").filter((line: string) => /\.(ach|steam-ach)-[a-z-]+/.test(line) && /(^|[\s{;])filter\s*:/.test(line));
      expect(offenders, file).toEqual([]);
    }
  });

  it("memoises badges so filter and tab changes only re-render what changed", () => {
    expect((AchievementBadge as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("renders the full catalogue in a small time budget", () => {
    const progress = evaluate(buildFacts([], [], emptyFlags(), 0));
    const start = performance.now();
    render(<ul>{progress.map((item) => <AchievementBadge key={item.def.id} item={item} />)}</ul>);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
