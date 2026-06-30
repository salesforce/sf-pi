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
  /** Cumulative spend on this specific API key. Resets when users rotate keys. */
  spend: number;
  /** Per-key RPM limit, when set by the gateway admin. */
  rpmLimit?: number;
  /** Per-key TPM limit, when set by the gateway admin. */
  tpmLimit?: number;
  /** Masked key name (e.g. `sk-...BEnw`) for friendly display. */
  keyName?: string;
  fetchedAt: string;
}

/**
 * Lightweight result of `/key/list` — only the number of keys the user has
 * on this gateway account. The gateway returns hashed key ids; we never
 * store them. Non-null `count > 1` is the trigger the extension uses to
 * warn about using a stale shell-exported key.
 */
export interface GatewayKeyList {
  count: number;
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

/**
 * One day of per-user activity metrics from `/user/daily/activity`.
 *
 * Unlike `/user/info` (which gives a single monthly rollup), this endpoint
 * returns per-day granularity, including `failed_requests` which is the
 * cleanest early-warning signal for gateway degradation.
 */
export interface GatewayDailyActivityEntry {
  /** ISO date, e.g. "2026-05-05". */
  date: string;
  spend: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  successfulRequests: number;
  failedRequests: number;
  apiRequests: number;
}

export interface GatewayDailyActivity {
  entries: GatewayDailyActivityEntry[];
  startDate: string;
  endDate: string;
  fetchedAt: string;
}

export type GatewayConnectionKind =
  | "checking"
  | "connected"
  | "not-configured"
  | "auth-failed"
  | "url-invalid"
  | "unreachable"
  | "degraded"
  | "unknown";

export interface GatewayConnectionStatus {
  kind: GatewayConnectionKind;
  detail?: string;
  checkedAt?: string;
  source?:
    "user-info" | "key-info" | "models" | "health" | "config" | "daily-activity" | "key-list";
  /** True when every primary-probe failure was an AbortError (timeout).
   *
   * UIs can render "Slow" instead of "Unreachable" so users know the
   * gateway is up but the cold-network path is sluggish. Only meaningful
   * when `kind === "unreachable"`. */
  timedOut?: boolean;
  /** True when `resolveConnectionStatus` retried once and the retry also
   * failed. UIs use this to suppress further auto-retry hints. Only
   * meaningful when `kind === "unreachable"`. */
  retried?: boolean;
}

/**
 * Cross-source API-key conflict warning.
 *
 * Emitted when the env var `SF_LLM_GATEWAY_INTERNAL_API_KEY` and the saved
 * config both hold a non-empty key and they don't match. Saved beats env
 * today, but a stale env key is a footgun (`/login` flows that clear saved
 * silently fall back to a blocked env key). UIs surface this once per
 * session as a passive nudge — not an error.
 */
export interface KeyConflictWarning {
  /** Eight-char SHA-256 prefix of the env-var key. Identifies *which* key
   * is the stale one without ever logging the secret. */
  envKeyHash: string;
  /** Eight-char SHA-256 prefix of the saved-config key. */
  savedKeyHash: string;
  /** Active key (the one chat actually uses). Always "saved" today. */
  active: "saved" | "env";
  /** Human-readable nudge, ready to display verbatim. */
  message: string;
}

/**
 * Per-endpoint result of the most recent gateway probe. Captured for
 * `/sf-llm-gateway probe --trace` and the boot-timing diagnostic.
 */
export interface GatewayProbeTraceEntry {
  /** Logical probe name, e.g. "user-info", "health". */
  source: NonNullable<GatewayConnectionStatus["source"]>;
  /** HTTP path probed. */
  path: string;
  /** Wall-clock ms the request took. */
  durationMs: number;
  /** HTTP status when the response landed. Undefined for AbortError / DNS. */
  status?: number;
  /** Error name when the fetch threw, e.g. "AbortError". */
  errorName?: string;
  /** First 240 chars of an error/body preview. Never includes secrets. */
  errorMessage?: string;
  /** True when the fetch resolved successfully (`response.ok`). */
  ok: boolean;
}

/**
 * Snapshot of the most recent refresh's per-endpoint timings.
 *
 * Cleared at the start of every refresh and replaced once probes settle.
 * Use this to answer "which endpoint was slow / failing?" without re-running
 * the probes.
 */
export interface GatewayProbeTrace {
  startedAt: string;
  finishedAt: string;
  /** Total wall-clock for the whole parallel refresh. */
  totalMs: number;
  /** True when this trace records a retry attempt (Phase 1.2). */
  wasRetry: boolean;
  entries: GatewayProbeTraceEntry[];
}

export interface MonthlyUsageSnapshot {
  monthlyUsage: GatewayMonthlyUsage | null;
  monthlyUsageError: string | null;
  keyInfo: GatewayKeyInfo | null;
  keyInfoError: string | null;
  health: GatewayHealth | null;
  healthError: string | null;
  connectionStatus?: GatewayConnectionStatus | null;
  /**
   * Per-day activity for the current user. Optional so pre-Phase-1 consumers
   * keep compiling; when absent, treat it the same as an empty snapshot.
   */
  dailyActivity?: GatewayDailyActivity | null;
  dailyActivityError?: string | null;
  /** Number of keys this user has on the gateway, from `/key/list`. */
  keyList?: GatewayKeyList | null;
  keyListError?: string | null;
  /**
   * Cross-source key-conflict warning. Computed by the refresher every time
   * it resolves config; UIs render once per session.
   */
  keyConflict?: KeyConflictWarning | null;
  /** Most recent per-endpoint probe trace. Used by `--trace` diagnostics. */
  lastProbeTrace?: GatewayProbeTrace | null;
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
  connectionStatus: null,
  dailyActivity: null,
  dailyActivityError: null,
  keyList: null,
  keyListError: null,
  keyConflict: null,
  lastProbeTrace: null,
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
