/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for gateway usage refresh and connection-status classification. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMonthlyUsageCacheForTests } from "../../../lib/common/monthly-usage/cache.ts";
import {
  __resetMonthlyUsageStoreForTests,
  getMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { API_KEY_ENV, BASE_URL_ENV } from "../lib/config.ts";
import {
  computeKeyConflict,
  fetchDailyActivity,
  fetchKeyList,
  refreshUsageDetails,
  registerGatewayMonthlyUsageRefresher,
} from "../lib/monthly-usage.ts";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env[BASE_URL_ENV];
const originalApiKey = process.env[API_KEY_ENV];

describe("gateway monthly usage refresh", () => {
  beforeEach(() => {
    __resetMonthlyUsageStoreForTests();
    __resetMonthlyUsageCacheForTests();
  });

  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
    __resetMonthlyUsageCacheForTests();
    globalThis.fetch = originalFetch;
    restoreEnv(BASE_URL_ENV, originalBaseUrl);
    restoreEnv(API_KEY_ENV, originalApiKey);
    vi.restoreAllMocks();
  });

  it("publishes not-configured when credentials are missing", async () => {
    delete process.env[BASE_URL_ENV];
    delete process.env[API_KEY_ENV];
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({ baseUrl: "", apiKey: "" });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "not-configured",
        source: "config",
      });
    } finally {
      unregister();
    }
  });

  it("publishes connected only after an auth-gated usage endpoint succeeds", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({ userStatus: 200, keyStatus: 200, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "connected",
        source: "user-info",
      });
    } finally {
      unregister();
    }
  });

  it("does not treat readiness success alone as connected when auth-gated probes fail", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "bad-key";
    mockGatewayFetch({ userStatus: 401, keyStatus: 401, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({ baseUrl: "https://gateway.example.test", apiKey: "bad-key" });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "auth-failed",
      });
    } finally {
      unregister();
    }
  });

  it("reports degraded, not unreachable, when health succeeds but usage probes fail", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({ userStatus: 500, keyStatus: 500, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "degraded",
        source: "health",
      });
      expect(getMonthlyUsageState().connectionStatus?.detail).toContain("health succeeded");
    } finally {
      unregister();
    }
  });

  it("adds blocked-key guidance to auth failure details", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "blocked-key";
    mockGatewayFetch({
      userStatus: 401,
      keyStatus: 401,
      healthStatus: 200,
      authBody: { error: { message: "Authentication Error, Key is blocked." } },
    });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "blocked-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);

      expect(getMonthlyUsageState().connectionStatus).toMatchObject({
        kind: "auth-failed",
      });
      expect(getMonthlyUsageState().connectionStatus?.detail).toContain("/login");
    } finally {
      unregister();
    }
  });

  it("publishes daily activity from refreshUsageDetails (split out of primary refresh)", async () => {
    // Phase 1.4: daily-activity moved off the boot hot path. The primary
    // refresh no longer fetches it; refreshUsageDetails does, called from
    // /sf-llm-gateway panel and the first turn_end.
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({
      userStatus: 200,
      keyStatus: 200,
      healthStatus: 200,
      dailyStatus: 200,
    });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      // Primary refresh leaves daily empty— it's split out now.
      expect(getMonthlyUsageState().dailyActivity).toBeNull();
      expect(getMonthlyUsageState().connectionStatus?.kind).toBe("connected");

      await refreshUsageDetails(true, cwd);
      const snapshot = getMonthlyUsageState();
      expect(snapshot.dailyActivityError).toBeNull();
      expect(snapshot.dailyActivity?.entries).toHaveLength(2);
      expect(snapshot.dailyActivity?.entries[0]).toMatchObject({
        date: "2026-05-04",
        spend: 1.25,
      });
      // Connection status survives the details refresh untouched.
      expect(snapshot.connectionStatus?.kind).toBe("connected");
    } finally {
      unregister();
    }
  });

  it("publishes the key-list count via refreshUsageDetails", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({
      userStatus: 200,
      keyStatus: 200,
      healthStatus: 200,
      dailyStatus: 200,
      keyListStatus: 200,
    });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      // Not part of primary refresh.
      expect(getMonthlyUsageState().keyList).toBeNull();

      await refreshUsageDetails(true, cwd);
      const snapshot = getMonthlyUsageState();
      expect(snapshot.keyList).toMatchObject({ count: 4 });
      expect(snapshot.keyListError).toBeNull();
    } finally {
      unregister();
    }
  });

  it("keeps connection-status connected when only daily activity fails", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({
      userStatus: 200,
      keyStatus: 200,
      healthStatus: 200,
      dailyStatus: 500,
    });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      await refreshUsageDetails(true, cwd);
      const snapshot = getMonthlyUsageState();
      expect(snapshot.dailyActivity).toBeNull();
      expect(snapshot.dailyActivityError).toMatch(/Daily activity/);
      // Primary status untouched by failed details fetch.
      expect(snapshot.connectionStatus?.kind).toBe("connected");
    } finally {
      unregister();
    }
  });

  // Phase 1.1: announce "checking" status before probes complete so first-paint
  // UIs render "Checking…" instead of empty/last-error state.
  it("publishes a `checking` status before probes resolve", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    let resolveProbes: (() => void) | undefined;
    const block = new Promise<void>((resolve) => {
      resolveProbes = resolve;
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      // Don't return until the test inspects the in-flight "checking" state.
      await block;
      const url = String(input);
      if (url.endsWith("/health/readiness")) {
        return jsonResponse(200, { status: "connected" });
      }
      if (url.endsWith("/user/info")) {
        return jsonResponse(200, {
          user_info: { max_budget: 100, spend: 1, budget_reset_at: "", budget_duration: "" },
        });
      }
      return jsonResponse(200, { info: { spend: 1 } });
    }) as typeof fetch;

    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      const refreshDone = getMonthlyUsageStateRefresh(true, cwd);
      // Drain microtasks until the inner IIFE has run past `publishChecking`.
      // The store-level `refreshMonthlyUsage` adapter awaits our refresher,
      // and our refresher awaits an inner IIFE — needs a setImmediate hop
      // to let those nested awaits all resume before we observe state.
      await new Promise((r) => setImmediate(r));
      expect(getMonthlyUsageState().connectionStatus?.kind).toBe("checking");

      resolveProbes!();
      await refreshDone;
      expect(getMonthlyUsageState().connectionStatus?.kind).toBe("connected");
    } finally {
      unregister();
    }
  });

  // Phase 1.3: AbortError on every primary probe is classified as `unreachable`
  // with `timedOut: true` so UIs can render "Slow" instead of "Unreachable".
  it("sets timedOut on the connection status when every probe aborts", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("timed out");
      e.name = "AbortError";
      throw e;
    }) as typeof fetch;

    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      const status = getMonthlyUsageState().connectionStatus;
      expect(status?.kind).toBe("unreachable");
      expect(status?.timedOut).toBe(true);
      // Phase 1.2: retry attempted once before classifying as unreachable.
      expect(status?.retried).toBe(true);
    } finally {
      unregister();
    }
  }, 10_000);

  // Phase 1.2: one-shot retry recovers a probe that succeeds on the second attempt.
  it("recovers a transient unreachable when the retry succeeds", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    let attempt = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      attempt += 1;
      // First attempt: AbortError on every probe (3 calls total). Second attempt: 200s.
      if (attempt <= 3) {
        const e = new Error("timed out");
        e.name = "AbortError";
        throw e;
      }
      const url = String(input);
      if (url.endsWith("/user/info")) {
        return jsonResponse(200, {
          user_info: { max_budget: 100, spend: 1, budget_reset_at: "", budget_duration: "" },
        });
      }
      if (url.endsWith("/key/info")) return jsonResponse(200, { info: { spend: 1 } });
      return jsonResponse(200, { status: "connected" });
    }) as typeof fetch;

    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      expect(getMonthlyUsageState().connectionStatus?.kind).toBe("connected");
      // Trace records the *final* state — only the successful 3 calls.
      expect(getMonthlyUsageState().lastProbeTrace?.entries).toHaveLength(3);
      expect(getMonthlyUsageState().lastProbeTrace?.wasRetry).toBe(true);
    } finally {
      unregister();
    }
  }, 10_000);

  // Phase 3.1: lastProbeTrace captures per-endpoint timing on every refresh.
  it("captures a per-endpoint trace in lastProbeTrace", async () => {
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    mockGatewayFetch({ userStatus: 200, keyStatus: 200, healthStatus: 200 });
    const unregister = registerGatewayMonthlyUsageRefresher();
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });

    try {
      await getMonthlyUsageStateRefresh(true, cwd);
      const trace = getMonthlyUsageState().lastProbeTrace;
      expect(trace).toBeDefined();
      expect(trace?.wasRetry).toBe(false);
      const sources = trace!.entries.map((e) => e.source).sort();
      expect(sources).toEqual(["health", "key-info", "user-info"]);
      expect(trace!.entries.every((e) => e.ok)).toBe(true);
    } finally {
      unregister();
    }
  });
});

