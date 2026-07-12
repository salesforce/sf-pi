/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Stale gateway usage auto-refresh.
 *
 * The gateway footer can show a last-known spend value with a `stale` marker
 * when the current usage probe failed or was not freshly confirmed. This
 * helper keeps that UX self-healing without adding a polling loop: when a
 * status refresh observes stale usage, it schedules one throttled forced
 * refresh in the background and repaints the status if it completes.
 */
import type { GatewayRuntimeStatusState } from "./status.ts";

export interface StaleUsageRefreshState {
  inFlight: boolean;
  lastAttemptAt: number;
}

export interface MaybeAutoRefreshStaleUsageOptions {
  state: Pick<
    GatewayRuntimeStatusState,
    "monthlyUsage" | "monthlyUsageError" | "lastKnownMonthlyUsage"
  >;
  refreshState: StaleUsageRefreshState;
  cwd: string;
  refresh: (force: boolean, cwd: string) => Promise<void>;
  repaint: () => void;
  now?: number;
  minIntervalMs?: number;
}

export const STALE_USAGE_REFRESH_MIN_INTERVAL_MS = 60_000;

export function createStaleUsageRefreshState(): StaleUsageRefreshState {
  return { inFlight: false, lastAttemptAt: 0 };
}

export function shouldAutoRefreshStaleUsage(
  state: Pick<
    GatewayRuntimeStatusState,
    "monthlyUsage" | "monthlyUsageError" | "lastKnownMonthlyUsage"
  >,
): boolean {
  return !state.monthlyUsage && Boolean(state.monthlyUsageError && state.lastKnownMonthlyUsage);
}

export function maybeAutoRefreshStaleUsage(options: MaybeAutoRefreshStaleUsageOptions): boolean {
  const minIntervalMs = options.minIntervalMs ?? STALE_USAGE_REFRESH_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now();
  const state = options.refreshState;

  if (!shouldAutoRefreshStaleUsage(options.state)) return false;
  if (state.inFlight) return false;
  if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < minIntervalMs) return false;

  state.inFlight = true;
  state.lastAttemptAt = now;

  void options
    .refresh(true, options.cwd)
    .then(() => {
      options.repaint();
    })
    .catch(() => {
      // The refresher records failures in the shared monthly-usage state.
      // Keep the existing stale value and try again after the throttle window.
    })
    .finally(() => {
      state.inFlight = false;
    });

  return true;
}
