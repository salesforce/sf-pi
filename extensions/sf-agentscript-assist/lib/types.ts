/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Local types for sf-agentscript-assist.
 *
 * These shadow the pieces of the vendored SDK we actually use, so the
 * extension's internal types stay decoupled from the raw SDK surface.
 */

/**
 * LSP-shape severity levels.
 *
 * Matches the LSP spec and matches the DiagnosticSeverity enum inside the
 * vendored SDK (`Error = 1, Warning = 2, Information = 3, Hint = 4`).
 */
export type AgentScriptSeverity = 1 | 2 | 3 | 4;

export interface AgentScriptRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Subset of the SDK `Diagnostic` type that the rest of this extension depends
 * on. Kept minimal so we don't drag the full SDK type surface through our code.
 */
export interface AgentScriptDiagnostic {
  range: AgentScriptRange;
  message: string;
  severity: AgentScriptSeverity;
  code?: string;
  source?: string;
  /** LSP DiagnosticTag values (Unnecessary=1, Deprecated=2) */
  tags?: (1 | 2)[];
  /** Open-ended structured data attached by the SDK. */
  data?: Record<string, unknown>;
}

/**
 * Dialect info surfaced to the agent once per file per session.
 */
export interface AgentScriptDialectInfo {
  /** Dialect name, e.g. `agentforce`. */
  name: string;
  /** Optional version, e.g. `2.5`. */
  version?: string;
  /** True if the user wrote an unknown dialect name. */
  unknown?: boolean;
  /** Available dialects from the SDK, reported when the dialect is unknown. */
  availableNames?: string[];
}

/**
 * A structured quick fix suggestion the agent can apply with the `edit` tool.
 *
 * We deliberately do not try to replicate the LSP `WorkspaceEdit` shape — we
 * only surface what the agent can actually use: a human title, a pointer back
 * to the source diagnostic, and the list of text edits.
 */
export interface AgentScriptQuickFix {
  /** Human-readable label, e.g. `"Convert to subagent"`. */
  title: string;
  /** True when upstream tagged the fix `isPreferred` — safe to prioritize. */
  preferred: boolean;
  /** Zero-based line of the diagnostic this fix addresses. */
  diagnosticLine: number;
  /** Diagnostic code, if the SDK provided one. */
  diagnosticCode?: string;
  /** Ordered list of text edits, as LSP-shape ranges. */
  edits: { range: AgentScriptRange; newText: string }[];
}

/**
 * Result of one parse-plus-compile pass over a `.agent` file.
 */
export interface AgentScriptCheckResult {
  /** True when the SDK was available and the file was diagnosed. */
  ok: boolean;
  /** Diagnostics that passed our actionability filter. */
  diagnostics: AgentScriptDiagnostic[];
  /** Resolved dialect, when available. */
  dialect?: AgentScriptDialectInfo;
  /** Fixes we consider safe to surface to the agent. */
  quickFixes: AgentScriptQuickFix[];
  /** When the SDK couldn't load, this contains the reason. */
  unavailableReason?: string;
}
