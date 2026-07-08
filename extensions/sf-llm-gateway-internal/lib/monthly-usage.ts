/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Monthly usage + per-key + gateway health fetcher.
 *
 * The gateway exposes three complementary endpoint families:
 *   - `/user/info` or `/v2/user/info?user_id=...`
 *                         → monthly budget + spend for the whole user
 *   - `/key/info`         → per-key spend + rpm/tpm limits for *this* API key
 *   - `/health/readiness` → gateway version and last upstream probe time
 *
 * All three change slowly, so we cache them for a short TTL to avoid
 * refetching on every footer repaint. A single refresh pulls everything in
 * parallel — one slow endpoint should not stall the others.
 *
 * Published state lives in `lib/common/monthly-usage/store.ts` so other
 * extensions (sf-welcome, sf-devbar) can read it without importing from this
 * extension directly. When this extension is disabled, no refresher is
 * registered and consumers see the empty snapshot.
 */
import { createHash } from "node:crypto";
import type {
  GatewayConnectionStatus,
  GatewayDailyActivity,
  GatewayDailyActivityEntry,
  GatewayHealth,
  GatewayKeyInfo,
  GatewayKeyList,
  GatewayMonthlyUsage,
  GatewayProbeTrace,
  GatewayProbeTraceEntry,
  KeyConflictWarning,
  MonthlyUsageSnapshot,
} from "../../../lib/common/monthly-usage/store.ts";
import {
  clearMonthlyUsageState,
  getMonthlyUsageState,
  registerMonthlyUsageRefresher,
  setMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import {
  readCachedMonthlyUsageSnapshot,
  writeCachedMonthlyUsageSnapshot,
} from "../../../lib/common/monthly-usage/cache.ts";
import {
  API_KEY_ENV,
  LEGACY_API_KEY_ENV,
  getGatewayConfig,
  getMergedSavedGatewayConfig,
  readGatewayEnv,
} from "./config.ts";
import { toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";

// Short TTL so the `💰 $N/∞` pill refreshes roughly once a minute even
// during back-to-back turns. The gateway endpoints are cheap GETs and this
// is still bounded by how often a consumer (footer repaint on turn_end)
// actually asks for a refresh, so the request rate stays reasonable.
const MONTHLY_USAGE_TTL_MS = 60 * 1000;

// Phase 1.5: lowered from 10s to 5s so a slow probe surfaces faster. With
// the one-shot retry below the worst-case is still bounded (~12s) but the
// splash repaints sooner on a cold-network blip. Override via
// SF_PI_GATEWAY_PROBE_TIMEOUT_MS for users on consistently sluggish links.
const FETCH_TIMEOUT_MS = parseTimeoutEnv(process.env.SF_PI_GATEWAY_PROBE_TIMEOUT_MS, 5_000);

// Phase 1.2: when every primary probe rejects with a non-HTTP error
// (timeout / DNS / abort), retry once after this delay before classifying
// the gateway as `unreachable`. Keeps cold-start blips from sticking on
// the splash for the entire 30s window.
const RETRY_DELAY_MS = 1_500;

function parseTimeoutEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : fallback;
}

// Re-export types so existing imports (e.g. status.ts) keep working without
// reaching into lib/common directly.
export type {
  GatewayConnectionStatus,
  GatewayDailyActivity,
  GatewayDailyActivityEntry,
  GatewayHealth,
  GatewayKeyInfo,
  GatewayKeyList,
  GatewayMonthlyUsage,
  GatewayProbeTrace,
  GatewayProbeTraceEntry,
  KeyConflictWarning,
} from "../../../lib/common/monthly-usage/store.ts";

/**
 * Default daily-activity window. Seven days is enough to spot a bad day
 * next to a healthy baseline but small enough that `/user/daily/activity`
 * responds in ~150ms on this gateway.
 */
const DAILY_ACTIVITY_DEFAULT_DAYS = 7;

export { getMonthlyUsageState };

let lastFetchAt = 0;
let refreshInFlight: Promise<void> | null = null;
let lastDetailsFetchAt = 0;
let detailsRefreshInFlight: Promise<void> | null = null;

type GatewayProbeSource = NonNullable<GatewayConnectionStatus["source"]>;

class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly source: GatewayProbeSource,
    readonly status?: number,
    readonly bodyPreview: string = "",
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

type GatewayKeyInfoWithUserId = GatewayKeyInfo & { userId?: string };

type GatewayUserInfoPayload = {
  max_budget?: number;
  spend?: number;
  budget_reset_at?: string;
  budget_duration?: string;
};

/**
 * Recorded per-probe trace context. Local to this module — we expose only
 * the public `GatewayProbeTraceEntry` shape via the store. Wraps the
 * fetcher so every call site picks up trace capture without per-call
 * boilerplate.
 *
 * Capture is always-on but cheap (one entry per probe per refresh). The
 * payload never includes the API key or full response body, only the path
 * and a 240-char error preview.
 */
async function tracedProbe<T>(
  source: GatewayProbeSource,
  path: string,
  run: () => Promise<T>,
  trace: GatewayProbeTraceEntry[],
): Promise<T> {
  const t0 = Date.now();
  try {
    const value = await run();
    trace.push({
      source,
      path,
      durationMs: Date.now() - t0,
      ok: true,
    });
    return value;
  } catch (err) {
    const entry: GatewayProbeTraceEntry = {
      source,
      path,
      durationMs: Date.now() - t0,
      ok: false,
      errorName: err instanceof Error ? err.name : undefined,
      errorMessage: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
    if (err instanceof GatewayRequestError && typeof err.status === "number") {
      entry.status = err.status;
    }
    trace.push(entry);
    throw err;
  }
}

/**
 * Register the gateway refresher with the shared store. Call once at
 * session_start. Returns the unregister handle for session_shutdown.
 */
export function registerGatewayMonthlyUsageRefresher(): () => void {
  const cached = readCachedMonthlyUsageSnapshot();
  if (cached) {
    setMonthlyUsageState(cached);
  }
  const unregister = registerMonthlyUsageRefresher(refreshMonthlyUsage);
  return () => {
    unregister();
    clearMonthlyUsageState();
    lastFetchAt = 0;
    refreshInFlight = null;
  };
}

/**
 * Refresh the three primary connection probes (user-info, key-info,
 * health) plus the monthly-usage payload that drives the splash and the
 * `💰 $N/∞` footer pill.
 *
 * Phase 1 changes:
 *   1.1 Publishes `kind: "checking"` *before* firing requests so first-paint
 *       UIs render "Checking..." instead of stale empty state.
 *   1.2 One-shot retry on `unreachable` after RETRY_DELAY_MS. The retry
 *       record is captured in `lastProbeTrace.wasRetry`.
 *   1.3 Distinguishes AbortError (`timedOut: true`) from other unreachable.
 *   1.4 Drops daily-activity and key-list from this hot path — they live
 *       in `refreshUsageDetails` now, called from /sf-llm-gateway panel
 *       and `usage-probe` only.
 *   1.6 Computes a `keyConflict` warning when env and saved keys differ.
 *
 * Phase 3.1: per-endpoint trace is captured into `lastProbeTrace`.
 */
export async function refreshMonthlyUsage(force: boolean, cwd: string): Promise<void> {
  if (!force && lastFetchAt > 0 && Date.now() - lastFetchAt < MONTHLY_USAGE_TTL_MS) {
    return;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const config = getGatewayConfig(cwd);
    const keyConflict = computeKeyConflict(cwd);
    const previousLastKnownMonthlyUsage = getLastKnownMonthlyUsage();

    if (!config.baseUrl) {
      publishError(
        "Missing base URL configuration.",
        {
          kind: "not-configured",
          detail: "Missing base URL configuration.",
          checkedAt: new Date().toISOString(),
          source: "config",
        },
        keyConflict,
      );
      lastFetchAt = Date.now();
      return;
    }

    if (!config.apiKey) {
      const message = `Missing ${API_KEY_ENV} or saved API key.`;
      publishError(
        message,
        {
          kind: "not-configured",
          detail: message,
          checkedAt: new Date().toISOString(),
          source: "config",
        },
        keyConflict,
      );
      lastFetchAt = Date.now();
      return;
    }

    // 1.1: announce the refresh immediately so consumers can render
    // "Checking..." instead of a blank/last-error state. Done as a partial
    // merge so we don't drop the previous snapshot's monthlyUsage — useful
    // when a TTL-bounded re-probe is in flight and the splash shouldn't
    // flash to $0.00.
    publishChecking(keyConflict);

    const startedAt = new Date();
    let trace: GatewayProbeTraceEntry[] = [];
    let attempt = await runPrimaryProbes(config.baseUrl, config.apiKey, trace);
    let wasRetry = false;

    // 1.2: retry once when classifying as `unreachable` AND the failure was
    // not a clear HTTP error (i.e. it could be a cold-network blip).
    const initialStatus = resolveConnectionStatus(
      attempt.usageResult,
      attempt.keyResult,
      attempt.healthResult,
    );
    if (initialStatus.kind === "unreachable") {
      await delay(RETRY_DELAY_MS);
      trace = []; // overwrite — we want the trace to reflect the *final* state
      attempt = await runPrimaryProbes(config.baseUrl, config.apiKey, trace);
      wasRetry = true;
    }

    const finalStatus = resolveConnectionStatus(
      attempt.usageResult,
      attempt.keyResult,
      attempt.healthResult,
    );
    if (wasRetry && finalStatus.kind === "unreachable") {
      finalStatus.retried = true;
    }

    const finishedAt = new Date();
    const probeTrace: GatewayProbeTrace = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      totalMs: finishedAt.getTime() - startedAt.getTime(),
      wasRetry,
      entries: trace,
    };

    const snapshot: MonthlyUsageSnapshot = {
      monthlyUsage: null,
      monthlyUsageError: null,
      lastKnownMonthlyUsage: previousLastKnownMonthlyUsage,
      keyInfo: null,
      keyInfoError: null,
      health: null,
      healthError: null,
      connectionStatus: finalStatus,
      // Preserve any details fetched by refreshUsageDetails so the splash
      // doesn't lose its 7-day chart on a primary-only refresh.
      dailyActivity: getMonthlyUsageState().dailyActivity ?? null,
      dailyActivityError: getMonthlyUsageState().dailyActivityError ?? null,
      keyList: getMonthlyUsageState().keyList ?? null,
      keyListError: getMonthlyUsageState().keyListError ?? null,
      keyConflict,
      lastProbeTrace: probeTrace,
    };

    if (attempt.usageResult.status === "fulfilled") {
      snapshot.monthlyUsage = { ...attempt.usageResult.value, error: undefined };
      snapshot.lastKnownMonthlyUsage = snapshot.monthlyUsage;
    } else {
      snapshot.monthlyUsageError = formatErrorMessage(attempt.usageResult.reason);
    }

    if (attempt.keyResult.status === "fulfilled") {
      snapshot.keyInfo = toPublicKeyInfo(attempt.keyResult.value);
    } else {
      snapshot.keyInfoError = formatErrorMessage(attempt.keyResult.reason);
    }

    if (attempt.healthResult.status === "fulfilled") {
      snapshot.health = attempt.healthResult.value;
    } else {
      snapshot.healthError = formatErrorMessage(attempt.healthResult.reason);
    }

    setMonthlyUsageState(snapshot);
    writeCachedMonthlyUsageSnapshot(snapshot);
    lastFetchAt = Date.now();
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Run only the primary three probes and update the trace array.
 * Extracted so the retry path runs the exact same code without copy/paste.
 */
async function runPrimaryProbes(
  baseUrl: string,
  apiKey: string,
  trace: GatewayProbeTraceEntry[],
): Promise<{
  usageResult: PromiseSettledResult<GatewayMonthlyUsage>;
  keyResult: PromiseSettledResult<GatewayKeyInfoWithUserId>;
  healthResult: PromiseSettledResult<GatewayHealth>;
}> {
  let [usageResult, keyResult, healthResult] = await Promise.allSettled([
    tracedProbe("user-info", "/user/info", () => fetchMonthlyUsage(baseUrl, apiKey), trace),
    tracedProbe("key-info", "/key/info", () => fetchKeyInfo(baseUrl, apiKey), trace),
    tracedProbe("health", "/health/readiness", () => fetchHealth(baseUrl, apiKey), trace),
  ] as const);

  // Some gateway keys are now scoped to `/v2/user/info` instead of the
  // historical `/user/info`. `/key/info` carries the current user id, so when
  // the legacy route is explicitly not allow-listed we can recover without a
  // second credential source or a user-visible stale footer.
  if (shouldTryV2UserInfoFallback(usageResult, keyResult)) {
    usageResult = await settle(
      tracedProbe(
        "user-info",
        "/v2/user/info?user_id=<current-user>",
        () => fetchMonthlyUsageV2(baseUrl, apiKey, keyResult.value.userId!),
        trace,
      ),
    );
  }

  return { usageResult, keyResult, healthResult };
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function shouldTryV2UserInfoFallback(
  usageResult: PromiseSettledResult<GatewayMonthlyUsage>,
  keyResult: PromiseSettledResult<GatewayKeyInfoWithUserId>,
): keyResult is PromiseFulfilledResult<GatewayKeyInfoWithUserId> {
  if (usageResult.status === "fulfilled" || keyResult.status !== "fulfilled") return false;
  if (!keyResult.value.userId) return false;
  const reason = usageResult.reason;
  if (!(reason instanceof GatewayRequestError)) return false;
  if (reason.status !== 403 && reason.status !== 404) return false;
  return /\/v2\/user\/info|not allowed to call this route/i.test(
    `${reason.bodyPreview}\n${reason.message}`,
  );
}

function toPublicKeyInfo(keyInfo: GatewayKeyInfoWithUserId): GatewayKeyInfo {
  return {
    spend: keyInfo.spend,
    rpmLimit: keyInfo.rpmLimit,
    tpmLimit: keyInfo.tpmLimit,
    keyName: keyInfo.keyName,
    fetchedAt: keyInfo.fetchedAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Refresh daily activity and key-list — the two endpoints that aren't
 * needed for the splash status row or the bottom-bar pill. Runs piggy-back
 * on the panel commands and the first turn_end (Phase 1.4).
 *
 * Failures here never downgrade the primary connection status — they're
 * surfaced via `dailyActivityError` / `keyListError` only.
 */
export async function refreshUsageDetails(force: boolean, cwd: string): Promise<void> {
  if (!force && lastDetailsFetchAt > 0 && Date.now() - lastDetailsFetchAt < MONTHLY_USAGE_TTL_MS) {
    return;
  }

  if (detailsRefreshInFlight) {
    return detailsRefreshInFlight;
  }

  detailsRefreshInFlight = (async () => {
    const config = getGatewayConfig(cwd);
    if (!config.baseUrl || !config.apiKey) return;

    const [dailyResult, keyListResult] = await Promise.allSettled([
      fetchDailyActivity(config.baseUrl, config.apiKey, DAILY_ACTIVITY_DEFAULT_DAYS),
      fetchKeyList(config.baseUrl, config.apiKey),
    ]);

    // Merge into existing snapshot so we never blow away the primary state.
    const previous = getMonthlyUsageState();
    setMonthlyUsageState({
      ...previous,
      dailyActivity: dailyResult.status === "fulfilled" ? dailyResult.value : null,
      dailyActivityError:
        dailyResult.status === "fulfilled" ? null : formatErrorMessage(dailyResult.reason),
      keyList: keyListResult.status === "fulfilled" ? keyListResult.value : null,
      keyListError:
        keyListResult.status === "fulfilled" ? null : formatErrorMessage(keyListResult.reason),
    });
    lastDetailsFetchAt = Date.now();
  })();

  try {
    await detailsRefreshInFlight;
  } finally {
    detailsRefreshInFlight = null;
  }
}

function publishError(
  message: string,
  connectionStatus: GatewayConnectionStatus,
  keyConflict: KeyConflictWarning | null,
): void {
  const snapshot: MonthlyUsageSnapshot = {
    monthlyUsage: null,
    monthlyUsageError: message,
    lastKnownMonthlyUsage: getLastKnownMonthlyUsage(),
    keyInfo: null,
    keyInfoError: message,
    health: null,
    healthError: message,
    connectionStatus,
    keyConflict,
  };
  setMonthlyUsageState(snapshot);
  writeCachedMonthlyUsageSnapshot(snapshot);
}

/**
 * Phase 1.1: publish a `checking` snapshot at the top of every refresh so
 * UIs can render "Checking..." the moment a probe starts. Preserves any
 * data fields from the previous snapshot so a transient re-probe doesn't
 * flash empty values onto the splash.
 */
function getLastKnownMonthlyUsage(): GatewayMonthlyUsage | null {
  const previous = getMonthlyUsageState();
  return previous.monthlyUsage ?? previous.lastKnownMonthlyUsage ?? null;
}

function publishChecking(keyConflict: KeyConflictWarning | null): void {
  const previous = getMonthlyUsageState();
  setMonthlyUsageState({
    ...previous,
    connectionStatus:
      previous.connectionStatus && previous.connectionStatus.kind !== "checking"
        ? previous.connectionStatus
        : {
            kind: "checking",
            checkedAt: new Date().toISOString(),
          },
    keyConflict,
  });
}

/**
 * Phase 1.6: compute a key-conflict warning when both env and saved keys
 * are set and don't match. Saved beats env in `getGatewayConfig`, so the
 * env key is the stale one. Returns null when there's nothing to warn
 * about — caller can persist that into the snapshot to clear stale
 * warnings after the user fixes the conflict.
 */
export function computeKeyConflict(cwd: string): KeyConflictWarning | null {
  const saved = getMergedSavedGatewayConfig(cwd).apiKey?.trim();
  const env = readGatewayEnv(API_KEY_ENV, LEGACY_API_KEY_ENV)?.trim();
  if (!saved || !env) return null;
  if (saved === env) return null;

  const savedHash = hashApiKey(saved);
  const envHash = hashApiKey(env);
  return {
    savedKeyHash: savedHash,
    envKeyHash: envHash,
    active: "saved",
    message: `Two gateway API keys are configured (env: ${envHash}…, saved: ${savedHash}…). The saved key is active. If the env key is stale, run /sf-llm-gateway doctor for guidance, or update your shell/Keychain to match.`,
  };
}

/** Stable 8-char hash used to identify a key without ever logging it. */
function hashApiKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function resolveConnectionStatus(
  usageResult: PromiseSettledResult<GatewayMonthlyUsage>,
  keyResult: PromiseSettledResult<GatewayKeyInfo>,
  healthResult: PromiseSettledResult<GatewayHealth>,
): GatewayConnectionStatus {
  const checkedAt = new Date().toISOString();
  if (usageResult.status === "fulfilled") {
    return healthResult.status === "fulfilled"
      ? { kind: "connected", checkedAt, source: "user-info" }
      : {
          kind: "degraded",
          detail: formatSettledError(healthResult),
          checkedAt,
          source: "user-info",
        };
  }
  if (keyResult.status === "fulfilled") {
    return healthResult.status === "fulfilled"
      ? { kind: "connected", checkedAt, source: "key-info" }
      : {
          kind: "degraded",
          detail: formatSettledError(healthResult),
          checkedAt,
          source: "key-info",
        };
  }

  const failures = [usageResult, keyResult, healthResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  const requestErrors = failures.filter(
    (error): error is GatewayRequestError => error instanceof GatewayRequestError,
  );
  const authFailure = requestErrors.find(
    (error) =>
      error.status === 401 ||
      error.status === 403 ||
      /unauthorized|authentication/i.test(error.bodyPreview),
  );
  if (authFailure) {
    return {
      kind: "auth-failed",
      detail: authFailure.message,
      checkedAt,
      source: authFailure.source,
    };
  }

  const urlFailure = requestErrors.find(
    (error) =>
      error.status === 302 ||
      error.status === 307 ||
      error.status === 404 ||
      /openid-connect|oauth|Found<\/a>|<html/i.test(error.bodyPreview),
  );
  if (urlFailure) {
    return {
      kind: "url-invalid",
      detail: urlFailure.message,
      checkedAt,
      source: urlFailure.source,
    };
  }

  if (healthResult.status === "fulfilled") {
    return {
      kind: "degraded",
      detail: formatProbeFailureSummary(usageResult, keyResult),
      checkedAt,
      source: "health",
    };
  }

  const unreachable = failures.find((error) => !(error instanceof GatewayRequestError));
  if (unreachable) {
    // Phase 1.3: classify AbortError separately so the splash can render
    // "Slow" instead of "Unreachable" — the gateway might be up but the
    // VPN/cold-start link took longer than FETCH_TIMEOUT_MS.
    const allTimedOut = failures.every(
      (error) => error instanceof Error && error.name === "AbortError",
    );
    return {
      kind: "unreachable",
      detail: allTimedOut
        ? `Gateway probe timed out after ${FETCH_TIMEOUT_MS} ms. VPN waking up, or gateway slow to respond.`
        : formatError(unreachable),
      checkedAt,
      timedOut: allTimedOut,
    };
  }

  const first = requestErrors[0];
  if (first && typeof first.status === "number" && first.status >= 500) {
    return { kind: "unreachable", detail: first.message, checkedAt, source: first.source };
  }

  return {
    kind: "unknown",
    detail: first?.message ?? "Gateway probe failed.",
    checkedAt,
    source: first?.source,
  };
}

function formatSettledError(result: PromiseSettledResult<unknown>): string | undefined {
  return result.status === "rejected" ? formatError(result.reason) : undefined;
}

function formatProbeFailureSummary(
  usageResult: PromiseSettledResult<GatewayMonthlyUsage>,
  keyResult: PromiseSettledResult<GatewayKeyInfo>,
): string {
  const failures = [
    usageResult.status === "rejected" ? formatError(usageResult.reason) : null,
    keyResult.status === "rejected" ? formatError(keyResult.reason) : null,
  ].filter((value): value is string => Boolean(value));
  return failures.length > 0
    ? `Auth-gated usage probes failed while health succeeded: ${failures.join("; ")}`
    : "Auth-gated usage probes failed while health succeeded.";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function gatewayRequestError(
  label: string,
  source: GatewayProbeSource,
  response: Response,
): Promise<GatewayRequestError> {
  let bodyPreview: string;
  try {
    bodyPreview = (await response.text()).slice(0, 240);
  } catch {
    bodyPreview = "";
  }
  const blockedKeyHint = /key is blocked/i.test(bodyPreview)
    ? " Active gateway key is blocked; run /login to paste a new key."
    : "";
  return new GatewayRequestError(
    `${label} request failed (${response.status}).${blockedKeyHint}`,
    source,
    response.status,
    bodyPreview,
  );
}

async function fetchMonthlyUsage(baseUrl: string, apiKey: string): Promise<GatewayMonthlyUsage> {
  const response = await fetchWithTimeout(
    `${toGatewayRootBaseUrl(baseUrl)}/user/info`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Monthly usage", "user-info", response);
  }

  const json = await response.json();
  const info = parseUserInfoPayload(json, "legacy");
  if (!info) {
    throw new Error("Monthly usage response is missing required fields.");
  }

  return monthlyUsageFromPayload(info);
}

async function fetchMonthlyUsageV2(
  baseUrl: string,
  apiKey: string,
  userId: string,
): Promise<GatewayMonthlyUsage> {
  const url = new URL(`${toGatewayRootBaseUrl(baseUrl)}/v2/user/info`);
  url.searchParams.set("user_id", userId);
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Monthly usage v2", "user-info", response);
  }

  const json = await response.json();
  const info = parseUserInfoPayload(json, "v2");
  if (!info) {
    throw new Error("Monthly usage v2 response is missing required fields.");
  }

  return monthlyUsageFromPayload(info);
}

function parseUserInfoPayload(raw: unknown, shape: "legacy" | "v2"): GatewayUserInfoPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const candidate = shape === "legacy" ? record.user_info : record;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const info = candidate as GatewayUserInfoPayload;
  return typeof info.max_budget === "number" && typeof info.spend === "number" ? info : null;
}

function monthlyUsageFromPayload(info: GatewayUserInfoPayload): GatewayMonthlyUsage {
  const maxBudget = info.max_budget!;
  const spend = info.spend!;
  return {
    maxBudget,
    spend,
    remaining: maxBudget - spend,
    budgetResetAt: info.budget_reset_at ?? "",
    budgetDuration: info.budget_duration ?? "",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchKeyInfo(baseUrl: string, apiKey: string): Promise<GatewayKeyInfoWithUserId> {
  const response = await fetchWithTimeout(
    `${toGatewayRootBaseUrl(baseUrl)}/key/info`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Key info", "key-info", response);
  }

  const json = (await response.json()) as {
    info?: {
      spend?: number;
      rpm_limit?: number | null;
      tpm_limit?: number | null;
      key_name?: string | null;
      user_id?: string | null;
    };
  };

  const info = json.info;
  if (!info || typeof info.spend !== "number") {
    throw new Error("Key info response is missing required fields.");
  }

  return {
    spend: info.spend,
    rpmLimit: typeof info.rpm_limit === "number" ? info.rpm_limit : undefined,
    tpmLimit: typeof info.tpm_limit === "number" ? info.tpm_limit : undefined,
    keyName: typeof info.key_name === "string" ? info.key_name : undefined,
    fetchedAt: new Date().toISOString(),
    userId: typeof info.user_id === "string" && info.user_id.trim() ? info.user_id : undefined,
  };
}

async function fetchHealth(baseUrl: string, apiKey: string): Promise<GatewayHealth> {
  const response = await fetchWithTimeout(
    `${toGatewayRootBaseUrl(baseUrl)}/health/readiness`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Health", "health", response);
  }

  const json = (await response.json()) as {
    status?: string;
    litellm_version?: string;
    last_updated?: string;
  };

  if (!json || typeof json.status !== "string") {
    throw new Error("Health response is missing status.");
  }

  return {
    status: json.status,
    litellmVersion: typeof json.litellm_version === "string" ? json.litellm_version : undefined,
    lastUpdated: typeof json.last_updated === "string" ? json.last_updated : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch per-day activity metrics for the authenticated user from
 * `/user/daily/activity`. Covers `[today - days + 1, today]` (inclusive of
 * both boundaries) so a 7-day range returns up to seven entries including
 * the current day-in-progress.
 *
 * The gateway accepts the request from a non-admin `internal_user_viewer`
 * key and scopes results to the current user, so no extra role is required.
 * Returns a normalized `GatewayDailyActivity` sorted ascending by date.
 *
 * Exported for unit tests and the `usage-probe` command; production code
 * reaches it through the parallel refresh above.
 */
export async function fetchDailyActivity(
  baseUrl: string,
  apiKey: string,
  days: number,
): Promise<GatewayDailyActivity> {
  const clampedDays = Math.max(1, Math.min(30, Math.floor(days)));
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (clampedDays - 1));
  const startDate = toIsoDate(start);
  const endDate = toIsoDate(end);

  const url =
    `${toGatewayRootBaseUrl(baseUrl)}/user/daily/activity` +
    `?start_date=${startDate}&end_date=${endDate}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Daily activity", "daily-activity", response);
  }

  const json = (await response.json()) as {
    results?: Array<{
      date?: string;
      metrics?: Record<string, unknown>;
    }>;
  };

  const entries: GatewayDailyActivityEntry[] = [];
  for (const row of json.results ?? []) {
    if (typeof row.date !== "string") continue;
    const m = row.metrics ?? {};
    entries.push({
      date: row.date,
      spend: numberOr(m.spend, 0),
      promptTokens: numberOr(m.prompt_tokens, 0),
      completionTokens: numberOr(m.completion_tokens, 0),
      cacheReadInputTokens: numberOr(m.cache_read_input_tokens, 0),
      cacheCreationInputTokens: numberOr(m.cache_creation_input_tokens, 0),
      totalTokens: numberOr(m.total_tokens, 0),
      successfulRequests: numberOr(m.successful_requests, 0),
      failedRequests: numberOr(m.failed_requests, 0),
      apiRequests: numberOr(m.api_requests, 0),
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  return {
    entries,
    startDate,
    endDate,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch the number of keys this user owns on the gateway via `/key/list`.
 * Accepts `internal_user_viewer` role. The endpoint returns an array of
 * hashed key ids; this function only surfaces the count so no sensitive
 * material is stored or logged.
 *
 * Exported for unit tests.
 */
export async function fetchKeyList(baseUrl: string, apiKey: string): Promise<GatewayKeyList> {
  const response = await fetchWithTimeout(
    `${toGatewayRootBaseUrl(baseUrl)}/key/list`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayRequestError("Key list", "key-list", response);
  }

  const json = (await response.json()) as {
    keys?: unknown[];
    total_count?: number;
  };
  const count =
    typeof json.total_count === "number"
      ? json.total_count
      : Array.isArray(json.keys)
        ? json.keys.length
        : 0;
  return { count, fetchedAt: new Date().toISOString() };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
