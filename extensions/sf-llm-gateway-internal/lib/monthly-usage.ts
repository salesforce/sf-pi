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
  GatewayHealth,
  GatewayKeyInfo,
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
  GatewayHealth,
  GatewayKeyInfo,
  GatewayMonthlyUsage,
} from "../../../lib/common/monthly-usage/store.ts";

export { getMonthlyUsageState };

let lastFetchAt = 0;
let refreshInFlight: Promise<void> | null = null;

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
      publishError("Missing base URL configuration.");
      lastFetchAt = Date.now();
      return;
    }

    if (!config.apiKey) {
      publishError(`Missing ${API_KEY_ENV} or saved API key.`);
      lastFetchAt = Date.now();
      return;
    }

    // Fire all three in parallel. Each branch resolves to either the parsed
    // payload or a recorded error — a single slow endpoint must not stall
    // the others.
    const [usageResult, keyResult, healthResult] = await Promise.allSettled([
      fetchMonthlyUsage(config.baseUrl, config.apiKey),
      fetchKeyInfo(config.baseUrl, config.apiKey),
      fetchHealth(config.baseUrl, config.apiKey),
    ]);

    const snapshot: MonthlyUsageSnapshot = {
      monthlyUsage: null,
      monthlyUsageError: null,
      keyInfo: null,
      keyInfoError: null,
      health: null,
      healthError: null,
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

    setMonthlyUsageState(snapshot);
    lastFetchAt = Date.now();
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function publishError(message: string): void {
  setMonthlyUsageState({
    monthlyUsage: null,
    monthlyUsageError: message,
    keyInfo: null,
    keyInfoError: message,
    health: null,
    healthError: message,
  });
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
    throw new Error(`Monthly usage request failed (${response.status}).`);
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
    throw new Error(`Key info request failed (${response.status}).`);
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
    throw new Error(`Health request failed (${response.status}).`);
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
