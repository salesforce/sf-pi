/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for gateway status formatting helpers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_KEY_ENV,
  SAVED_CONFIG_FILE,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  writeGatewaySavedConfig,
} from "../lib/config.ts";

const originalHomeEnv = process.env.HOME;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalAsciiIconsEnv = process.env.SF_PI_ASCII_ICONS;
import {
  buildFooterStatus,
  buildStatusReport,
  formatDailyActivityReportLine,
  formatKeyListReportLine,
  formatSparkline,
  getApiKeyGuidanceLines,
  summarizeApiKeyGuidance,
} from "../lib/status.ts";
const originalApiKeyEnv = process.env[API_KEY_ENV];
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalApiKeyEnv === undefined) {
    delete process.env[API_KEY_ENV];
  } else {
    process.env[API_KEY_ENV] = originalApiKeyEnv;
  }

  if (originalHomeEnv === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHomeEnv;
  }

  if (originalAsciiIconsEnv === undefined) {
    delete process.env.SF_PI_ASCII_ICONS;
  } else {
    process.env.SF_PI_ASCII_ICONS = originalAsciiIconsEnv;
  }

  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Fill in the new keyInfo/health fields so tests written before those
 * properties were added keep working without needing to know about them.
 */
function withDefaults(partial: Record<string, unknown>) {
  return {
    keyInfo: null,
    keyInfoError: null,
    health: null,
    healthError: null,
    ...partial,
  } as any;
}

describe("buildFooterStatus", () => {
  it("returns monthly usage with spend and infinity budget", () => {
    const text = buildFooterStatus(
      withDefaults({
        discovery: {
          modelIds: ["claude-opus-4-6-v1"],
          source: "gateway",
          discoveredAt: new Date().toISOString(),
        },
        monthlyUsage: {
          maxBudget: 100,
          spend: 12.5,
          remaining: 87.5,
          budgetResetAt: "2026-05-01",
          budgetDuration: "month",
          fetchedAt: new Date().toISOString(),
        },
        monthlyUsageError: null,
      }),
    );

    // Should only contain the monthly spend with infinity, not model/context info
    expect(text).toBe("💰 $12.50/∞");
    expect(text).not.toContain("Opus");
    expect(text).not.toContain("ctx");
    expect(text).not.toContain("SF LLM Gateway");
  });

  it("omits the monthly icon in ascii glyph mode to avoid duplicate dollars", () => {
    process.env.SF_PI_ASCII_ICONS = "1";

    const text = buildFooterStatus(
      withDefaults({
        discovery: null,
        monthlyUsage: {
          maxBudget: 100,
          spend: 12.5,
          remaining: 87.5,
          budgetResetAt: "2026-05-01",
          budgetDuration: "month",
          fetchedAt: new Date().toISOString(),
        },
        monthlyUsageError: null,
      }),
    );

    expect(text).toBe("$12.50/∞");
  });

  it("returns loading state when monthly usage is not yet fetched", () => {
    const text = buildFooterStatus(
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
      }),
    );

    expect(text).toBe("💰 loading…");
  });

  it("returns unavailable state when monthly usage fetch failed", () => {
    const text = buildFooterStatus(
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: "fetch failed",
      }),
    );

    expect(text).toBe("💰 unavailable");
  });

  it("returns calm last-known usage when the latest monthly usage fetch failed", () => {
    const text = buildFooterStatus(
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: "fetch failed",
        lastKnownMonthlyUsage: {
          maxBudget: 100,
          spend: 12.5,
          remaining: 87.5,
          budgetResetAt: "2026-05-01",
          budgetDuration: "month",
          fetchedAt: new Date().toISOString(),
        },
      }),
    );

    expect(text).toBe("💰 $12.50/∞ ↺ last known");
  });
});

describe("buildStatusReport", () => {
  it("shows discovery details", () => {
    process.env.HOME = makeTempDir("gateway-home-");

    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      modelRegistry: {
        getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
      },
      getContextUsage: () => null,
    } as any;

    const report = buildStatusReport(
      ctx,
      true,
      withDefaults({
        discovery: {
          modelIds: ["claude-opus-4-6-v1", "gpt-5"],
          source: "gateway",
          discoveredAt: new Date().toISOString(),
        },
        monthlyUsage: null,
        monthlyUsageError: "not loaded yet",
      }),
    );

    expect(report).toContain("Provider registered: yes");
    expect(report).toContain(
      "Saved scope fallback: project=inherit, global=inherit, effective=additive (default)",
    );
    expect(report).toContain(
      "Effective scoped model mode: additive (preserve existing scoped models)",
    );
    expect(report).toContain("Model discovery: gateway");
    expect(report).toContain("Discovered models: 2");
  });
});

