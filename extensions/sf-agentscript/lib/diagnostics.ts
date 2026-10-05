/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Run the official AgentScript SDK over a `.agent` file and preserve its
 * complete diagnostic result.
 *
 * Explicit compile/check returns every upstream severity. Automatic
 * compile-on-save narrows that result to errors and warnings at its presentation
 * boundary so informational hints do not flood edit-loop context. Quick-fix
 * availability is independent from diagnostic visibility.
 */

import fs from "node:fs/promises";
import {
  analyzeAgentScriptSource,
  combineAgentScriptDiagnostics,
  type AgentforceSourceAnalysisResult,
} from "./agentforce-document.ts";
import { buildQuickFixesResult } from "./code-actions.ts";
import {
  identifyDiagnostics,
  identifyQuickFixes,
  sourceVersionFor,
} from "./diagnostic-identity.ts";
import { buildAstHardeningDiagnosticsFromAst } from "./ast-hardening.ts";
import { runAgentScriptQuality } from "./quality/engine.ts";
import type { AgentScriptCheckResult, AgentScriptDiagnostic } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export function isAgentScriptCompileValid(diagnostics: readonly { severity: number }[]): boolean {
  return !diagnostics.some((diagnostic) => diagnostic.severity === 1);
}

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

  return checkAgentScriptSource(source);
}

export async function checkAgentScriptSource(
  source: string,
  existingAnalysis?: AgentforceSourceAnalysisResult,
): Promise<AgentScriptCheckResult> {
  let analysis: AgentforceSourceAnalysisResult | undefined;
  if (existingAnalysis?.ok === true && existingAnalysis.analysis.source === source) {
    analysis = existingAnalysis;
  } else if (existingAnalysis?.ok === false && existingAnalysis.source === source) {
    analysis = existingAnalysis;
  }
  analysis ??= await analyzeAgentScriptSource(source);
  const sourceVersion = sourceVersionFor(source);
  if (analysis.ok === false) {
    return {
      ok: false,
      sourceVersion,
      diagnostics: [],
      quickFixes: [],
      dialect: analysis.dialect,
      failureKind: analysis.failureKind,
      unavailableReason: analysis.unavailableReason,
    };
  }

  const ast = analysis.analysis.documentState.ast;
  const localDiagnostics = ast ? buildAstHardeningDiagnosticsFromAst(ast as never) : [];
  const quality = await runAgentScriptQuality(source, {
    editTimeOnly: true,
    document: {
      source,
      ast,
      hasErrors: analysis.analysis.compileDiagnostics.some(
        (diagnostic) => diagnostic.severity === 1,
      ),
    },
  });
  const qualityDiagnostics: AgentScriptDiagnostic[] = quality.findings
    .filter((finding) => finding.severity === "high")
    .map((finding) => ({
      range: finding.range,
      message: finding.message,
      severity: 2,
      code: finding.rule_id,
      source: "sf-agentscript-quality",
      data: {
        qualitySeverity: finding.severity,
        ruleName: finding.rule_name,
        ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
      },
    }));
  const diagnostics = identifyDiagnostics(
    sourceVersion,
    combineAgentScriptDiagnostics(
      analysis.analysis.compileDiagnostics,
      localDiagnostics,
      qualityDiagnostics,
    ),
  );
  const codeActions = await buildQuickFixesResult(
    source,
    diagnostics,
    analysis.analysis.documentState,
  );
  const quickFixes = identifyQuickFixes(sourceVersion, codeActions.quickFixes);

  return {
    ok: true,
    sourceVersion,
    diagnostics,
    dialect: analysis.analysis.dialect,
    quickFixes,
    codeActionProvider: codeActions.codeActionProvider,
  };
}