// Phase 1.6: cross-source key-conflict detection.
describe("computeKeyConflict", () => {
  afterEach(() => {
    restoreEnv(API_KEY_ENV, originalApiKey);
  });

  it("returns null when keys match", () => {
    process.env[API_KEY_ENV] = "sk-same";
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "sk-same",
    });
    expect(computeKeyConflict(cwd)).toBeNull();
  });

  it("returns null when only one source is set", () => {
    delete process.env[API_KEY_ENV];
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "sk-saved",
    });
    expect(computeKeyConflict(cwd)).toBeNull();
  });

  it("returns a warning with hashed prefixes when keys differ", () => {
    process.env[API_KEY_ENV] = "sk-env-blocked";
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "sk-saved-active",
    });
    const warning = computeKeyConflict(cwd);
    expect(warning).not.toBeNull();
    expect(warning?.active).toBe("saved");
    expect(warning?.envKeyHash).toHaveLength(8);
    expect(warning?.savedKeyHash).toHaveLength(8);
    expect(warning?.envKeyHash).not.toEqual(warning?.savedKeyHash);
    // Never logs the raw key.
    expect(warning?.message).not.toContain("sk-env-blocked");
    expect(warning?.message).not.toContain("sk-saved-active");
    expect(warning?.message).toContain(warning!.envKeyHash);
  });
});

