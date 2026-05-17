/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One-shot onboarding helpers for the SF LLM Gateway.
 *
 * Two surfaces live here:
 *
 * 1. `runOnboardChain(...)` is the imperative composition users invoke via
 *    `/sf-llm-gateway onboard`. It chains import\u2192save\u2192register\u2192doctor\u2192
 *    set-default into a single call so the path from "fresh machine with
 *    Claude Code" to "fully wired gateway" takes one keystroke.
 *
 * 2. `shouldNotifyClaudeCodeFirstRun(...)` is a pure decision helper used
 *    by the `session_start` deferred work to decide whether to surface the
 *    first-run nudge. Cheap by design (state read + existsSync only) so
 *    the boot path stays under budget.
 *
 * The actual chain orchestration in this file builds a structured result
 * (steps + final status) so the slash-command handler can render it
 * uniformly via `emitCommandOutput`. Keeping that orchestration here
 * (instead of inline in `index.ts`) makes the chain unit-testable without
 * standing up a full pi extension context.
 */
import { existsSync } from "node:fs";
import { getClaudeCodeSettingsPath, readClaudeCodeGatewayConfig } from "./claude-code-import.ts";
import {
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  readGatewaySavedConfig,
} from "./config.ts";
import { hasShownClaudeCodeNotify } from "./onboarding-state.ts";

/**
 * Single step in the onboard chain. The handler renders these as a
 * status table so users can see exactly which step skipped, succeeded,
 * or failed without having to scroll a wall of prose.
 */
export interface OnboardChainStep {
  id: "import-claude" | "save-config" | "register-provider" | "doctor" | "set-default";
  /** Human-readable label used in the rendered chain summary. */
  label: string;
  status: "ok" | "skipped" | "warn" | "error";
  /** Short explanation. Always rendered after the status icon. */
  detail: string;
}

export interface OnboardChainResult {
  steps: OnboardChainStep[];
  /** Highest severity reached across the steps. Drives the panel level. */
  level: "info" | "warning" | "error";
  /** Top-line summary used as the panel/notify title. */
  summary: string;
}

/**
 * Decide whether the first-run "found Claude Code creds" notify should
 * fire. Returns the cleansed import result on hit so the caller can
 * include the source path in the notify text. Returns `null` whenever
 * any of the cheap gates fail \u2014 keep this side-effect-free.
 *
 * Boot-path budget: at most one state-store read + one fs.statSync +
 * (only on hit) one JSON parse + scoring pass. We deliberately do NOT
 * call `discoverAndRegister` or any network work from here.
 */
export interface FirstRunNotifyDecision {
  shouldNotify: boolean;
  /** Set when shouldNotify is true. Path the importer would read. */
  claudeSettingsPath?: string;
  /** Set when shouldNotify is true. Imported base URL preview, when present. */
  importedBaseUrl?: string;
}

export function shouldNotifyClaudeCodeFirstRun(opts: {
  cwd: string;
  /** Test seam \u2014 prod callers omit this and use the canonical state path. */
  onboardingStatePathOverride?: string;
  /** Test seam \u2014 prod callers omit this and read from ~/.claude/settings.json. */
  claudeSettingsPathOverride?: string;
}): FirstRunNotifyDecision {
  // Gate 1 (cheapest): have we already nudged on this machine?
  if (hasShownClaudeCodeNotify(opts.onboardingStatePathOverride)) {
    return { shouldNotify: false };
  }

  // Gate 2: do they already have saved gateway config? If yes, the import
  // is moot \u2014 their pi is already wired to a gateway. Don't nudge.
  const savedGlobal = readGatewaySavedConfig(globalGatewayConfigPath());
  const savedProject = readGatewaySavedConfig(projectGatewayConfigPath(opts.cwd));
  const hasSavedKey = Boolean(savedGlobal.apiKey || savedProject.apiKey);
  const hasSavedBaseUrl = Boolean(savedGlobal.baseUrl || savedProject.baseUrl);
  if (hasSavedKey && hasSavedBaseUrl) {
    return { shouldNotify: false };
  }

  // Gate 3: does Claude Code's settings file exist at all? Single statSync.
  const claudePath = opts.claudeSettingsPathOverride ?? getClaudeCodeSettingsPath();
  if (!existsSync(claudePath)) {
    return { shouldNotify: false };
  }

  // Only now do we parse + score. The importer is itself defensive; it
  // returns ok=false when nothing useful was found.
  const imported = readClaudeCodeGatewayConfig(claudePath);
  if (!imported.ok) return { shouldNotify: false };
  if (!imported.apiKey) return { shouldNotify: false };

  return {
    shouldNotify: true,
    claudeSettingsPath: claudePath,
    importedBaseUrl: imported.baseUrl,
  };
}

/**
 * Orchestrator for `/sf-llm-gateway onboard`.
 *
 * Caller wires the imperative steps via dependency injection so unit
 * tests can drive the chain without booting the pi runtime. Production
 * call site lives in `index.ts` and supplies the real implementations.
 */
