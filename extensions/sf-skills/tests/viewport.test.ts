/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the pure scroll math used by the redesigned datatable.
 */
import { describe, expect, it } from "vitest";
import { jumpToEnd, jumpToStart, slice, step, viewportSize } from "../lib/funnel-view/viewport.ts";

describe("viewportSize", () => {
  it("caps at 22 rows on tall terminals", () => {
    expect(viewportSize(80)).toBe(22);
  });

  it("leaves at least 6 rows on tiny terminals", () => {
    expect(viewportSize(8)).toBe(6);
  });

  it("respects a custom cap", () => {
    expect(viewportSize(40, 12)).toBe(12);
  });

  it("scales with terminal height in between", () => {
    expect(viewportSize(24)).toBe(12);
  });
});

describe("slice", () => {
  it("returns the first viewport when cursor=0", () => {
    const r = slice({ cursor: 0, offset: 0 }, 30, 10);
    expect(r.offset).toBe(0);
    expect(r.end).toBe(10);
    expect(r.cursor).toBe(0);
    expect(r.canScrollUp).toBe(false);
    expect(r.canScrollDown).toBe(true);
  });

  it("scrolls down when the cursor goes past the bottom of the viewport", () => {
    const r = slice({ cursor: 12, offset: 0 }, 30, 10);
    // cursor=12 must be visible; viewport=10 → offset=3..end=13.
    expect(r.offset).toBe(3);
    expect(r.end).toBe(13);
    expect(r.canScrollUp).toBe(true);
    expect(r.canScrollDown).toBe(true);
  });

  it("scrolls up when the cursor moves above the offset", () => {
    const r = slice({ cursor: 2, offset: 5 }, 30, 10);
    expect(r.offset).toBe(2);
    expect(r.cursor).toBe(2);
  });

  it("clamps cursor to [0, total-1]", () => {
    expect(slice({ cursor: -3, offset: 0 }, 5, 10).cursor).toBe(0);
    expect(slice({ cursor: 99, offset: 0 }, 5, 10).cursor).toBe(4);
  });

  it("returns canScrollDown=false when the slice reaches the end", () => {
    const r = slice({ cursor: 29, offset: 20 }, 30, 10);
    expect(r.canScrollDown).toBe(false);
  });

  it("handles total < viewport (no scroll, all visible)", () => {
    const r = slice({ cursor: 0, offset: 0 }, 4, 10);
    expect(r.offset).toBe(0);
    expect(r.end).toBe(4);
    expect(r.visibleCount).toBe(4);
    expect(r.canScrollUp).toBe(false);
    expect(r.canScrollDown).toBe(false);
  });

  it("handles total = 0 gracefully", () => {
    const r = slice({ cursor: 0, offset: 0 }, 0, 10);
    expect(r.cursor).toBe(0);
    expect(r.offset).toBe(0);
    expect(r.end).toBe(0);
    expect(r.visibleCount).toBe(0);
  });
});

describe("step", () => {
  it("moves the cursor forward and auto-scrolls when needed", () => {
    const r = step({ cursor: 9, offset: 0 }, +1, 30, 10);
    expect(r.cursor).toBe(10);
    expect(r.offset).toBe(1);
  });

  it("moves the cursor backward and pulls the offset along", () => {
    const r = step({ cursor: 5, offset: 5 }, -1, 30, 10);
    expect(r.cursor).toBe(4);
    expect(r.offset).toBe(4);
  });

  it("jumps a page (delta=10) on PgDn-style input", () => {
    const r = step({ cursor: 0, offset: 0 }, +10, 30, 10);
    expect(r.cursor).toBe(10);
    expect(r.offset).toBe(1);
  });
});

describe("jumpToStart / jumpToEnd", () => {
  it("Home jumps to row 0", () => {
    const r = jumpToStart(30, 10);
    expect(r.cursor).toBe(0);
    expect(r.offset).toBe(0);
  });

  it("End jumps to the last row with the slice anchored to it", () => {
    const r = jumpToEnd(30, 10);
    expect(r.cursor).toBe(29);
    expect(r.end).toBe(30);
    expect(r.offset).toBe(20);
  });

  it("End on an empty table is a no-op", () => {
    const r = jumpToEnd(0, 10);
    expect(r.cursor).toBe(0);
    expect(r.offset).toBe(0);
  });
});