describe("fetchKeyList", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("prefers total_count, falls back to keys.length", async () => {
    const responses = [
      jsonResponse(200, { keys: ["h1", "h2", "h3"], total_count: 5 }),
      jsonResponse(200, { keys: ["h1", "h2"] }),
      jsonResponse(200, {}),
    ];
    globalThis.fetch = vi.fn(async () => responses.shift()!) as typeof fetch;

    expect((await fetchKeyList("https://gateway.example.test", "k")).count).toBe(5);
    expect((await fetchKeyList("https://gateway.example.test", "k")).count).toBe(2);
    expect((await fetchKeyList("https://gateway.example.test", "k")).count).toBe(0);
  });

  it("throws a structured error on 401", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, { error: "Authentication Error" }),
    ) as typeof fetch;
    await expect(fetchKeyList("https://gateway.example.test", "k")).rejects.toThrow(
      /Key list request failed/,
    );
  });
});

describe("fetchDailyActivity", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("clamps the days window to [1, 30] and sends start/end params", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse(200, { results: [] });
    }) as typeof fetch;

    await fetchDailyActivity("https://gateway.example.test", "key", 7);
    expect(calls[0]).toContain("/user/daily/activity");
    expect(calls[0]).toMatch(/start_date=\d{4}-\d{2}-\d{2}/);
    expect(calls[0]).toMatch(/end_date=\d{4}-\d{2}-\d{2}/);

    // days < 1 clamps to 1, days > 30 clamps to 30.
    await fetchDailyActivity("https://gateway.example.test", "key", 0);
    await fetchDailyActivity("https://gateway.example.test", "key", 999);
    const today = new Date().toISOString().slice(0, 10);
    for (const call of calls.slice(1)) {
      expect(call).toContain(`end_date=${today}`);
    }
  });

  it("gracefully handles an empty results array", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { results: [] })) as typeof fetch;
    const result = await fetchDailyActivity("https://gateway.example.test", "key", 7);
    expect(result.entries).toEqual([]);
    expect(result.startDate).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(result.endDate).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("throws a structured error on 401", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Authentication Error" } }),
    ) as typeof fetch;
    await expect(fetchDailyActivity("https://gateway.example.test", "key", 7)).rejects.toThrow(
      /Daily activity request failed/,
    );
  });
});

async function getMonthlyUsageStateRefresh(force: boolean, cwd: string): Promise<void> {
  const { refreshMonthlyUsage } = await import("../../../lib/common/monthly-usage/store.ts");
  await refreshMonthlyUsage(force, cwd);
}

function createProjectConfig(config: { baseUrl: string; apiKey: string }): string {
  const cwd = mkdtempSync(join(tmpdir(), "sf-pi-gateway-test-"));
  const configDir = join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "sf-llm-gateway-internal.json"),
    `${JSON.stringify({ enabled: true, ...config })}\n`,
  );
  return cwd;
}

function mockGatewayFetch(options: {
  userStatus: number;
  keyStatus: number;
  healthStatus: number;
  dailyStatus?: number;
  keyListStatus?: number;
  authBody?: unknown;
}): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/user/info")) {
      return jsonResponse(
        options.userStatus,
        options.userStatus === 401 && options.authBody
          ? options.authBody
          : {
              user_info: {
                max_budget: 3000,
                spend: 42,
                budget_reset_at: "2026-06-01",
                budget_duration: "1mo",
              },
            },
      );
    }
    if (url.endsWith("/key/info")) {
      return jsonResponse(
        options.keyStatus,
        options.keyStatus === 401 && options.authBody
          ? options.authBody
          : {
              info: { spend: 7, key_name: "sk-...test", rpm_limit: 100, tpm_limit: 1000 },
            },
      );
    }
    if (url.endsWith("/health/readiness")) {
      return jsonResponse(options.healthStatus, { status: "connected" });
    }
    if (url.endsWith("/key/list")) {
      return jsonResponse(options.keyListStatus ?? 200, {
        keys: ["h1", "h2", "h3", "h4"],
        total_count: 4,
      });
    }
    if (url.includes("/user/daily/activity")) {
      return jsonResponse(options.dailyStatus ?? 200, {
        results: [
          {
            date: "2026-05-05",
            metrics: {
              spend: 2.5,
              prompt_tokens: 2000,
              completion_tokens: 500,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 200,
              total_tokens: 3700,
              successful_requests: 200,
              failed_requests: 0,
              api_requests: 200,
            },
          },
          {
            date: "2026-05-04",
            metrics: {
              spend: 1.25,
              prompt_tokens: 1000,
              completion_tokens: 250,
              cache_read_input_tokens: 500,
              cache_creation_input_tokens: 100,
              total_tokens: 1850,
              successful_requests: 100,
              failed_requests: 0,
              api_requests: 100,
            },
          },
        ],
      });
    }
    return jsonResponse(404, { error: "not found" });
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
