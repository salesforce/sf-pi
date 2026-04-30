/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Covers resolveLifetimeUsage() — the splash's new "Lifetime Usage" line.
 *
 * Contract:
 *   - If the gateway has populated keyInfo.spend, use it (source = gateway).
 *   - Otherwise return a local session-file estimate (source = sessions).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMonthlyUsageStoreForTests,
  setMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { resolveLifetimeUsage } from "../lib/splash-data.ts";
import * as sessionData from "../lib/session-data.ts";

describe("resolveLifetimeUsage", () => {
  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
    vi.restoreAllMocks();
  });

  it("prefers the gateway's per-key lifetime spend when available", () => {
    setMonthlyUsageState({
      monthlyUsage: null,
      monthlyUsageError: null,
      keyInfo: {
        spend: 987.65,
        keyName: "sk-...abcd",
        fetchedAt: new Date().toISOString(),
      },
      keyInfoError: null,
      health: null,
      healthError: null,
    });
    const estimateSpy = vi.spyOn(sessionData, "estimateLifetimeCost");

    const result = resolveLifetimeUsage();

    expect(result).toEqual({ lifetimeCost: 987.65, lifetimeUsageSource: "gateway" });
    // Gateway wins — we should not waste a filesystem scan.
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("falls back to a local session-file estimate when keyInfo is missing", () => {
    // BYO-keys users: no gateway response, no keyInfo → scan local sessions.
    vi.spyOn(sessionData, "estimateLifetimeCost").mockReturnValue(123.45);

    const result = resolveLifetimeUsage();

    expect(result).toEqual({ lifetimeCost: 123.45, lifetimeUsageSource: "sessions" });
  });
});
