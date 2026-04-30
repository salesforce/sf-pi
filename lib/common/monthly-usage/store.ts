/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Monthly-usage shared state store.
 *
 * Decouples UI consumers (e.g. sf-welcome splash, sf-devbar footer) from the
 * provider that actually fetches usage data (sf-llm-gateway-internal). This
 * preserves the "disabled extensions have zero runtime cost" contract — if
 * no provider is registered, consumers see null state and render fallbacks
 * instead of importing a disabled extension's internals.
 *
 * Contract:
 *   - A provider (typically sf-llm-gateway-internal) registers a refresher at
 *     session_start via `registerMonthlyUsageRefresher`.
 *   - The provider publishes snapshots into the store via `setMonthlyUsageState`.
 *   - Consumers read via `getMonthlyUsageState` and can trigger a refresh via
 *     `refreshMonthlyUsage(force, cwd)`. If no provider is registered the
 *     refresh is a no-op.
 */

export interface GatewayMonthlyUsage {
  maxBudget: number;
  spend: number;
  remaining: number;
  budgetResetAt: string;
  budgetDuration: string;
  fetchedAt: string;
  error?: string;
}

export interface GatewayKeyInfo {
  /** Lifetime spend on this specific API key. */
  spend: number;
  /** Per-key RPM limit, when set by the gateway admin. */
  rpmLimit?: number;
  /** Per-key TPM limit, when set by the gateway admin. */
  tpmLimit?: number;
  /** Masked key name (e.g. `sk-...BEnw`) for friendly display. */
  keyName?: string;
  fetchedAt: string;
}

export interface GatewayHealth {
  /** `/health/readiness.status`, e.g. `"connected"`. */
  status: string;
  /** Gateway version string, e.g. LiteLLM proxy version. */
  litellmVersion?: string;
  /** Gateway-reported last-updated timestamp. */
  lastUpdated?: string;
  fetchedAt: string;
}

export interface MonthlyUsageSnapshot {
  monthlyUsage: GatewayMonthlyUsage | null;
  monthlyUsageError: string | null;
  keyInfo: GatewayKeyInfo | null;
  keyInfoError: string | null;
  health: GatewayHealth | null;
  healthError: string | null;
}

export type MonthlyUsageRefresher = (force: boolean, cwd: string) => Promise<void>;

/** Listener invoked after every publish, including clears. Runs synchronously
 * inside setMonthlyUsageState; listeners should be fast and must not throw. */
export type MonthlyUsageListener = (snapshot: MonthlyUsageSnapshot) => void;

const EMPTY_SNAPSHOT: MonthlyUsageSnapshot = {
  monthlyUsage: null,
  monthlyUsageError: null,
  keyInfo: null,
  keyInfoError: null,
  health: null,
  healthError: null,
};

// -----------------------------------------------------------------------------
// globalThis-backed singleton
//
// Pi loads each extension with `jiti.moduleCache: false`, which means this
// module is instantiated once per extension that imports it. Producer
// (`sf-llm-gateway-internal`) and consumers (`sf-welcome`, `sf-devbar`) would
// otherwise end up with independent `listeners`/`currentSnapshot`/`refresher`
// state and never see each other's publishes — which is the race that caused
// the splash to stay on `(local estimate)` while the bottom bar had live
// numbers.
//
// Parking backing state on a single global slot gives every module instance
// the same object to read/write. The slot key is scoped under a dedicated
// namespace so it cannot collide with anything else and stays easy to grep.
// -----------------------------------------------------------------------------
interface StoreBackingState {
  snapshot: MonthlyUsageSnapshot;
  refresher: MonthlyUsageRefresher | null;
  listeners: Set<MonthlyUsageListener>;
}

const GLOBAL_SLOT = "__sfPiMonthlyUsageStore" as const;

function getBackingState(): StoreBackingState {
  const globalObj = globalThis as unknown as Record<string, StoreBackingState | undefined>;
  let state = globalObj[GLOBAL_SLOT];
  if (!state) {
    state = {
      snapshot: EMPTY_SNAPSHOT,
      refresher: null,
      listeners: new Set<MonthlyUsageListener>(),
    };
    globalObj[GLOBAL_SLOT] = state;
  }
  return state;
}

export function getMonthlyUsageState(): MonthlyUsageSnapshot {
  return getBackingState().snapshot;
}

export function setMonthlyUsageState(next: MonthlyUsageSnapshot): void {
  const state = getBackingState();
  state.snapshot = next;
  notifyListeners();
}

export function clearMonthlyUsageState(): void {
  const state = getBackingState();
  state.snapshot = EMPTY_SNAPSHOT;
  notifyListeners();
}

/**
 * Subscribe to snapshot changes. The listener is NOT called with the current
 * snapshot on subscribe — callers that need the current value should read it
 * via getMonthlyUsageState() first. Returns an unsubscribe handle.
 *
 * This exists so UI consumers (e.g. sf-welcome splash) can repaint reactively
 * when the provider finishes fetching, without racing the provider's own
 * session_start registration (extension load order is not guaranteed).
 */
export function subscribeMonthlyUsageState(listener: MonthlyUsageListener): () => void {
  const state = getBackingState();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const state = getBackingState();
  for (const listener of state.listeners) {
    try {
      listener(state.snapshot);
    } catch {
      // Swallow listener errors so one bad consumer can't break the publish path.
    }
  }
}

/**
 * Register the refresher that knows how to fetch usage from the live
 * provider. Call this once at extension session_start. Returns a function
 * to unregister (paired with session_shutdown).
 */
export function registerMonthlyUsageRefresher(refresher: MonthlyUsageRefresher): () => void {
  const state = getBackingState();
  state.refresher = refresher;
  return () => {
    if (state.refresher === refresher) {
      state.refresher = null;
    }
  };
}

/**
 * Trigger a refresh via the registered provider. If no provider is
 * registered (e.g. sf-llm-gateway-internal is disabled), this is a no-op
 * and consumers continue to see whatever was last published.
 */
export async function refreshMonthlyUsage(force: boolean, cwd: string): Promise<void> {
  const state = getBackingState();
  if (!state.refresher) return;
  try {
    await state.refresher(force, cwd);
  } catch {
    // Refreshers are expected to capture their own errors into the
    // snapshot. Swallow anything that bubbles so a consumer's UI paint
    // never crashes on a transient fetch failure.
  }
}

/** Test-only: reset refresher + snapshot + listeners to initial state. */
export function __resetMonthlyUsageStoreForTests(): void {
  const state = getBackingState();
  state.refresher = null;
  state.snapshot = EMPTY_SNAPSHOT;
  state.listeners.clear();
}
