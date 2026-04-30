/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for gateway status formatting helpers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BETAS_ENV } from "../lib/config.ts";

const originalHomeEnv = process.env.HOME;
import { buildFooterStatus, buildStatusReport } from "../lib/status.ts";
import { KNOWN_BETAS } from "../lib/models.ts";

const originalBetasEnv = process.env[BETAS_ENV];
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalBetasEnv === undefined) {
    delete process.env[BETAS_ENV];
  } else {
    process.env[BETAS_ENV] = originalBetasEnv;
  }

  if (originalHomeEnv === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHomeEnv;
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
    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      getContextUsage: () => ({ tokens: 120_000, contextWindow: 1_000_000 }),
    } as any;

    const text = buildFooterStatus(
      ctx,
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
        runtimeBetaOverrides: null,
        runtimeExtraBetas: new Set(),
      }),
    );

    // Should only contain the monthly spend with infinity, not model/context info
    expect(text).toBe("💰 $12.50/∞");
    expect(text).not.toContain("Opus");
    expect(text).not.toContain("ctx");
    expect(text).not.toContain("SF LLM Gateway");
  });

  it("returns loading state when monthly usage is not yet fetched", () => {
    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      getContextUsage: () => null,
    } as any;

    const text = buildFooterStatus(
      ctx,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
        runtimeBetaOverrides: null,
        runtimeExtraBetas: new Set(),
      }),
    );

    expect(text).toBe("💰 loading…");
  });

  it("returns unavailable state when monthly usage fetch failed", () => {
    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      getContextUsage: () => null,
    } as any;

    const text = buildFooterStatus(
      ctx,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: "fetch failed",
        runtimeBetaOverrides: null,
        runtimeExtraBetas: new Set(),
      }),
    );

    expect(text).toBe("💰 unavailable");
  });
});

describe("buildStatusReport", () => {
  it("shows discovery details and env-based beta source", () => {
    process.env[BETAS_ENV] = KNOWN_BETAS[0].value;
    process.env.HOME = makeTempDir("gateway-home-");

    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      getContextUsage: () => ({ tokens: 50_000, contextWindow: 1_000_000 }),
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
        runtimeBetaOverrides: new Set([KNOWN_BETAS[0].value]),
        runtimeExtraBetas: new Set(),
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
    expect(report).toContain("Beta source: env override");
  });

  it("shows custom injected beta headers when present", () => {
    process.env.HOME = makeTempDir("gateway-home-");

    const ctx = {
      cwd: makeTempDir("gateway-status-"),
      model: { provider: "sf-llm-gateway-internal", id: "claude-opus-4-6-v1" },
      getContextUsage: () => ({ tokens: 50_000, contextWindow: 1_000_000 }),
    } as any;

    const report = buildStatusReport(
      ctx,
      true,
      withDefaults({
        discovery: null,
        monthlyUsage: null,
        monthlyUsageError: null,
        runtimeBetaOverrides: null,
        runtimeExtraBetas: new Set(["my-custom-beta-2099-01-01"]),
      }),
    );

    expect(report).toContain("Custom injected betas:");
    expect(report).toContain("my-custom-beta-2099-01-01");
    expect(report).toContain("Beta source: command override");
  });
});