describe("formatSparkline", () => {
  it("returns an empty string for an empty series", () => {
    expect(formatSparkline([])).toBe("");
  });

  it("renders an all-zero series as the minimum block for every day", () => {
    expect(formatSparkline([0, 0, 0])).toBe("\u2581\u2581\u2581");
  });

  it("scales values into eight bar heights", () => {
    const out = formatSparkline([1, 2, 4, 8]);
    expect(out).toHaveLength(4);
    // First entry is the smallest, last entry is the largest block.
    expect(out[0]).toBe("\u2581");
    expect(out[3]).toBe("\u2588");
  });
});

describe("API key guidance", () => {
  it("reports legacy and environment fallback presence without comparing values", () => {
    const cwd = makeTempDir("gateway-key-guidance-");
    const configDir = path.join(cwd, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, SAVED_CONFIG_FILE),
      `${JSON.stringify({ enabled: true, baseUrl: "https://gateway.example.test", apiKey: "saved-key" })}\n`,
    );
    process.env[API_KEY_ENV] = "env-key";

    const lines = getApiKeyGuidanceLines(
      cwd,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
      }),
    );

    expect(lines.join("\n")).toContain("no longer used for authentication");
    expect(lines.join("\n")).toContain("remove-legacy-token");
    expect(lines.join("\n")).toContain("automation fallback");
    expect(lines.join("\n")).toContain("/login");
    expect(lines.join("\n")).not.toContain("saved-key");
    expect(lines.join("\n")).not.toContain("env-key");
  });

  it("detects a global legacy field even when project scope has a blank field", () => {
    delete process.env[API_KEY_ENV];
    const cwd = makeTempDir("gateway-key-guidance-project-");
    process.env.PI_CODING_AGENT_DIR = makeTempDir("gateway-key-guidance-agent-");
    writeGatewaySavedConfig(globalGatewayConfigPath(), { apiKey: "global-inactive-key" });
    writeGatewaySavedConfig(projectGatewayConfigPath(cwd), { apiKey: "" });

    const lines = getApiKeyGuidanceLines(
      cwd,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
      }),
    );

    expect(lines.join("\n")).toContain("no longer used for authentication");
    expect(lines.join("\n")).not.toContain("global-inactive-key");
  });

  it("points rejected keys and multiple-key accounts at rotation/pruning guidance", () => {
    const cwd = makeTempDir("gateway-key-guidance-");
    const summary = summarizeApiKeyGuidance(
      cwd,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
        connectionStatus: { kind: "auth-failed", source: "user-info" },
        keyInfo: { spend: 1, keyName: "sk-...active", fetchedAt: new Date().toISOString() },
        keyList: { count: 3, fetchedAt: new Date().toISOString() },
      }),
    );

    expect(summary).toContain("/login");
  });
});

describe("formatKeyListReportLine", () => {
  const fetchedAt = new Date().toISOString();

  it("falls back to the error when both args are missing", () => {
    expect(formatKeyListReportLine(null, null)).toBe("not loaded yet");
    expect(formatKeyListReportLine(null, "boom")).toBe("boom");
  });

  it("renders the count plus the active key name when ≤ 1 key", () => {
    expect(formatKeyListReportLine({ count: 1, fetchedAt }, null, "sk-...abc")).toBe(
      "1, active: sk-...abc",
    );
    expect(formatKeyListReportLine({ count: 0, fetchedAt }, null)).toBe("0");
  });

  it("warns when multiple keys are on file", () => {
    const line = formatKeyListReportLine({ count: 4, fetchedAt }, null, "sk-...def");
    expect(line).toContain("4");
    expect(line).toContain("pruning old keys");
    expect(line).toContain("sk-...def");
  });
});

describe("formatDailyActivityReportLine", () => {
  it("shows not-loaded-yet when both args are null", () => {
    expect(formatDailyActivityReportLine(null, null)).toBe("not loaded yet");
  });

  it("returns the error message when only the error is present", () => {
    expect(formatDailyActivityReportLine(null, "boom")).toBe("boom");
  });

  it("renders totals plus a sparkline when entries are present", () => {
    const line = formatDailyActivityReportLine(
      {
        entries: [
          {
            date: "2026-05-04",
            spend: 1.25,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            totalTokens: 0,
            successfulRequests: 100,
            failedRequests: 0,
            apiRequests: 100,
          },
          {
            date: "2026-05-05",
            spend: 2.5,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            totalTokens: 0,
            successfulRequests: 195,
            failedRequests: 5,
            apiRequests: 200,
          },
        ],
        startDate: "2026-05-04",
        endDate: "2026-05-05",
        fetchedAt: new Date().toISOString(),
      },
      null,
    );

    expect(line).toContain("$3.75");
    expect(line).toContain("300 requests");
    expect(line).toContain("(5 failed");
    expect(line).toContain("\u26A0"); // warning glyph when failures > 0
    expect(line).toContain("spend:");
  });
});
