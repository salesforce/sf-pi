/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the monthly-usage shared store.
 *
 * Covers:
 *   - subscribe/unsubscribe lifecycle
 *   - listeners fire on setMonthlyUsageState and clearMonthlyUsageState
 *   - throwing listeners do not break other subscribers
 *   - refreshMonthlyUsage is a no-op when no refresher is registered
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMonthlyUsageStoreForTests,
  clearMonthlyUsageState,
  getMonthlyUsageState,
  refreshMonthlyUsage,
  registerMonthlyUsageRefresher,
  setMonthlyUsageState,
  subscribeMonthlyUsageState,
  type MonthlyUsageSnapshot,
} from "../monthly-usage/store.ts";

const SAMPLE: MonthlyUsageSnapshot = {
  monthlyUsage: {
    maxBudget: 3000,
    spend: 42.5,
    remaining: 2957.5,
    budgetResetAt: "2026-05-01",
    budgetDuration: "1mo",
    fetchedAt: new Date().toISOString(),
  },
  monthlyUsageError: null,
  keyInfo: {
    spend: 1234.56,
    keyName: "sk-...abcd",
    fetchedAt: new Date().toISOString(),
  },
  keyInfoError: null,
  health: null,
  healthError: null,
};

describe("monthly-usage store", () => {
  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
  });

  it("subscribers are notified on setMonthlyUsageState", () => {
    const listener = vi.fn();
    subscribeMonthlyUsageState(listener);

    setMonthlyUsageState(SAMPLE);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(SAMPLE);
    expect(getMonthlyUsageState()).toBe(SAMPLE);
  });

  it("subscribers are notified on clearMonthlyUsageState", () => {
    setMonthlyUsageState(SAMPLE);
    const listener = vi.fn();
    subscribeMonthlyUsageState(listener);

    clearMonthlyUsageState();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getMonthlyUsageState().monthlyUsage).toBeNull();
  });

  it("returned unsubscribe handle stops future notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMonthlyUsageState(listener);

    unsubscribe();
    setMonthlyUsageState(SAMPLE);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not call listener with the current snapshot on subscribe", () => {
    // Contract: sf-welcome reads current state synchronously and then
    // subscribes — a replay on subscribe would cause an unnecessary repaint.
    setMonthlyUsageState(SAMPLE);
    const listener = vi.fn();

    subscribeMonthlyUsageState(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener does not block other listeners", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();

    subscribeMonthlyUsageState(bad);
    subscribeMonthlyUsageState(good);

    expect(() => setMonthlyUsageState(SAMPLE)).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("refreshMonthlyUsage is a no-op when no refresher is registered", async () => {
    // This is the core contract that lets sf-welcome call refresh without
    // importing from the gateway extension.
    await expect(refreshMonthlyUsage(true, process.cwd())).resolves.toBeUndefined();
  });

  it("refreshMonthlyUsage delegates to the registered refresher", async () => {
    const refresher = vi.fn().mockResolvedValue(undefined);
    registerMonthlyUsageRefresher(refresher);

    await refreshMonthlyUsage(true, "/tmp");

    expect(refresher).toHaveBeenCalledWith(true, "/tmp");
  });

  it("backing state lives on globalThis so duplicate module instances share it", () => {
    // Regression test for the production bug where pi's jiti loader
    // (moduleCache: false) created one module instance per extension,
    // giving sf-welcome and sf-llm-gateway-internal independent stores
    // that never saw each other's publishes. Parking the backing state
    // on globalThis makes every loaded copy of this module share the
    // same snapshot + listeners + refresher.
    const globalObj = globalThis as unknown as Record<string, unknown>;
    const slot = globalObj["__sfPiMonthlyUsageStore"] as
      | { snapshot: unknown; listeners: Set<unknown>; refresher: unknown }
      | undefined;
    expect(slot).toBeDefined();

    const listener = vi.fn();
    subscribeMonthlyUsageState(listener);
    setMonthlyUsageState(SAMPLE);

    // The listener we registered must end up in the same Set that is
    // parked on globalThis — if these ever diverge, the jiti bug returns.
    expect(slot!.listeners.size).toBeGreaterThanOrEqual(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
