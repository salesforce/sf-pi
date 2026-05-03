/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guardrail config loader — bundled defaults merged with a user override.
 *
 * Merge strategy (last wins):
 *   1. Bundled: `extensions/sf-guardrail/SF_GUARDRAIL_DEFAULTS.json`
 *   2. User override: `<globalAgentDir>/sf-guardrail/rules.json`
 *
 * Rule-set merging is by `id` (not by array index). A user-defined rule with
 * id "sf-deploy-prod" replaces the bundled one wholesale; to *disable* a
 * bundled rule without removing it, override with `{ "id": "...", "enabled": false }`.
 *
 * Scalar fields (enabled, productionAliases, confirmTimeoutMs, feature toggles)
 * use simple last-wins semantics. Missing fields fall back to bundled defaults.
 *
 * Project-level overrides (`.pi/sf-guardrail/rules.json`) are out of MVP scope.
 * See ROADMAP.md.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import type {
  CommandGateConfig,
  CommandPattern,
  GuardrailConfig,
  GuardrailFeatures,
  OrgAwareGateConfig,
  OrgAwareRule,
  PoliciesConfig,
  PolicyRule,
} from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLED_PATH = path.resolve(__dirname, "..", "SF_GUARDRAIL_DEFAULTS.json");

/** Path to the user override file. Exposed for tests and panels. */
export function userConfigPath(): string {
  return globalAgentPath("sf-guardrail", "rules.json");
}

/**
 * Load the bundled defaults verbatim. Exposed so tests and `install-preset`
 * can read the shipping rule set without re-implementing parsing.
 */
export function readBundledConfig(): GuardrailConfig {
  const text = readFileSync(BUNDLED_PATH, "utf8");
  return sanitize(JSON.parse(text));
}

/**
 * Attempt to read the user override. Returns `undefined` if the file is
 * missing, unreadable, or does not parse. Silent fallback mirrors sf-brain.
 */
export function readUserOverride(): Partial<GuardrailConfig> | undefined {
  const p = userConfigPath();
  if (!existsSync(p)) return undefined;
  try {
    const text = readFileSync(p, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as Partial<GuardrailConfig>;
  } catch {
    return undefined;
  }
}

/**
 * Load the effective config. Bundled defaults + user override if present.
 * Result is sanitized: every field that ships in bundled defaults is present,
 * and unknown fields are dropped.
 */
export function loadConfig(): { config: GuardrailConfig; source: "bundled" | "override" } {
  const bundled = readBundledConfig();
  const override = readUserOverride();
  if (!override) return { config: bundled, source: "bundled" };
  return { config: merge(bundled, override), source: "override" };
}

// ─── Merge helpers ──────────────────────────────────────────────────────────────

function merge(base: GuardrailConfig, overlay: Partial<GuardrailConfig>): GuardrailConfig {
  const next: GuardrailConfig = {
    version: 1,
    enabled: overlay.enabled ?? base.enabled,
    features: mergeFeatures(base.features, overlay.features),
    productionAliases: Array.isArray(overlay.productionAliases)
      ? overlay.productionAliases.map(String)
      : base.productionAliases,
    headlessEscapeHatchEnv:
      typeof overlay.headlessEscapeHatchEnv === "string" &&
      overlay.headlessEscapeHatchEnv.length > 0
        ? overlay.headlessEscapeHatchEnv
        : base.headlessEscapeHatchEnv,
    confirmTimeoutMs:
      typeof overlay.confirmTimeoutMs === "number" && overlay.confirmTimeoutMs > 0
        ? overlay.confirmTimeoutMs
        : base.confirmTimeoutMs,
    policies: mergePolicies(base.policies, overlay.policies),
    commandGate: mergeCommandGate(base.commandGate, overlay.commandGate),
    orgAwareGate: mergeOrgAwareGate(base.orgAwareGate, overlay.orgAwareGate),
  };
  return next;
}

function mergeFeatures(
  base: GuardrailFeatures,
  overlay: Partial<GuardrailFeatures> | undefined,
): GuardrailFeatures {
  if (!overlay) return { ...base };
  return {
    policies: typeof overlay.policies === "boolean" ? overlay.policies : base.policies,
    commandGate: typeof overlay.commandGate === "boolean" ? overlay.commandGate : base.commandGate,
    orgAwareGate:
      typeof overlay.orgAwareGate === "boolean" ? overlay.orgAwareGate : base.orgAwareGate,
    promptInjection:
      typeof overlay.promptInjection === "boolean" ? overlay.promptInjection : base.promptInjection,
  };
}

function mergePolicies(
  base: PoliciesConfig,
  overlay: Partial<PoliciesConfig> | undefined,
): PoliciesConfig {
  if (!overlay || !Array.isArray(overlay.rules)) return { rules: [...base.rules] };
  return { rules: mergeById(base.rules, overlay.rules, sanitizePolicyRule) };
}

function mergeCommandGate(
  base: CommandGateConfig,
  overlay: Partial<CommandGateConfig> | undefined,
): CommandGateConfig {
  if (!overlay) return { ...base, patterns: [...base.patterns] };
  return {
    patterns: mergeById(
      base.patterns,
      Array.isArray(overlay.patterns) ? overlay.patterns : [],
      sanitizeCommandPattern,
    ),
    allowedPatterns: Array.isArray(overlay.allowedPatterns)
      ? overlay.allowedPatterns.map(sanitizeCommandPattern).filter(isDefined)
      : base.allowedPatterns,
    autoDenyPatterns: Array.isArray(overlay.autoDenyPatterns)
      ? overlay.autoDenyPatterns.map(sanitizeCommandPattern).filter(isDefined)
      : base.autoDenyPatterns,
  };
}

function mergeOrgAwareGate(
  base: OrgAwareGateConfig,
  overlay: Partial<OrgAwareGateConfig> | undefined,
): OrgAwareGateConfig {
  if (!overlay || !Array.isArray(overlay.rules)) return { rules: [...base.rules] };
  return { rules: mergeById(base.rules, overlay.rules, sanitizeOrgAwareRule) };
}

function mergeById<T extends { id: string }>(
  base: T[],
  overlay: T[],
  sanitize: (input: unknown) => T | undefined,
): T[] {
  const byId = new Map<string, T>();
  for (const rule of base) byId.set(rule.id, rule);
  for (const raw of overlay) {
    const cleaned = sanitize(raw);
    if (cleaned) byId.set(cleaned.id, cleaned);
  }
  return [...byId.values()];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// ─── Sanitizers ─────────────────────────────────────────────────────────────────

/**
 * Walk a parsed config object and return a well-formed GuardrailConfig.
 * Used for the bundled file (which we trust) *and* in merge() so the output
 * never contains unknown fields that later code has to defend against.
 */
export function sanitize(input: unknown): GuardrailConfig {
  const base = fallbackConfig();
  if (!input || typeof input !== "object") return base;
  return merge(base, input as Partial<GuardrailConfig>);
}

function sanitizePolicyRule(input: unknown): PolicyRule | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return undefined;
  const patterns = Array.isArray(raw.patterns)
    ? raw.patterns
        .map((p) => sanitizePolicyPattern(p))
        .filter((p): p is { pattern: string; regex?: boolean } => p !== undefined)
    : [];
  if (patterns.length === 0) return undefined;
  const allowedPatterns = Array.isArray(raw.allowedPatterns)
    ? raw.allowedPatterns
        .map((p) => sanitizePolicyPattern(p))
        .filter((p): p is { pattern: string; regex?: boolean } => p !== undefined)
    : [];
  const protection =
    raw.protection === "readOnly" || raw.protection === "none" ? raw.protection : "noAccess";
  return {
    id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    patterns,
    allowedPatterns,
    protection,
    onlyIfExists: typeof raw.onlyIfExists === "boolean" ? raw.onlyIfExists : true,
    blockMessage: typeof raw.blockMessage === "string" ? raw.blockMessage : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
}

function sanitizePolicyPattern(input: unknown): { pattern: string; regex?: boolean } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.pattern !== "string" || raw.pattern.length === 0) return undefined;
  return {
    pattern: raw.pattern,
    regex: typeof raw.regex === "boolean" ? raw.regex : undefined,
  };
}

