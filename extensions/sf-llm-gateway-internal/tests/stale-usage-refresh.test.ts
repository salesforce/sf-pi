/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import {
  createStaleUsageRefreshState,
  maybeAutoRefreshStaleUsage,
  shouldAutoRefreshStaleUsage,
} from "../lib/stale-usage-refresh.ts";

const knownUsage = {
  spend: 1332,
  maxBudget: Number.POSITIVE_INFINITY,
  remaining: Number.POSITIVE_INFINITY,
  budgetResetAt: "",
  budgetDuration: "month",
  fetchedAt: "2026-07-12T16:00:00.000Z",
};

const freshUsage = { ...knownUsage, spend: 1333 };

const staleState = {
  monthlyUsage: null,
  monthlyUsageError: "user-info failed",
  lastKnownMonthlyUsage: knownUsage,
};

const freshState = {
  monthlyUsage: freshUsage,
  monthlyUsageError: null,
  lastKnownMonthlyUsage: freshUsage,
};

describe("shouldAutoRefreshStaleUsage", () => {
  it("detects last-known gateway usage with a current probe error", () => {
    expect(shouldAutoRefreshStaleUsage(staleState)).toBe(true);
  });

  it("does not refresh fresh or empty usage states", () => {
    expect(shouldAutoRefreshStaleUsage(freshState)).toBe(false);
    expect(
      shouldAutoRefreshStaleUsage({
        monthlyUsage: null,
        monthlyUsageError: "failed",
        lastKnownMonthlyUsage: null,
      }),
    ).toBe(false);
  });
});

describe("maybeAutoRefreshStaleUsage", () => {
  it("runs one forced background refresh and repaints on success", async () => {
    const refresh = vi.fn(async () => undefined);
    const repaint = vi.fn();
    const refreshState = createStaleUsageRefreshState();

    const scheduled = maybeAutoRefreshStaleUsage({
      state: staleState,
      refreshState,
      cwd: "/project",
      refresh,
      repaint,
      now: 1_000,
    });

    expect(scheduled).toBe(true);
    expect(refresh).toHaveBeenCalledWith(true, "/project");

    await vi.waitFor(() => expect(refreshState.inFlight).toBe(false));
    expect(repaint).toHaveBeenCalledOnce();
  });

  it("throttles repeated stale renders", () => {
    const refresh = vi.fn(async () => undefined);
    const repaint = vi.fn();
    const refreshState = createStaleUsageRefreshState();

    expect(
      maybeAutoRefreshStaleUsage({
        state: staleState,
        refreshState,
        cwd: "/project",
        refresh,
        repaint,
        now: 1_000,
        minIntervalMs: 60_000,
      }),
    ).toBe(true);

    refreshState.inFlight = false;
    expect(
      maybeAutoRefreshStaleUsage({
        state: staleState,
        refreshState,
        cwd: "/project",
        refresh,
        repaint,
        now: 30_000,
        minIntervalMs: 60_000,
      }),
    ).toBe(false);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing for fresh usage", () => {
    const refresh = vi.fn(async () => undefined);
    const repaint = vi.fn();

    expect(
      maybeAutoRefreshStaleUsage({
        state: freshState,
        refreshState: createStaleUsageRefreshState(),
        cwd: "/project",
        refresh,
        repaint,
      }),
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
