/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Responsive column-layout tests. Pi hands render(width) the live width and
 * re-calls on resize; these pin that flex columns absorb slack on wide
 * terminals and shrink (not overflow) on narrow ones.
 */
import { describe, expect, it } from "vitest";
import { fitCell, fitColumns, renderColumns, type ColumnSpec } from "../lib/funnel-view/layout.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const specs: ColumnSpec[] = [
  { key: "cur", header: "", min: 2 },
  { key: "name", header: "Skill", min: 22, weight: 3 },
  { key: "source", header: "Source", min: 18, weight: 4 },
  { key: "funnel", header: "Funnel", min: 9 },
  { key: "used", header: "Used", min: 5, align: "right" },
];

const OPTS = { gap: 1, leftPad: 1, rightPad: 2 };

function totalWidth(widths: number[]): number {
  // leftPad(1) + sum + gaps(n-1) + rightPad(2)
  return 1 + widths.reduce((a, b) => a + b, 0) + (widths.length - 1) + 2;
}

describe("fitColumns", () => {
  it("gives flex columns all the slack on a wide terminal", () => {
    const wide = fitColumns(160, specs, OPTS);
    // Fixed columns stay at their min.
    expect(wide[0]).toBe(2);
    expect(wide[3]).toBe(9);
    expect(wide[4]).toBe(5);
    // Flex columns grew well beyond their mins.
    expect(wide[1]).toBeGreaterThan(22);
    expect(wide[2]).toBeGreaterThan(18);
    // Source (weight 4) got more than Skill (weight 3).
    expect(wide[2]).toBeGreaterThan(wide[1]);
    // Never exceeds the inner width.
    expect(totalWidth(wide)).toBeLessThanOrEqual(160);
  });

  it("keeps mins on a snug terminal and never overflows", () => {
    const snug = fitColumns(84, specs, OPTS);
    expect(totalWidth(snug)).toBeLessThanOrEqual(84);
    for (let i = 0; i < specs.length; i++) expect(snug[i]).toBeGreaterThanOrEqual(1);
  });

  it("shrinks flex columns first when too narrow to overflow", () => {
    const tiny = fitColumns(50, specs, OPTS);
    expect(totalWidth(tiny)).toBeLessThanOrEqual(50);
    // Fixed glyph/used columns are preserved before flex columns hit 1.
    expect(tiny[0]).toBe(2);
    expect(tiny[3]).toBeGreaterThanOrEqual(1);
  });

  it("apportions integer widths that exactly consume the slack", () => {
    const widths = fitColumns(120, specs, OPTS);
    expect(totalWidth(widths)).toBe(120);
  });
});

describe("renderColumns + fitCell", () => {
  it("produces a row whose visible width matches the layout", () => {
    const widths = fitColumns(120, specs, OPTS);
    const row = renderColumns(
      [
        { text: "▸" },
        { text: "generating-apex" },
        { text: "~/.claude/skills/generating-apex/SKILL.md" },
        { text: "✓loaded" },
        { text: "42", align: "right" },
      ],
      widths,
      OPTS,
    );
    // leftPad + sum + gaps (no rightPad in the string itself).
    const expected = 1 + widths.reduce((a, b) => a + b, 0) + (widths.length - 1);
    expect(visibleWidth(row)).toBe(expected);
  });

  it("right-aligns and truncates with an ellipsis", () => {
    expect(fitCell("42", 5, "right")).toBe("   42");
    const truncated = fitCell("supercalifragilistic", 8, "left");
    expect(visibleWidth(truncated)).toBe(8);
    expect(truncated).toContain("…");
    expect(truncated.replace(/\u001b\[[0-9;]*m/g, "")).toBe("superca…");
  });
});
