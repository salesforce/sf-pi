/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Responsive column layout for the Funnel view.
 *
 * Pi re-calls a component's `render(width)` whenever the terminal resizes, so
 * the funnel adapts purely by computing column widths from the width it is
 * handed each frame — no fixed table size. Fixed columns (glyphs, counts) keep
 * a constant width; flex columns (skill name, source path) absorb all leftover
 * space so wide terminals show full paths and narrow ones truncate gracefully.
 *
 * Pure math + a small render helper. Unit-tested in tests/funnel-layout.test.ts.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface ColumnSpec {
  key: string;
  header: string;
  /** Minimum width in columns. */
  min: number;
  /** Flex weight; 0 (default) = fixed at `min`. Slack is split by weight. */
  weight?: number;
  align?: "left" | "right";
}

export interface LayoutOptions {
  /** Spaces between columns. Default 1. */
  gap?: number;
  /** Leading pad inside the box. Default 1. */
  leftPad?: number;
  /** Trailing gutter reserved at the right (e.g. scroll glyph). Default 2. */
  rightPad?: number;
}

/**
 * Resolve each column to a concrete width for the given inner width.
 *
 * Guarantees: every column is at least 1 wide; the sum of widths + gaps +
 * pads never exceeds `innerWidth`; all slack beyond the minimums goes to
 * weighted columns in proportion to their weight. When space is tight, flex
 * columns shrink first (down to 1), then fixed columns are clamped.
 */
export function fitColumns(
  innerWidth: number,
  specs: ColumnSpec[],
  opts: LayoutOptions = {},
): number[] {
  const gap = opts.gap ?? 1;
  const leftPad = opts.leftPad ?? 1;
  const rightPad = opts.rightPad ?? 2;
  const n = specs.length;
  if (n === 0) return [];

  const avail = Math.max(n, innerWidth - leftPad - rightPad - gap * (n - 1));
  const widths = specs.map((s) => Math.max(1, s.min));
  const minTotal = widths.reduce((a, b) => a + b, 0);

  if (minTotal <= avail) {
    // Distribute slack to weighted columns.
    const slack = avail - minTotal;
    const totalWeight = specs.reduce((a, s) => a + (s.weight ?? 0), 0);
    if (totalWeight > 0 && slack > 0) {
      // Largest-remainder apportionment so widths are integers summing to slack.
      const shares = specs.map((s) => (slack * (s.weight ?? 0)) / totalWeight);
      const floors = shares.map((x) => Math.floor(x));
      let used = floors.reduce((a, b) => a + b, 0);
      const order = shares
        .map((x, i) => ({ i, frac: x - Math.floor(x), w: specs[i].weight ?? 0 }))
        .filter((o) => o.w > 0)
        .sort((a, b) => b.frac - a.frac);
      for (let k = 0; used < slack && order.length > 0; k++) {
        floors[order[k % order.length].i] += 1;
        used += 1;
      }
      for (let i = 0; i < n; i++) widths[i] += floors[i];
    }
    return widths;
  }

  // Too narrow: shrink flex columns toward 1, then fixed columns, proportionally.
  let over = minTotal - avail;
  const shrinkOrder = [
    ...specs.map((s, i) => ({ i, flex: (s.weight ?? 0) > 0 })).filter((o) => o.flex),
    ...specs.map((s, i) => ({ i, flex: (s.weight ?? 0) > 0 })).filter((o) => !o.flex),
  ];
  for (const { i } of shrinkOrder) {
    if (over <= 0) break;
    const room = widths[i] - 1;
    const take = Math.min(room, over);
    widths[i] -= take;
    over -= take;
  }
  return widths;
}

/** A cell to render: pre-colored text is fine — padding uses visibleWidth. */
export interface Cell {
  text: string;
  align?: "left" | "right";
}

/**
 * Render one row: truncate/pad each cell to its column width, join with single
 * spaces, and prepend the left pad. The result's visible width is exactly
 * `leftPad + sum(widths) + gap*(n-1)` so every row aligns under the header and
 * the box edge stays straight.
 */
export function renderColumns(cells: Cell[], widths: number[], opts: LayoutOptions = {}): string {
  const gap = opts.gap ?? 1;
  const leftPad = opts.leftPad ?? 1;
  const out: string[] = [];
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    const cell = cells[i] ?? { text: "" };
    out.push(fitCell(cell.text, w, cell.align ?? "left"));
  }
  return " ".repeat(leftPad) + out.join(" ".repeat(gap));
}

/** Truncate (preserving trailing ellipsis) then pad to width, honoring align. */
export function fitCell(text: string, width: number, align: "left" | "right"): string {
  const truncated = truncateToWidth(text, width, "…");
  const pad = Math.max(0, width - visibleWidth(truncated));
  return align === "right" ? " ".repeat(pad) + truncated : truncated + " ".repeat(pad);
}
