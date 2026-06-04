/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Structural inspection and symbol navigation for `.agent` files.
 *
 * The LLM uses these helpers instead of re-reading whole files. The structural
 * summary is projected in `inspect-structure.ts`; reference/definition lookups
 * delegate to official @sf-agentscript language services where possible.
 */

import fs from "node:fs/promises";
import { processAgentforceDocument } from "./agentforce-document.ts";
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
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return { ok: false, reason: "sdk_unavailable", reason_detail: getSdkLoadError() };
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

  const { walkAstExpressions } = await import("@sf-agentscript/language");
  return projectInspectStructure({
    ast: doc.ast,
    dialect: resolveDialectInfo(source, sdk),
    hasParseErrors: sev1Count > 0,
    parseErrorCount: sev1Count,
    walkAstExpressions,
  });
}

// findReferences — walk AST expressions, collect every `@<ns>.<prop>` matching the symbol
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

function parseSymbol(
  symbol: string,
): { ok: true; namespace: string; property: string } | { ok: false; reason: string } {
  const m = /^@([\w-]+)\.([\w-]+)$/.exec(symbol);
  if (!m) {
    return {
      ok: false,
      reason: `Symbol must be of the form '@<namespace>.<property>', got '${symbol}'.`,
    };
  }
  return { ok: true, namespace: m[1], property: m[2] };
}

const DEFINITION_NAMESPACES = new Set(["topic", "subagent", "actions", "variables"]);

export async function findReferences(
  filePath: string,
  symbol: string,
): Promise<FindReferencesResult> {
  const sym = parseSymbol(symbol);
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

  let state: Awaited<ReturnType<typeof processAgentforceDocument>>;
  try {
    state = await processAgentforceDocument(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const lines = source.split("\n");
  const { findAllReferences } = await import("@sf-agentscript/language");
  const refs: ReferenceHit[] = state.ast
    ? (
        findAllReferences(
          state.ast,
          sym.namespace,
          sym.property,
          state.service.schemaContext,
          undefined,
          true,
          state.service.getSymbols(),
        ) as Array<{
          range: { start: { line: number; character: number } };
          isDefinition: boolean;
        }>
      ).map((ref) => {
        const lineIdx = ref.range.start.line;
        return {
          line: lineIdx + 1,
          character: ref.range.start.character,
          context: (lines[lineIdx] ?? "").trim().slice(0, 120),
          is_declaration: ref.isDefinition,
        };
      })
    : [];

  refs.sort((a, b) => Number(b.is_declaration) - Number(a.is_declaration) || a.line - b.line);

  return { ok: true, symbol, references: refs, total: refs.length };
}

export async function findDefinition(filePath: string, symbol: string): Promise<DefinitionResult> {
  const sym = parseSymbol(symbol);
  if (sym.ok === false) return { ok: false, reason: "bad_symbol", reason_detail: sym.reason };

  if (!DEFINITION_NAMESPACES.has(sym.namespace)) {
    return {
      ok: false,
      reason: "bad_symbol",
      reason_detail: `Namespace '${sym.namespace}' is not declarable. Supported: @topic.X, @subagent.X, @actions.X, @variables.X.`,
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

  let state: Awaited<ReturnType<typeof processAgentforceDocument>>;
  try {
    state = await processAgentforceDocument(source);
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!state.ast) {
    return { ok: false, reason: "not_found", reason_detail: `${symbol} has no AST.` };
  }

  const { resolveReference } = await import("@sf-agentscript/language");
  const definition = resolveReference(
    state.ast,
    sym.namespace,
    sym.property,
    state.service.schemaContext,
    undefined,
    state.service.getSymbols(),
  ) as { definitionRange?: { start?: { line?: number; character?: number } } } | null;

  const start = definition?.definitionRange?.start;
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
