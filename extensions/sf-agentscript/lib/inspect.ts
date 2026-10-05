/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structural inspection and symbol navigation for `.agent` files.
 *
 * The LLM uses these helpers instead of re-reading whole files. The structural
 * summary is projected in `inspect-structure.ts`; reference/definition lookups
 * delegate to official @sf-agentscript language services where possible.
 */

import fs from "node:fs/promises";
import type { DocumentState } from "@sf-agentscript/lsp";
import {
  findAgentforceReferences,
  isDeclarableNavigationNamespace,
  parseAgentforceSymbol,
  resolveAgentforceSymbol,
} from "./agentforce-navigation.ts";
import {
  analyzeAgentScriptSource,
  type AgentforceSourceAnalysisResult,
} from "./agentforce-document.ts";
import { projectInspectStructure, type InspectResult } from "./inspect-structure.ts";

export type {
  InspectResult,
  ComponentSummary,
  ConnectedSubagentSummary,
  StateBranchSummary,
  StateScalar,
  StateUpdateSummary,
  VariableSummary,
  ConnectionSummary,
  ResponseFormatSummary,
  ModalitySummary,
  BlockSummary,
} from "./inspect-structure.ts";

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export async function inspectFile(filePath: string): Promise<InspectResult> {
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  return inspectSource(source);
}

export async function inspectSource(
  source: string,
  existingAnalysis?: AgentforceSourceAnalysisResult,
): Promise<InspectResult> {
  let result: AgentforceSourceAnalysisResult | undefined;
  if (existingAnalysis?.ok === true && existingAnalysis.analysis.source === source) {
    result = existingAnalysis;
  } else if (existingAnalysis?.ok === false && existingAnalysis.source === source) {
    result = existingAnalysis;
  }
  result ??= await analyzeAgentScriptSource(source);
  if (result.ok === false) {
    return {
      ok: false,
      reason: result.failureKind === "sdk_unavailable" ? "sdk_unavailable" : "parse_failed",
      reason_detail: result.unavailableReason,
    };
  }
  const analysis = result.analysis;

  // Count severity-1 diagnostics so the LLM knows whether the structural
  // result is trustworthy. Don't fail — the SDK is error-tolerant on purpose.
  const sev1Count = analysis.documentState.service.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 1,
  ).length;

  const { decomposeAtMemberExpression, walkAstExpressions } =
    await import("@sf-agentscript/language");
  return projectInspectStructure({
    ast: analysis.documentState.ast,
    dialect: analysis.dialect,
    hasParseErrors: sev1Count > 0,
    parseErrorCount: sev1Count,
    walkAstExpressions,
    decomposeAtMemberExpression,
  });
}

// findReferences — upstream navigation adapter over explicit `@<ns>.<prop>` symbols
// -------------------------------------------------------------------------------------------------

export interface ReferenceHit {
  line: number;
  character: number;
  context: string;
  is_declaration: boolean;
}

export interface FindReferencesResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "bad_symbol";
  reason_detail?: string;
  symbol?: string;
  references?: ReferenceHit[];
  total?: number;
}

export interface DefinitionResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed" | "bad_symbol" | "not_found";
  reason_detail?: string;
  symbol?: string;
  line?: number;
  character?: number;
  file?: string;
}

interface ExistingNavigationAnalysis {
  source: string;
  state: DocumentState;
}

export async function findReferences(
  filePath: string,
  symbol: string,
  existing?: ExistingNavigationAnalysis,
): Promise<FindReferencesResult> {
  const sym = parseAgentforceSymbol(symbol, { requireAt: true });
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

  let source: string;
  try {
    source = existing?.source ?? (await fs.readFile(filePath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const lines = source.split("\n");
  let refs: ReferenceHit[];
  try {
    refs = (await findAgentforceReferences(source, sym.symbol, true, existing?.state)).map(
      (ref) => {
        const lineIdx = ref.range.start.line;
        return {
          line: lineIdx + 1,
          character: ref.range.start.character,
          context: (lines[lineIdx] ?? "").trim().slice(0, 120),
          is_declaration: ref.isDefinition,
        };
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  refs.sort((a, b) => Number(b.is_declaration) - Number(a.is_declaration) || a.line - b.line);

  return { ok: true, symbol, references: refs, total: refs.length };
}

export async function findDefinition(
  filePath: string,
  symbol: string,
  existing?: ExistingNavigationAnalysis,
): Promise<DefinitionResult> {
  const sym = parseAgentforceSymbol(symbol, { requireAt: true });
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

  if (!isDeclarableNavigationNamespace(sym.symbol.namespace)) {
    return {
      ok: false,
      reason: "bad_symbol",
      reason_detail: `Namespace '${sym.symbol.namespace}' is not declarable. Supported: @topic.X, @subagent.X, @actions.X, @variables.X.`,
    };
  }

  let source: string;
  try {
    source = existing?.source ?? (await fs.readFile(filePath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  let definition: Awaited<ReturnType<typeof resolveAgentforceSymbol>>;
  try {
    definition = await resolveAgentforceSymbol(source, sym.symbol, existing?.state);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const start = definition?.definitionRange.start;
  if (typeof start?.line !== "number") {
    return { ok: false, reason: "not_found", reason_detail: `${symbol} is not declared.` };
  }

  return {
    ok: true,
    symbol,
    line: start.line + 1,
    character: start.character ?? 0,
    file: filePath,
  };
}
