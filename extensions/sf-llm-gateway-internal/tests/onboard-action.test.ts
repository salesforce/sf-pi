/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the onboard chain orchestrator + first-run notify gate.
 *
 * The chain is shaped around `OnboardChainDeps` so we can drive it with
 * fakes \u2014 no pi runtime, no live gateway. The first-run gate test is
 * separate because it exercises real filesystem reads via tmp dirs.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatOnboardChainReport,
  runOnboardChain,
  shouldNotifyClaudeCodeFirstRun,
  type OnboardChainDeps,
} from "../lib/onboard-action.ts";

// Helper: assemble a deps stub so each test only overrides what it cares
// about. Returns sane defaults that look like a happy-path import.
function buildHappyDeps(overrides: Partial<OnboardChainDeps> = {}): OnboardChainDeps {
  const defaults: OnboardChainDeps = {
    importClaudeCode: async () => ({
      ok: true,
      importedAny: true,
      detail: "Imported base URL + API key into global scope.",
    }),
    refreshProvider: async () => undefined,
    runDoctor: async () => ({
      allOk: true,
      failureClass: null,
      summary: "Gateway preflight passed.",
    }),
    setDefault: async () => undefined,
    hasUsableSavedConfig: () => true,
  };
  return { ...defaults, ...overrides };
}

describe("runOnboardChain", () => {
  it("walks every step on the happy path and ends as info-level", async () => {
    const result = await runOnboardChain("global", buildHappyDeps());
    expect(result.level).toBe("info");
    expect(result.summary).toBe("Onboard chain complete.");
    expect(result.steps.map((step) => step.id)).toEqual([
      "import-claude",
      "save-config",
      "refresh-provider",
      "doctor",
      "set-default",
    ]);
    expect(result.steps.every((step) => step.status === "ok")).toBe(true);
  });

  it("stops short with a clear hint when no saved config exists post-import", async () => {
    const result = await runOnboardChain(
      "global",
      buildHappyDeps({
        importClaudeCode: async () => ({
          ok: false,
          importedAny: false,
          detail: "Claude Code settings not found at ~/.claude/settings.json",
        }),
        hasUsableSavedConfig: () => false,
      }),
    );
    expect(result.level).toBe("error");
    expect(result.summary).toContain("not configured");
    const saveStep = result.steps.find((step) => step.id === "save-config");
    expect(saveStep?.status).toBe("error");
    expect(saveStep?.detail).toContain("/sf-llm-gateway setup");
    // Chain stops before doctor.
    expect(result.steps.find((step) => step.id === "doctor")).toBeUndefined();
  });

  it("hands TLS doctor failures off to fix-ca-bundle in the detail", async () => {
    const result = await runOnboardChain(
      "global",
      buildHappyDeps({
        runDoctor: async () => ({
          allOk: false,
          failureClass: "tls",
          summary: "Gateway preflight reported 3 failing check(s).",
        }),
      }),
    );
    expect(result.level).toBe("warning");
    const doctorStep = result.steps.find((step) => step.id === "doctor");
    expect(doctorStep?.status).toBe("warn");
    expect(doctorStep?.detail).toContain("/sf-llm-gateway fix-ca-bundle");
    // Doesn't touch defaults when doctor failed.
    expect(result.steps.find((step) => step.id === "set-default")).toBeUndefined();
  });

  it("hands auth failures off to setup, not the CA fixer", async () => {
    const result = await runOnboardChain(
      "global",
      buildHappyDeps({
        runDoctor: async () => ({
          allOk: false,
          failureClass: "auth",
          summary: "Gateway preflight reported 1 failing check(s).",
        }),
      }),
    );
    const doctorStep = result.steps.find((step) => step.id === "doctor");
    expect(doctorStep?.detail).toContain("/login sf-llm-gateway-internal");
    expect(doctorStep?.detail).not.toContain("fix-ca-bundle");
  });

  it("escalates importClaudeCode throws to a warn row but continues when saved config exists", async () => {
    const result = await runOnboardChain(
      "global",
      buildHappyDeps({
        importClaudeCode: async () => {
          throw new Error("permission denied");
        },
      }),
    );
    const importStep = result.steps.find((step) => step.id === "import-claude");
    expect(importStep?.status).toBe("warn");
    // Subsequent steps still run because hasUsableSavedConfig is true.
    expect(result.steps.find((step) => step.id === "set-default")?.status).toBe("ok");
    expect(result.level).toBe("warning");
  });
});

describe("formatOnboardChainReport", () => {
  it("renders one line per step with status icons", () => {
    const out = formatOnboardChainReport({
      summary: "Onboard chain complete.",
      level: "info",
      steps: [
        {
          id: "import-claude",
          label: "Import from Claude Code",
          status: "ok",
          detail: "Imported.",
        },
        { id: "save-config", label: "Saved config", status: "skipped", detail: "Already present." },
        { id: "doctor", label: "Doctor preflight", status: "warn", detail: "TLS issue." },
      ],
    });
    expect(out).toContain("Onboard chain complete.");
    expect(out).toMatch(/\u2713 Import from Claude Code/);
    expect(out).toMatch(/- Saved config/);
    expect(out).toMatch(/! Doctor preflight/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// First-run notify gate
// ════════════════════════════════════════════════════════════════════════

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let tmpDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  previousAgentDir = process.env[PI_AGENT_ENV];
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-onboard-firstrun-"));
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("shouldNotifyClaudeCodeFirstRun", () => {
  it("returns shouldNotify=false when Claude Code settings file is missing", () => {
    const decision = shouldNotifyClaudeCodeFirstRun({
      cwd: tmpDir,
      onboardingStatePathOverride: path.join(tmpDir, "onboarding.json"),
      claudeSettingsPathOverride: path.join(tmpDir, "missing", ".claude", "settings.json"),
    });
    expect(decision.shouldNotify).toBe(false);
  });

  it("returns shouldNotify=true when Claude Code has a usable token + URL", () => {
    const claudeSettings = path.join(tmpDir, ".claude", "settings.json");
    mkdirSync(path.dirname(claudeSettings), { recursive: true });
    writeFileSync(
      claudeSettings,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example.com/bedrock/v1",
          ANTHROPIC_AUTH_TOKEN: "Bearer example-token-1234567890",
        },
      }),
    );

    const decision = shouldNotifyClaudeCodeFirstRun({
      cwd: tmpDir,
      onboardingStatePathOverride: path.join(tmpDir, "onboarding.json"),
      claudeSettingsPathOverride: claudeSettings,
    });
    expect(decision.shouldNotify).toBe(true);
    expect(decision.importedBaseUrl).toBe("https://gateway.example.com");
    expect(decision.claudeSettingsPath).toBe(claudeSettings);
  });

  it("returns shouldNotify=false once the sentinel has been written", async () => {
    const claudeSettings = path.join(tmpDir, ".claude", "settings.json");
    mkdirSync(path.dirname(claudeSettings), { recursive: true });
    writeFileSync(
      claudeSettings,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example.com",
          ANTHROPIC_AUTH_TOKEN: "example-token-1234567890",
        },
      }),
    );

    const onboardingPath = path.join(tmpDir, "onboarding.json");
    const { markClaudeCodeNotifyShown } = await import("../lib/onboarding-state.ts");
    markClaudeCodeNotifyShown(onboardingPath);

    const decision = shouldNotifyClaudeCodeFirstRun({
      cwd: tmpDir,
      onboardingStatePathOverride: onboardingPath,
      claudeSettingsPathOverride: claudeSettings,
    });
    expect(decision.shouldNotify).toBe(false);
  });
});
