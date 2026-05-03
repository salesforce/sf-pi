/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Type boundary for sf-guardrail.
 *
 * One place for the guardrail config schema, decision shapes, and persisted
 * entry types. Keep this module pure: no imports from node, fs, or pi — it
 * is the shape contract everything else depends on.
 */

// ─── Config schema ──────────────────────────────────────────────────────────────

export type ProtectionLevel = "noAccess" | "readOnly" | "none";

export interface PolicyPattern {
  pattern: string;
  /** If true, treat pattern as a regex (anchored with JS flags). */
  regex?: boolean;
}

export interface PolicyRule {
  id: string;
  description?: string;
  patterns: PolicyPattern[];
  allowedPatterns?: PolicyPattern[];
  protection: ProtectionLevel;
  /** Only match if the file currently exists on disk. Default true. */
  onlyIfExists?: boolean;
  /** Message shown when the rule blocks. {file} is replaced with the path. */
  blockMessage?: string;
  /** Per-rule enabled flag. Default true. */
  enabled?: boolean;
}

export interface CommandPattern {
  id: string;
  pattern: string;
  description?: string;
  /** Override the default `confirm` action for this pattern. Currently unused in MVP. */
  action?: "confirm" | "block";
}

export interface CommandGateConfig {
  patterns: CommandPattern[];
  allowedPatterns: CommandPattern[];
  autoDenyPatterns: CommandPattern[];
}

/**
 * Shell-AST-based match spec for org-aware rules.
 *
 * Semantics:
 *   - `cmd` matches the head word, e.g. "sf".
 *   - `subCmd` matches the positional non-flag arguments that follow, in
 *     order. Each entry is either a literal string or an array of
 *     alternatives. Example: `["data", ["delete","update"]]` matches both
 *     `sf data delete …` and `sf data update …` but not `sf data query …`.
 *   - `flagIn` requires the named flag to be present with one of the listed
 *     values. `--method DELETE` matches, `--method=DELETE` matches,
 *     `--method GET` does not. Omit to ignore flag matching.
 */
export interface ShellAstMatch {
  cmd: string;
  subCmd?: (string | string[])[];
  flagIn?: Record<string, string[]>;
}

export interface OrgAwareMatch {
  tool: "bash";
  ast: ShellAstMatch;
}

export type OrgTypeFilter =
  | "production"
  | "sandbox"
  | "scratch"
  | "developer"
  | "trial"
  | "unknown";

export interface OrgAwareRule {
  id: string;
  description?: string;
  match: OrgAwareMatch;
  /** Rule fires only when the resolved target-org type is one of these. */
  whenOrgType: OrgTypeFilter[];
  action: "confirm" | "block";
  confirmMessage?: string;
  enabled?: boolean;
}

export interface OrgAwareGateConfig {
  rules: OrgAwareRule[];
}

export interface PoliciesConfig {
  rules: PolicyRule[];
}

export interface GuardrailFeatures {
  policies: boolean;
  commandGate: boolean;
  orgAwareGate: boolean;
  promptInjection: boolean;
}

export interface GuardrailConfig {
  version: 1;
  enabled: boolean;
  features: GuardrailFeatures;
  /** Aliases the user has tagged as production. Merged with type detection. */
  productionAliases: string[];
  /** Env var name that opens a headless escape hatch when set to a truthy value. */
  headlessEscapeHatchEnv: string;
  /** ms. `ctx.ui.select` returns undefined past this; guardrail treats as block. */
  confirmTimeoutMs: number;
  policies: PoliciesConfig;
  commandGate: CommandGateConfig;
  orgAwareGate: OrgAwareGateConfig;
}

// ─── Decision model ─────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | "allow_once"
  | "allow_session"
  | "block"
  | "hard_block"
  | "headless_pass"
  | "headless_block";

/**
 * A classified tool_call — the product of evaluating every feature against one
 * incoming event. A single event can match at most one policy (strongest-wins)
 * but multiple command-gate or org-aware rules may fire; index.ts iterates them
 * in order and stops at the first block/deny.
 */
export interface ClassifiedDecision {
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate";
  action: "block" | "confirm";
  /** Human-readable reason surfaced back to the LLM on block. */
  reason: string;
  /** Displayed to the user in the confirmation dialog. */
  promptTitle?: string;
  /** Stable fingerprint for session allow-memory dedup. */
  fingerprint: string;
  /** File path (policies) or shell command (commandGate / orgAwareGate). */
  subject: string;
  /** Target-org context if resolved. */
  orgAlias?: string;
  orgType?: OrgTypeFilter;
}

// ─── Persisted entries (pi.appendEntry customType values) ───────────────────────

/** Decision audit log. Rendered by `/sf-guardrail audit`. */
export const DECISION_ENTRY_TYPE = "sf-guardrail-decision";

/** Session allow-memory. Rendered/cleared by `/sf-guardrail forget`. */
export const ALLOW_ENTRY_TYPE = "sf-guardrail-allow";

/** Injection guard. Emitted once per session like sf-brain's kernel. */
export const INJECTION_ENTRY_TYPE = "sf-guardrail-prompt";

export interface DecisionEntryData {
  timestamp: number;
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate";
  outcome: DecisionOutcome;
  toolName: string;
  subject: string;
  fingerprint: string;
  orgAlias?: string;
  orgType?: OrgTypeFilter;
  reason: string;
}

export interface AllowEntryData {
  ruleId: string;
  fingerprint: string;
  grantedAt: number;
}

// ─── Command / slot constants ───────────────────────────────────────────────────

export const COMMAND_NAME = "sf-guardrail";
export const STATUS_KEY = "sf-guardrail";
