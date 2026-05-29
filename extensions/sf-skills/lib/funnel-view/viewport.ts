/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure scroll-math for the /sf-skills datatable.
 *
 * The overlay used to render every row at once; on a 30-skill org the
 * box stretched to fill the screen and Stats vs. Active heights
 * differed by an order of magnitude. This helper computes a fixed
 * viewport so all three tabs render at the same height with a slice
 * + scroll indicator.
 *
 * No I/O. No state. Each public function takes the current
 * (cursor, offset, total, viewport) and returns the next state.
 */

export interface ViewportState {
  /** Index of the highlighted row in the underlying list. */
  cursor: number;
  /** First row visible in the viewport (inclusive). */
  offset: number;
}

export interface SliceResult extends ViewportState {
  /** Last row visible (exclusive). */
  end: number;
  /** Number of rows in the viewport (clamped to total). */
  visibleCount: number;
  /** True when there's content above the slice — show ▲. */
  canScrollUp: boolean;
  /** True when there's content below the slice — show ▼. */
  canScrollDown: boolean;
}

/**
 * Adaptive viewport size: leave headroom for the overlay frame, tabs,
 * status bar, header row, group dividers, and the 3-line details strip.
 *
 * The 12-row reservation matches the redesign mockup: 1 (top border) +
 * 1 (tabs) + 1 (status) + 1 (header sep) + 1 (column header) + 1
 * (header underline) + 3 (details) + 1 (key hints) + 1 (bottom border)
 * + 2 buffer rows. A 22-row cap keeps the table comfortable on tall
 * terminals.
 */
export function viewportSize(terminalRows: number, cap = 22): number {
  const room = Math.max(6, terminalRows - 12);
  return Math.min(cap, room);
}

/**
 * Compute the visible window for the given cursor/offset and total row
 * count. Auto-scrolls so the cursor is always inside the slice.
 */
export function slice(state: ViewportState, total: number, viewport: number): SliceResult {
  const safeViewport = Math.max(1, viewport);
  const clampedCursor = clamp(state.cursor, 0, Math.max(0, total - 1));

  let offset = clamp(state.offset, 0, Math.max(0, total - safeViewport));

  if (clampedCursor < offset) {
    offset = clampedCursor;
  } else if (clampedCursor >= offset + safeViewport) {
    offset = clampedCursor - safeViewport + 1;
  }
  // Final clamp in case the auto-scroll pushed past either edge.
  offset = clamp(offset, 0, Math.max(0, total - safeViewport));

  const end = Math.min(total, offset + safeViewport);
  return {
    cursor: clampedCursor,
    offset,
    end,
    visibleCount: end - offset,
    canScrollUp: offset > 0,
    canScrollDown: end < total,
  };
}

/** Step the cursor by `delta` rows, with auto-scroll. */
export function step(
  state: ViewportState,
  delta: number,
  total: number,
  viewport: number,
): SliceResult {
  return slice({ ...state, cursor: state.cursor + delta }, total, viewport);
}

/** Jump the cursor to the first / last row. */
export function jumpToStart(total: number, viewport: number): SliceResult {
  return slice({ cursor: 0, offset: 0 }, total, viewport);
}

export function jumpToEnd(total: number, viewport: number): SliceResult {
  const lastIdx = Math.max(0, total - 1);
  return slice({ cursor: lastIdx, offset: lastIdx }, total, viewport);
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
