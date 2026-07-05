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
export type RuleBehavior = "off" | "confirm" | "block";

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
  /** Per-rule behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
}

export interface CommandPattern {
  id: string;
  pattern: string;
  description?: string;
  /** Override the default `confirm` action for this pattern. Currently unused in MVP. */
  action?: "confirm" | "block";
  /** Per-pattern behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
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
  "production" | "sandbox" | "scratch" | "developer" | "trial" | "unknown";

export interface OrgAwareRule {
  id: string;
  description?: string;
  match: OrgAwareMatch;
  /** Rule fires only when the resolved target-org type is one of these. */
  whenOrgType: OrgTypeFilter[];
  action: "confirm" | "block";
  confirmMessage?: string;
  /** Per-rule behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
}

export interface OrgAwareGateConfig {
  rules: OrgAwareRule[];
}

export interface PoliciesConfig {
  rules: PolicyRule[];
}

export interface GuardrailConfig {
  version: 1;
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

// ─── Safety subject model ───────────────────────────────────────────────────────

export type SafetySubject = FileSafetySubject | ShellCommandSafetySubject | NativeToolSafetySubject;

export interface FileSafetySubject {
  kind: "file";
  toolName: string;
  path: string;
}

export interface ShellCommandSafetySubject {
  kind: "shellCommand";
  toolName: "bash" | "herdr";
  command: string;
}

export interface NativeToolSafetySubject {
  kind: "nativeTool";
  toolName: string;
  action?: string;
  ruleId: string;
  /** Compact display subject for prompts/audit; never a full raw payload. */
  subject: string;
  reason: string;
  promptTitle?: string;
  operationFamily: string;
  riskTier: string;
  /** Stable, already-sanitized fingerprint for the operation payload/target details. */
  fingerprint: string;
  approvalLabel: string;
  approvalDetail?: string;
  /** True when the native operation targets a Salesforce org. */
  usesSalesforceOrg?: boolean;
  /** Alias / username / org id from target_org, when the tool supplied one. */
  targetOrg?: string;
  /** True when targetOrg came explicitly from tool input instead of the active default. */
  targetOrgExplicit?: boolean;
  /** False for native operations that should not create session approvals. */
  allowSession?: boolean;
}

// ─── Decision model ─────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | "allow_once"
  | "allow_session"
  | "allow_persisted"
  | "allow_auto"
  | "block"
  | "timeout"
  | "cancel"
  | "hard_block"
  | "headless_pass"
  | "headless_block";

/**
 * A classified tool_call — the product of evaluating every feature against one
 * incoming event. A single event can match at most one policy (strongest-wins)
 * but multiple command-gate or org-aware rules may fire; index.ts iterates them
 * in order and stops at the first block/deny.
 */
export interface ApprovalScope {
  fingerprint: string;
  label: string;
  detail?: string;
  riskTier?: string;
  operationFamily?: string;
  /** When false, the HIL dialog offers only allow-once or block. */
  allowSession?: boolean;
  /** Legacy compatibility only. New approvals are session-scoped. */
  persistedGrant?: {
    label: string;
    ttlMs: number;
  };
}

/** Compatibility alias for the envelope-first redesign vocabulary. */
export type SafetyEnvelope = ApprovalScope;

export interface ClassifiedDecision {
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate" | "nativeToolGate";
  action: "allow" | "block" | "confirm";
  /** Human-readable reason surfaced back to the LLM on block. */
  reason: string;
  /** Displayed to the user in the confirmation dialog. */
  promptTitle?: string;
  /** Stable fingerprint for session allow-memory dedup. */
  fingerprint: string;
  /** File path, shell command, or compact native tool operation subject. */
  subject: string;
  /** Human-readable Safety Envelope metadata. Kept as approvalScope for compatibility. */
  approvalScope?: SafetyEnvelope;
  /** Target-org context if resolved. */
  orgAlias?: string;
  orgType?: OrgTypeFilter;
  orgId?: string;
  orgUsername?: string;
  orgResolutionGuessed?: boolean;
  orgResolutionSource?: "cache" | "lookup" | "productionAliases" | "guessed";
  orgTargetExplicit?: boolean;
  orgCommand?: string;
}

// ─── Persisted entries (pi.appendEntry customType values) ───────────────────────

/** Decision audit log. Rendered by `/sf-guardrail audit`. */
export const DECISION_ENTRY_TYPE = "sf-guardrail-decision";

/** Session allow-memory. Rendered/cleared by `/sf-guardrail forget`. */
export const ALLOW_ENTRY_TYPE = "sf-guardrail-allow";

/** Session allow-memory revocation marker. */
export const ALLOW_REVOKE_ENTRY_TYPE = "sf-guardrail-allow-revoke";

/** Injection guard. Emitted once per session like sf-brain's kernel. */
export const INJECTION_ENTRY_TYPE = "sf-guardrail-prompt";

export interface DecisionEntryData {
  timestamp: number;
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate" | "nativeToolGate";
  outcome: DecisionOutcome;
  toolName: string;
  subject: string;
  fingerprint: string;
  orgAlias?: string;
  orgType?: OrgTypeFilter;
  orgId?: string;
  orgUsername?: string;
  orgResolutionGuessed?: boolean;
  orgResolutionSource?: "cache" | "lookup" | "productionAliases" | "guessed";
  approvalScopeLabel?: string;
  approvalScopeDetail?: string;
  approvalRiskTier?: string;
  reason: string;
}

export interface AllowEntryData {
  ruleId: string;
  fingerprint: string;
  grantedAt: number;
}

export interface AllowRevokeEntryData {
  revokedAt: number;
}

// ─── Command / slot constants ───────────────────────────────────────────────────

export const COMMAND_NAME = "sf-guardrail";
export const STATUS_KEY = "sf-guardrail";
