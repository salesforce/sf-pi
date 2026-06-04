/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Run the official AgentScript SDK over a `.agent` file and produce a filtered,
 * agent-friendly result.
 *
 * Decision rules (see README for the agent-facing behavior matrix):
 *
 *   Severity 1 (Error)            always included
 *   Severity 2 (Warning)          included only for known-actionable codes
 *   Severity 3/4 (Info/Hint)      always dropped
 *
 * Actionable warning codes are the ones our diagnostics layer can pair with a
 * machine-applyable fix (`code-actions.ts` knows how to build TextEdits for
 * them). We keep the allowlist explicit so the agent never sees a low-value
 * warning it can't act on.
 */

import fs from "node:fs/promises";
import { analyzeAgentScriptSource } from "./agentforce-document.ts";
import { buildQuickFixes } from "./code-actions.ts";
import { buildLocalDiagnostics } from "./local-lints.ts";
import type { AgentScriptCheckResult, AgentScriptDiagnostic } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Actionability filter
// -------------------------------------------------------------------------------------------------

/**
 * Severity-2 warning codes that are worth surfacing to the agent because we
 * can build a deterministic fix for them. Everything else at severity 2+
 * is dropped to keep the feedback stream focused on things the agent can
 * actually resolve.
 */
const ACTIONABLE_WARNING_CODES = new Set<string>([
  "deprecated-field",
  "unused-variable",
  "invalid-version",
  "unknown-dialect",
  "invalid-modifier",
  "unknown-type",
]);

function isActionable(diagnostic: AgentScriptDiagnostic): boolean {
  // Severity 1 (Error): always include.
  if (diagnostic.severity === 1) return true;

  // Severity 2 (Warning): include only when we know how to act on it.
  if (diagnostic.severity === 2 && diagnostic.code) {
    return ACTIONABLE_WARNING_CODES.has(diagnostic.code);
  }

  return false;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Read `filePath`, run parse + compile, return a filtered result.
 *
 * Never throws. If the SDK isn't loadable we return an `ok: false` result so
 * the caller can render a one-time setup note.
 */
export async function checkAgentScriptFile(filePath: string): Promise<AgentScriptCheckResult> {
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      failureKind: "read_failed",
      unavailableReason: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const analysis = await analyzeAgentScriptSource(source);
  if (analysis.ok === false) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      dialect: analysis.dialect,
      failureKind: analysis.failureKind,
      unavailableReason: analysis.unavailableReason,
    };
  }

  const filtered = analysis.analysis.compileDiagnostics.filter(isActionable);
  const localDiagnostics = buildLocalDiagnostics(source);
  const diagnostics = [...filtered, ...localDiagnostics];
  const quickFixes = await buildQuickFixes(source, diagnostics, analysis.analysis.documentState);

  return {
    ok: true,
    diagnostics,
    dialect: analysis.analysis.dialect,
    quickFixes,
  };
}
