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
  source: string;
  sdk: AgentforceSDK;
  dialect?: AgentScriptDialectInfo;
  compileDiagnostics: AgentScriptDiagnostic[];
  documentState: DocumentState;
}

export type AgentforceSourceAnalysisFailure = {
  ok: false;
  source: string;
  failureKind: "sdk_unavailable" | "compile_threw";
  unavailableReason: string;
  dialect?: AgentScriptDialectInfo;
};

export async function processAgentforceDocument(
  source: string,
  uri = AGENTFORCE_DOCUMENT_URI,
  options: { compile?: boolean } = {},
): Promise<DocumentState> {
  // The LSP is dialect-agnostic. Inject the dialect paired with the same SDK
  // parser/compiler instead of depending on registry names that can change.
  const [agentforce, lsp] = await Promise.all([
    import("@sf-agentscript/agentforce"),
    import("@sf-agentscript/lsp"),
  ]);
  const agentforceDialect =
    agentforce.agentforceDialect as unknown as (typeof lsp.defaultDialects)[number];

  return lsp.processDocument(uri, source, {
    dialects: [agentforceDialect],
    defaultDialect: agentforceDialect.name,
    parser: agentforce.getParser() as unknown as LspParser,
    compile: options.compile
      ? (dialectName) =>
          dialectName === "agentforce"
            ? {
                compile: (ast) => agentforce.compile(ast as never),
              }
            : undefined
      : undefined,
  });
}

/**
 * Run the official compile pipeline plus the LSP document pipeline once for a
 * source string. Callers can layer SF Pi filtering, local hardening diagnostics,
 * quick-fix rendering, or structural projections on the returned facts.
 */
export type AgentforceSourceAnalysisResult =
  { ok: true; analysis: AgentforceSourceAnalysis } | AgentforceSourceAnalysisFailure;

export async function analyzeAgentScriptSource(
  source: string,
): Promise<AgentforceSourceAnalysisResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return {
      ok: false,
      source,
      failureKind: "sdk_unavailable",
      unavailableReason:
        getSdkLoadError() ?? "The official @sf-agentscript/agentforce SDK failed to load.",
    };
  }

  const dialect = resolveDialectInfo(source, sdk);

  let documentState: DocumentState;
  try {
    // processDocument parses, lints, indexes, and compiles from one AST. Avoid
    // running compileSource first, which repeats the complete local pipeline.
    documentState = await processAgentforceDocument(source, AGENTFORCE_DOCUMENT_URI, {
      compile: true,
    });
  } catch (error) {
    return {
      ok: false,
      source,
      dialect,
      failureKind: "compile_threw",
      unavailableReason: `Agent Script SDK threw during analysis: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const compileDiagnostics = combineAgentScriptDiagnostics(documentState.diagnostics);

  return {
    ok: true,
    analysis: {
      source,
      sdk,
      dialect,
      compileDiagnostics,
      documentState,
    },
  };
}

export function combineAgentScriptDiagnostics(
  ...sources: ReadonlyArray<readonly unknown[]>
): AgentScriptDiagnostic[] {
  const combined: AgentScriptDiagnostic[] = [];
  for (const raw of sources.flat()) {
    const diagnostic = toAgentScriptDiagnostic(raw);
    if (!diagnostic) continue;
    const index = combined.findIndex(
      (previous) =>
        sameDiagnosticLocationAndMessage(previous, diagnostic) &&
        (previous.code === diagnostic.code || !previous.code || !diagnostic.code),
    );
    if (index === -1) {
      combined.push(diagnostic);
      continue;
    }

    const previous = combined[index];
    const primary = previous.code ? previous : diagnostic.code ? diagnostic : previous;
    const secondary = primary === previous ? diagnostic : previous;
    const tags = Array.from(new Set([...(previous.tags ?? []), ...(diagnostic.tags ?? [])]));
    combined[index] = {
      ...primary,
      severity: Math.min(previous.severity, diagnostic.severity) as AgentScriptSeverity,
      ...(tags.length > 0 ? { tags } : {}),
      data:
        primary.data || secondary.data
          ? { ...(secondary.data ?? {}), ...(primary.data ?? {}) }
          : undefined,
    };
  }
  return combined.sort(
    (left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.character - right.range.start.character ||
      left.severity - right.severity ||
      String(left.code ?? "").localeCompare(String(right.code ?? "")),
  );
}

function sameDiagnosticLocationAndMessage(
  left: AgentScriptDiagnostic,
  right: AgentScriptDiagnostic,
): boolean {
  return (
    left.message === right.message &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character
  );
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