function sanitizeCommandPattern(input: unknown): CommandPattern | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.pattern !== "string") return undefined;
  return {
    id: raw.id,
    pattern: raw.pattern,
    description: typeof raw.description === "string" ? raw.description : undefined,
    action: raw.action === "block" ? "block" : "confirm",
  };
}

function sanitizeOrgAwareRule(input: unknown): OrgAwareRule | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string") return undefined;
  const match = raw.match as Record<string, unknown> | undefined;
  if (!match || match.tool !== "bash" || !match.ast) return undefined;
  const ast = match.ast as Record<string, unknown>;
  if (typeof ast.cmd !== "string") return undefined;
  const whenOrgType = Array.isArray(raw.whenOrgType)
    ? raw.whenOrgType.filter(
        (v): v is "production" | "sandbox" | "scratch" | "developer" | "trial" | "unknown" =>
          typeof v === "string" &&
          ["production", "sandbox", "scratch", "developer", "trial", "unknown"].includes(v),
      )
    : [];
  return {
    id: raw.id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    match: {
      tool: "bash",
      ast: {
        cmd: ast.cmd,
        subCmd: Array.isArray(ast.subCmd)
          ? (ast.subCmd as (string | string[])[]).filter(
              (v) => typeof v === "string" || Array.isArray(v),
            )
          : undefined,
        flagIn:
          ast.flagIn && typeof ast.flagIn === "object"
            ? (ast.flagIn as Record<string, string[]>)
            : undefined,
      },
    },
    whenOrgType,
    action: raw.action === "block" ? "block" : "confirm",
    confirmMessage: typeof raw.confirmMessage === "string" ? raw.confirmMessage : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
}

function fallbackConfig(): GuardrailConfig {
  // Used only when the bundled file is unreadable, which should never happen
  // in a correctly-installed build. Keeps guardrail inert rather than throwing.
  return {
    version: 1,
    enabled: false,
    features: {
      policies: false,
      commandGate: false,
      orgAwareGate: false,
      promptInjection: false,
    },
    productionAliases: [],
    headlessEscapeHatchEnv: "SF_GUARDRAIL_ALLOW_HEADLESS",
    confirmTimeoutMs: 30000,
    policies: { rules: [] },
    commandGate: { patterns: [], allowedPatterns: [], autoDenyPatterns: [] },
    orgAwareGate: { rules: [] },
  };
}
