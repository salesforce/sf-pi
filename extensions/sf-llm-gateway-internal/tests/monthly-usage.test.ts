/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for gateway usage refresh and connection-status classification. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMonthlyUsageStoreForTests,
  getMonthlyUsageState,
} from "../../../lib/common/monthly-usage/store.ts";
import { API_KEY_ENV, BASE_URL_ENV } from "../lib/config.ts";
import {
  fetchDailyActivity,
  fetchKeyList,
  registerGatewayMonthlyUsageRefresher,
} from "../lib/monthly-usage.ts";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env[BASE_URL_ENV];
const originalApiKey = process.env[API_KEY_ENV];

describe("gateway monthly usage refresh", () => {
  afterEach(() => {
    __resetMonthlyUsageStoreForTests();
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

  it("publishes daily activity alongside the other probes", async () => {
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
      const snapshot = getMonthlyUsageState();
      expect(snapshot.dailyActivityError).toBeNull();
      expect(snapshot.dailyActivity?.entries).toHaveLength(2);
      expect(snapshot.dailyActivity?.entries[0]).toMatchObject({
        date: "2026-05-04",
        spend: 1.25,
        failedRequests: 0,
        apiRequests: 100,
      });
      // Sorted ascending by date.
      expect(snapshot.dailyActivity?.entries[1].date).toBe("2026-05-05");
      // Connection status stays "connected" regardless of daily activity.
      expect(snapshot.connectionStatus?.kind).toBe("connected");
    } finally {
      unregister();
    }
  });

  it("publishes the key-list count alongside other probes", async () => {
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
      const snapshot = getMonthlyUsageState();
      expect(snapshot.dailyActivity).toBeNull();
      expect(snapshot.dailyActivityError).toMatch(/Daily activity/);
      expect(snapshot.connectionStatus?.kind).toBe("connected");
    } finally {
      unregister();
    }
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
}): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/user/info")) {
      return jsonResponse(options.userStatus, {
        user_info: {
          max_budget: 3000,
          spend: 42,
          budget_reset_at: "2026-06-01",
          budget_duration: "1mo",
        },
      });
    }
    if (url.endsWith("/key/info")) {
      return jsonResponse(options.keyStatus, {
        info: { spend: 7, key_name: "sk-...test", rpm_limit: 100, tpm_limit: 1000 },
      });
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
