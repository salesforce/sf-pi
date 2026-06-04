/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared lazy adapters around the official AgentScript package pipeline.
 *
 * SF Pi keeps its model-facing output shapes, but generic AgentScript parsing,
 * lint context, references, definitions, code actions, and compilation should
 * come from the official @sf-agentscript packages rather than duplicated local
 * walkers. The imports stay lazy so normal pi startup does not load the full
 * AgentScript toolchain until a `.agent` workflow needs it.
 */

import type { DocumentState, LspParser } from "@sf-agentscript/lsp";
import { getSdkLoadError, loadAgentforceSDK, type AgentforceSDK } from "./sdk.ts";
import type {
  AgentScriptDiagnostic,
  AgentScriptDialectInfo,
  AgentScriptSeverity,
} from "./types.ts";

export const AGENTFORCE_DOCUMENT_URI = "file:///sf-pi/agent.agent";

export interface AgentforceSourceAnalysis {
  sdk: AgentforceSDK;
  dialect?: AgentScriptDialectInfo;
  compileDiagnostics: AgentScriptDiagnostic[];
  documentState?: DocumentState;
}

export type AgentforceSourceAnalysisFailure = {
  ok: false;
  failureKind: "sdk_unavailable" | "compile_threw";
  unavailableReason: string;
  dialect?: AgentScriptDialectInfo;
};

export async function processAgentforceDocument(
  source: string,
  uri = AGENTFORCE_DOCUMENT_URI,
): Promise<DocumentState> {
  const [{ getParser }, { defaultDialects, processDocument }] = await Promise.all([
    import("@sf-agentscript/agentforce"),
    import("@sf-agentscript/lsp"),
  ]);

  const agentforceDialect = defaultDialects.find((dialect) => dialect.name === "agentforce");
  if (!agentforceDialect) {
    throw new Error("@sf-agentscript/lsp did not expose the agentforce dialect.");
  }

  return processDocument(uri, source, {
    dialects: [agentforceDialect],
    defaultDialect: agentforceDialect.name,
    parser: getParser() as unknown as LspParser,
  });
}

/**
 * Run the official compile pipeline plus the LSP document pipeline once for a
 * source string. Callers can layer SF Pi filtering, local hardening diagnostics,
 * quick-fix rendering, or structural projections on the returned facts.
 */
export async function analyzeAgentScriptSource(
  source: string,
): Promise<{ ok: true; analysis: AgentforceSourceAnalysis } | AgentforceSourceAnalysisFailure> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return {
      ok: false,
      failureKind: "sdk_unavailable",
      unavailableReason:
        getSdkLoadError() ?? "The official @sf-agentscript/agentforce SDK failed to load.",
    };
  }

  const dialect = resolveDialectInfo(source, sdk);

  let compileDiagnostics: AgentScriptDiagnostic[];
  try {
    const compileResult = sdk.compileSource(source);
    const rawDiagnostics = Array.isArray(compileResult.diagnostics)
      ? compileResult.diagnostics
      : [];
    compileDiagnostics = rawDiagnostics
      .map((raw) => toAgentScriptDiagnostic(raw))
      .filter((diagnostic): diagnostic is AgentScriptDiagnostic => diagnostic !== null);
  } catch (error) {
    return {
      ok: false,
      dialect,
      failureKind: "compile_threw",
      unavailableReason: `Agent Script SDK threw during compileSource(): ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let documentState: DocumentState | undefined;
  try {
    documentState = await processAgentforceDocument(source);
  } catch {
    // compileDiagnostics remains useful for parser/compiler failures. The LSP
    // document state is best-effort for code actions, references, and symbols.
  }

  return { ok: true, analysis: { sdk, dialect, compileDiagnostics, documentState } };
}

/** Coerce an official SDK/LSP diagnostic into the local stable shape. */
export function toAgentScriptDiagnostic(raw: unknown): AgentScriptDiagnostic | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const range = value.range as
    | { start: { line?: number; character?: number }; end: { line?: number; character?: number } }
    | undefined;
  if (!range || !range.start || !range.end) return null;

  const severity = typeof value.severity === "number" ? (value.severity as AgentScriptSeverity) : 1;
  const message = typeof value.message === "string" ? value.message : "";

  return {
    range: {
      start: { line: range.start.line ?? 0, character: range.start.character ?? 0 },
      end: { line: range.end.line ?? 0, character: range.end.character ?? 0 },
    },
    message,
    severity,
    code: typeof value.code === "string" ? value.code : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
    tags: Array.isArray(value.tags) ? (value.tags as (1 | 2)[]) : undefined,
    data: (value.data ?? undefined) as Record<string, unknown> | undefined,
  };
}

export function resolveDialectInfo(
  source: string,
  sdk: AgentforceSDK | null,
): AgentScriptDialectInfo | undefined {
  if (!sdk) return undefined;

  // Fast path: explicit annotation on the first ~10 lines.
  const annotation = sdk.parseDialectAnnotation(source);
  if (annotation) {
    return { name: annotation.name, version: annotation.version };
  }

  // Otherwise ask the SDK for the resolved dialect using the known dialect list.
  try {
    const resolved = sdk.resolveDialect(source, { dialects: [sdk.agentforceDialect] });
    if (resolved.unknownDialect) {
      return {
        name: resolved.unknownDialect.name,
        unknown: true,
        availableNames: resolved.unknownDialect.availableNames,
      };
    }
    return { name: resolved.dialect.name };
  } catch {
    return undefined;
  }
}
