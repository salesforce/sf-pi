/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Monthly usage + per-key + gateway health fetcher.
 *
 * The gateway exposes three complementary endpoints:
 *   - `/user/info`        → monthly budget + spend for the whole user
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
import type {
  GatewayConnectionStatus,
  GatewayDailyActivity,
  GatewayDailyActivityEntry,
  GatewayHealth,
  GatewayKeyInfo,
  GatewayKeyList,
  GatewayMonthlyUsage,
  MonthlyUsageSnapshot,
} from "../../../lib/common/monthly-usage/store.ts";
import {
  clearMonthlyUsageState,
  getMonthlyUsageState,
  registerMonthlyUsageRefresher,
  setMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { API_KEY_ENV, getGatewayConfig } from "./config.ts";
import { toGatewayRootBaseUrl } from "./gateway-url.ts";
import { fetchWithTimeout } from "./models.ts";

// Short TTL so the `💰 $N/∞` pill refreshes roughly once a minute even
// during back-to-back turns. The gateway endpoints are cheap GETs and this
// is still bounded by how often a consumer (footer repaint on turn_end)
// actually asks for a refresh, so the request rate stays reasonable.
const MONTHLY_USAGE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

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

/**
 * Register the gateway refresher with the shared store. Call once at
 * session_start. Returns the unregister handle for session_shutdown.
 */
export function registerGatewayMonthlyUsageRefresher(): () => void {
  const unregister = registerMonthlyUsageRefresher(refreshMonthlyUsage);
  return () => {
    unregister();
    clearMonthlyUsageState();
    lastFetchAt = 0;
    refreshInFlight = null;
  };
}

export async function refreshMonthlyUsage(force: boolean, cwd: string): Promise<void> {
  if (!force && lastFetchAt > 0 && Date.now() - lastFetchAt < MONTHLY_USAGE_TTL_MS) {
    return;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const config = getGatewayConfig(cwd);
    if (!config.baseUrl) {
      publishError("Missing base URL configuration.", {
        kind: "not-configured",
        detail: "Missing base URL configuration.",
        checkedAt: new Date().toISOString(),
        source: "config",
      });
      lastFetchAt = Date.now();
      return;
    }

    if (!config.apiKey) {
      const message = `Missing ${API_KEY_ENV} or saved API key.`;
      publishError(message, {
        kind: "not-configured",
        detail: message,
        checkedAt: new Date().toISOString(),
        source: "config",
      });
      lastFetchAt = Date.now();
      return;
    }

    // Fire all four in parallel. Each branch resolves to either the parsed
    // payload or a recorded error — a single slow endpoint must not stall
    // the others. Daily activity is additive: a failure here does not
    // downgrade the connection-status classification, which is gated on
    // the three primary probes (user-info, key-info, health).
    const [usageResult, keyResult, healthResult, dailyResult, keyListResult] =
      await Promise.allSettled([
        fetchMonthlyUsage(config.baseUrl, config.apiKey),
        fetchKeyInfo(config.baseUrl, config.apiKey),
        fetchHealth(config.baseUrl, config.apiKey),
        fetchDailyActivity(config.baseUrl, config.apiKey, DAILY_ACTIVITY_DEFAULT_DAYS),
        fetchKeyList(config.baseUrl, config.apiKey),
      ]);

    const snapshot: MonthlyUsageSnapshot = {
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
    };

    if (usageResult.status === "fulfilled") {
      snapshot.monthlyUsage = { ...usageResult.value, error: undefined };
    } else {
      snapshot.monthlyUsageError =
        usageResult.reason instanceof Error
          ? usageResult.reason.message
          : String(usageResult.reason);
    }

    if (keyResult.status === "fulfilled") {
      snapshot.keyInfo = keyResult.value;
    } else {
      snapshot.keyInfoError =
        keyResult.reason instanceof Error ? keyResult.reason.message : String(keyResult.reason);
    }

    if (healthResult.status === "fulfilled") {
      snapshot.health = healthResult.value;
    } else {
      snapshot.healthError =
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : String(healthResult.reason);
    }

    if (dailyResult.status === "fulfilled") {
      snapshot.dailyActivity = dailyResult.value;
    } else {
      snapshot.dailyActivityError =
        dailyResult.reason instanceof Error
          ? dailyResult.reason.message
          : String(dailyResult.reason);
    }

    if (keyListResult.status === "fulfilled") {
      snapshot.keyList = keyListResult.value;
    } else {
      snapshot.keyListError =
        keyListResult.reason instanceof Error
          ? keyListResult.reason.message
          : String(keyListResult.reason);
    }

    snapshot.connectionStatus = resolveConnectionStatus(usageResult, keyResult, healthResult);
    setMonthlyUsageState(snapshot);
    lastFetchAt = Date.now();
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function publishError(message: string, connectionStatus: GatewayConnectionStatus): void {
  setMonthlyUsageState({
    monthlyUsage: null,
    monthlyUsageError: message,
    keyInfo: null,
    keyInfoError: message,
    health: null,
    healthError: message,
    connectionStatus,
  });
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

  const unreachable = failures.find((error) => !(error instanceof GatewayRequestError));
  if (unreachable) {
    return { kind: "unreachable", detail: formatError(unreachable), checkedAt };
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
  return new GatewayRequestError(
    `${label} request failed (${response.status}).`,
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

  const json = (await response.json()) as {
    user_info?: {
      max_budget?: number;
      spend?: number;
      budget_reset_at?: string;
      budget_duration?: string;
    };
  };

  const info = json.user_info;
  if (!info || typeof info.max_budget !== "number" || typeof info.spend !== "number") {
    throw new Error("Monthly usage response is missing required fields.");
  }

  return {
    maxBudget: info.max_budget,
    spend: info.spend,
    remaining: info.max_budget - info.spend,
    budgetResetAt: info.budget_reset_at ?? "",
    budgetDuration: info.budget_duration ?? "",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchKeyInfo(baseUrl: string, apiKey: string): Promise<GatewayKeyInfo> {
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