export interface OnboardChainDeps {
  /** Imports cleansed creds from Claude Code into the saved gateway config. */
  importClaudeCode(scope: "global" | "project"): Promise<{
    ok: boolean;
    /** Short prose used in the step row. */
    detail: string;
    /** True when at least one of (baseUrl, apiKey) was newly saved. */
    importedAny: boolean;
  }>;
  /** Re-discover models + register the provider with the runtime. */
  registerProvider(): Promise<void>;
  /** Run the gateway doctor and return its structured outcome. */
  runDoctor(): Promise<{
    /** True when every check passed. */
    allOk: boolean;
    /** Aggregate failure class for the chain decision below. */
    failureClass: "tls" | "auth" | "redirect" | "other" | null;
    /** One-line summary surfaced under the doctor step row. */
    summary: string;
  }>;
  /** Switch pi's default provider/model to the gateway. */
  setDefault(scope: "global" | "project"): Promise<void>;
  /** Read whether the gateway already has a saved baseUrl + apiKey. */
  hasUsableSavedConfig(): boolean;
}

export async function runOnboardChain(
  scope: "global" | "project",
  deps: OnboardChainDeps,
): Promise<OnboardChainResult> {
  const steps: OnboardChainStep[] = [];

  // Step 1 \u2014 import from Claude Code (best-effort, skipped is fine).
  const startedConfigured = deps.hasUsableSavedConfig();
  try {
    const importResult = await deps.importClaudeCode(scope);
    steps.push({
      id: "import-claude",
      label: "Import from Claude Code",
      status: importResult.ok ? (importResult.importedAny ? "ok" : "skipped") : "skipped",
      detail: importResult.detail,
    });
  } catch (error) {
    steps.push({
      id: "import-claude",
      label: "Import from Claude Code",
      status: "warn",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 2 \u2014 confirm we have something to register. We don't write a new
  // saved-config from this step; the import wrote it (or nothing was
  // available). This row exists so users who land here without any
  // saved config see why the chain stops short.
  if (!deps.hasUsableSavedConfig()) {
    steps.push({
      id: "save-config",
      label: "Saved config",
      status: "error",
      detail: startedConfigured
        ? "Saved config disappeared between steps. Re-run /sf-llm-gateway setup."
        : "No saved gateway URL or key found. Run /sf-llm-gateway setup, or paste a token via Open token page.",
    });
    return finalize(steps, "Onboard chain stopped: gateway not configured.");
  }
  steps.push({
    id: "save-config",
    label: "Saved config",
    status: "ok",
    detail: "Gateway base URL + API key present.",
  });

  // Step 3 \u2014 register the provider with pi.
  try {
    await deps.registerProvider();
    steps.push({
      id: "register-provider",
      label: "Register provider",
      status: "ok",
      detail: "Discovery refreshed; provider registered.",
    });
  } catch (error) {
    steps.push({
      id: "register-provider",
      label: "Register provider",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    return finalize(steps, "Onboard chain stopped: provider registration failed.");
  }

  // Step 4 \u2014 doctor preflight. A TLS-class failure here is an explicit
  // hand-off to the fix-ca-bundle action; we surface it in the chain
  // detail so the user knows what to run next.
  const doctor = await deps.runDoctor();
  if (doctor.allOk) {
    steps.push({
      id: "doctor",
      label: "Doctor preflight",
      status: "ok",
      detail: doctor.summary,
    });
  } else {
    const followUp =
      doctor.failureClass === "tls"
        ? " Next: /sf-llm-gateway fix-ca-bundle to wire NODE_EXTRA_CA_CERTS."
        : doctor.failureClass === "auth"
          ? " Next: rotate or re-paste the gateway API key via /sf-llm-gateway setup."
          : doctor.failureClass === "redirect"
            ? " Next: confirm the gateway base URL points at the API endpoint, not an SSO portal."
            : "";
    steps.push({
      id: "doctor",
      label: "Doctor preflight",
      status: "warn",
      detail: `${doctor.summary}${followUp}`,
    });
    // Stop short of set-default \u2014 we don't want to point pi at a gateway
    // that just failed its preflight.
    return finalize(steps, "Onboard chain partially complete: doctor reported issues.");
  }

  // Step 5 \u2014 set the gateway as the active default.
  try {
    await deps.setDefault(scope);
    steps.push({
      id: "set-default",
      label: "Set gateway default",
      status: "ok",
      detail: `Gateway is now the default provider in ${scope} scope.`,
    });
  } catch (error) {
    steps.push({
      id: "set-default",
      label: "Set gateway default",
      status: "warn",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return finalize(steps, "Onboard chain complete.");
}

function finalize(steps: OnboardChainStep[], summary: string): OnboardChainResult {
  // Promote chain severity to the worst step seen. error > warn > skipped/ok.
  // Iterate in declared order; once we land on "error" we short-circuit
  // because nothing can outrank it.
  let level: OnboardChainResult["level"] = "info";
  for (const step of steps) {
    if (step.status === "error") {
      level = "error";
      break;
    }
    if (step.status === "warn" && level === "info") {
      level = "warning";
    }
  }
  return { steps, level, summary };
}

/**
 * Render an OnboardChainResult as the body text emitted by the panel /
 * notify path. Pure formatting, no I/O.
 */
export function formatOnboardChainReport(result: OnboardChainResult): string {
  const icons: Record<OnboardChainStep["status"], string> = {
    ok: "\u2713",
    skipped: "-",
    warn: "!",
    error: "x",
  };
  const lines: string[] = [result.summary, ""];
  for (const step of result.steps) {
    lines.push(`${icons[step.status]} ${step.label}: ${step.detail}`);
  }
  return lines.join("\n");
}
