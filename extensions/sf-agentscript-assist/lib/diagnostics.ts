/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Run the vendored SDK over a `.agent` file and produce a filtered,
 * agent-friendly result.
 *
 * Decision rules (see README for the agent-facing behavior matrix):
 *
 *   Severity 1 (Error)            always included
 *   Severity 2 (Warning)          included only for known-actionable codes
 *   Severity 3/4 (Info/Hint)      always dropped
 *
 * Actionable warning codes are the ones the SDK ships with a machine-applyable
 * fix (`code-actions.ts` knows how to build TextEdits for them). We keep the
 * allowlist explicit so the agent never sees a low-value warning it can't act
 * on.
 */

import fs from "node:fs/promises";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";
import { buildQuickFixes } from "./code-actions.ts";
import type {
  AgentScriptCheckResult,
  AgentScriptDiagnostic,
  AgentScriptDialectInfo,
  AgentScriptSeverity,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Actionability filter
// -------------------------------------------------------------------------------------------------

/**
 * Severity-2 warning codes that are worth surfacing to the agent because the
 * SDK ships a deterministic fix for them. Everything else at severity 2+
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
// Type narrowing of SDK output
// -------------------------------------------------------------------------------------------------

/**
 * Coerce an SDK diagnostic into our local shape.
 *
 * The SDK diagnostic type is the LSP-compatible one — same field names, same
 * semantics. We copy defensively so nothing downstream mutates SDK internals.
 */
function toAgentScriptDiagnostic(raw: unknown): AgentScriptDiagnostic | null {
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

// -------------------------------------------------------------------------------------------------
// Dialect resolution
// -------------------------------------------------------------------------------------------------

function resolveDialectInfo(
  source: string,
  sdk: Awaited<ReturnType<typeof loadAgentforceSDK>>,
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
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      unavailableReason:
        getSdkLoadError() ?? "The vendored @agentscript/agentforce SDK failed to load.",
    };
  }

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      unavailableReason: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const dialect = resolveDialectInfo(source, sdk);

  // Declared without an initializer on purpose: the try block always writes
  // a value before the next use, and the catch arm returns. A pre-assignment
  // here would be dead code flagged by `no-useless-assignment`.
  let rawDiagnostics: unknown[];
  try {
    const compileResult = sdk.compileSource(source);
    rawDiagnostics = Array.isArray(compileResult.diagnostics) ? compileResult.diagnostics : [];
  } catch (error) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      dialect,
      unavailableReason: `Agent Script SDK threw during compileSource(): ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const all = rawDiagnostics
    .map((raw) => toAgentScriptDiagnostic(raw))
    .filter((diagnostic): diagnostic is AgentScriptDiagnostic => diagnostic !== null);

  const filtered = all.filter(isActionable);
  const quickFixes = buildQuickFixes(source, filtered);

  return {
    ok: true,
    diagnostics: filtered,
    dialect,
    quickFixes,
  };
}
