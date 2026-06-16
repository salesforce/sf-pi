/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structural inspection and symbol navigation for `.agent` files.
 *
 * The LLM uses these helpers instead of re-reading whole files. The structural
 * summary is projected in `inspect-structure.ts`; reference/definition lookups
 * delegate to official @sf-agentscript language services where possible.
 */

import fs from "node:fs/promises";
import {
  findAgentforceReferences,
  isDeclarableNavigationNamespace,
  parseAgentforceSymbol,
  resolveAgentforceSymbol,
} from "./agentforce-navigation.ts";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";
import { projectInspectStructure, type InspectResult } from "./inspect-structure.ts";

export type {
  InspectResult,
  ComponentSummary,
  VariableSummary,
  ConnectionSummary,
  ResponseFormatSummary,
  ModalitySummary,
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

export async function inspectSource(source: string): Promise<InspectResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return { ok: false, reason: "sdk_unavailable", reason_detail: getSdkLoadError() };
  }

  let doc: { ast: unknown; hasErrors: boolean; diagnostics: readonly unknown[] };
  try {
    doc = (sdk as unknown as { parse: (s: string) => typeof doc }).parse(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Count severity-1 diagnostics so the LLM knows whether the structural
  // result is trustworthy. Don't fail — the SDK is error-tolerant on purpose.
  let sev1Count = 0;
  for (const diag of doc.diagnostics ?? []) {
    if (((diag as { severity?: number })?.severity ?? 0) === 1) sev1Count += 1;
  }

  const { decomposeAtMemberExpression, walkAstExpressions } =
    await import("@sf-agentscript/language");
  return projectInspectStructure({
    ast: doc.ast,
    dialect: resolveDialectInfo(source, sdk),
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

export async function findReferences(
  filePath: string,
  symbol: string,
): Promise<FindReferencesResult> {
  const sym = parseAgentforceSymbol(symbol, { requireAt: true });
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

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

  const lines = source.split("\n");
  let refs: ReferenceHit[];
  try {
    refs = (await findAgentforceReferences(source, sym.symbol, true)).map((ref) => {
      const lineIdx = ref.range.start.line;
      return {
        line: lineIdx + 1,
        character: ref.range.start.character,
        context: (lines[lineIdx] ?? "").trim().slice(0, 120),
        is_declaration: ref.isDefinition,
      };
    });
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

export async function findDefinition(filePath: string, symbol: string): Promise<DefinitionResult> {
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
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  let definition: Awaited<ReturnType<typeof resolveAgentforceSymbol>>;
  try {
    definition = await resolveAgentforceSymbol(source, sym.symbol);
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
function resolveDialectInfo(source: string, sdk: unknown): InspectResult["dialect"] | undefined {
  const s = sdk as {
    parseDialectAnnotation?: (src: string) => { name?: string; version?: string } | null;
    resolveDialect?: (
      src: string,
      cfg: { dialects: unknown[] },
    ) => {
      dialect?: { name?: string };
      unknownDialect?: { name?: string };
    };
    agentforceDialect?: unknown;
  };

  try {
    const ann = s.parseDialectAnnotation?.(source);
    if (ann?.name) {
      const out: { name: string; version?: string } = { name: ann.name };
      if (ann.version) out.version = ann.version;
      return out;
    }
    if (s.resolveDialect && s.agentforceDialect) {
      const r = s.resolveDialect(source, { dialects: [s.agentforceDialect] });
      if (r.unknownDialect?.name) {
        return { name: r.unknownDialect.name, unknown: true };
      }
      if (r.dialect?.name) return { name: r.dialect.name };
    }
  } catch {
    /* fall through — dialect info is best-effort */
  }
  return undefined;
}
