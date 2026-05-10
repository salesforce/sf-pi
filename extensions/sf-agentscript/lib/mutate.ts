/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Apply mutations to a `.agent` file with AST primary, coordinate fallback.
 *
 * Five operations exposed today; two are AST-safe in this rewrite, three
 * fall back to coordinate edits or return `ast_unsupported` so the LLM
 * uses the generic `edit` tool. Always re-compiles after writing so
 * `diagnostics_after` gives the LLM same-turn feedback.
 *
 *   set_field         AST  — singular blocks (config/system) and named entries
 *                            (topic.X, subagent.X) using doc.mutate()
 *   apply_quick_fix   COORD — applies the SDK-provided TextEdits from
 *                            buildQuickFixes() (matches today's compile-on-save)
 *   rename            AST  — currently topic→subagent only (the one
 *                            deprecation we ship a fix for); other renames
 *                            return ast_unsupported
 *   insert / delete   not yet implemented (return ast_unsupported with a
 *                            hint pointing to the generic `edit` tool)
 *
 * Refuses to mutate when the source already has parse errors — emitting a
 * file from a half-parsed AST corrupts it.
 */

import fs from "node:fs/promises";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";
import { checkAgentScriptFile } from "./diagnostics.ts";
import { buildQuickFixes } from "./code-actions.ts";
import type { AgentScriptDiagnostic, AgentScriptQuickFix, AgentScriptRange } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export type MutateOp =
  | { op: "set_field"; path: string; component: string; field: string; value: unknown }
  | { op: "rename"; path: string; from: string; to: string }
  | { op: "insert"; path: string; parent: string; child: unknown }
  | { op: "delete"; path: string; target: string }
  | {
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index?: number;
    };

export interface MutateResult {
  ok: boolean;
  applied_via?: "ast" | "coord_fallback";
  diff_summary?: string;
  bytes_changed?: number;
  diagnostics_after?: AgentScriptDiagnostic[];
  reason?: string;
  reason_detail?: string;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export async function applyMutation(op: MutateOp): Promise<MutateResult> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return {
      ok: false,
      reason: "sdk_unavailable",
      reason_detail: getSdkLoadError(),
    };
  }

  let sourceBefore: string;
  try {
    sourceBefore = await fs.readFile(op.path, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "read_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  switch (op.op) {
    case "apply_quick_fix":
      return applyCoordFallback(op, sourceBefore);
    case "set_field":
      return applyAstSetField(op, sourceBefore, sdk);
    case "rename":
      return applyAstRename(op, sourceBefore, sdk);
    case "insert":
    case "delete":
      return {
        ok: false,
        reason: "ast_unsupported",
        reason_detail: `Op '${op.op}' not yet implemented. Use the generic edit tool, or apply_quick_fix when the diagnostic ships a fix.`,
      };
  }
}

// -------------------------------------------------------------------------------------------------
// op: apply_quick_fix  (coord fallback — primary path for diagnostic-driven fixes)
// -------------------------------------------------------------------------------------------------

async function applyCoordFallback(
  op: Extract<MutateOp, { op: "apply_quick_fix" }>,
  sourceBefore: string,
): Promise<MutateResult> {
  // Re-compile to get the live diagnostic + its TextEdits. We don't trust
  // a stale fix passed in — line numbers may have shifted.
  const compile = await checkAgentScriptFile(op.path);
  if (!compile.ok) {
    return {
      ok: false,
      reason: "compile_failed",
      reason_detail: compile.unavailableReason,
    };
  }

  const lineZero = op.line - 1; // public API is 1-based
  const candidates = compile.diagnostics.filter(
    (d) => d.code === op.diagnostic_code && d.range.start.line === lineZero,
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "no_matching_diagnostic",
      reason_detail: `No '${op.diagnostic_code}' diagnostic at line ${op.line}. Re-run agentscript_compile to get current diagnostics.`,
    };
  }
  const fixes = buildQuickFixes(sourceBefore, candidates);
  const fix = fixes[op.fix_index ?? 0];
  if (!fix) {
    return {
      ok: false,
      reason: "no_fix_available",
      reason_detail:
        `Diagnostic '${op.diagnostic_code}' has no machine-applyable fix at index ${op.fix_index ?? 0}. ` +
        `Apply via the generic edit tool using the diagnostic message.`,
    };
  }

  const after = applyTextEdits(sourceBefore, fix.edits);
  if (after === sourceBefore) {
    return {
      ok: false,
      reason: "noop",
      reason_detail: "Quick fix produced identical source.",
    };
  }
  await fs.writeFile(op.path, after, "utf8");
  const recompile = await checkAgentScriptFile(op.path);

  return {
    ok: true,
    applied_via: "coord_fallback",
    diff_summary: fix.title,
    bytes_changed: after.length - sourceBefore.length,
    diagnostics_after: recompile.ok ? recompile.diagnostics : [],
  };
}

/**
 * Apply a sorted list of `TextEdit`s to a source string. Edits are applied
 * back-to-front so positions stay valid. We sort defensively even if the
 * caller did.
 */
function applyTextEdits(source: string, edits: AgentScriptQuickFix["edits"]): string {
  const sorted = [...edits].sort((a, b) => {
    const al = a.range.start.line - b.range.start.line;
    if (al !== 0) return -al; // higher line first
    return -(a.range.start.character - b.range.start.character);
  });
  const lines = source.split("\n");
  for (const edit of sorted) {
    applySingleEdit(lines, edit.range, edit.newText);
  }
  return lines.join("\n");
}

function applySingleEdit(lines: string[], range: AgentScriptRange, newText: string): void {
  const { start, end } = range;
  if (start.line === end.line) {
    const line = lines[start.line] ?? "";
    lines[start.line] = line.slice(0, start.character) + newText + line.slice(end.character);
    return;
  }
  // Multi-line edit: collapse the affected lines into the prefix + newText + suffix.
  const startLine = lines[start.line] ?? "";
  const endLine = lines[end.line] ?? "";
  const merged = startLine.slice(0, start.character) + newText + endLine.slice(end.character);
  lines.splice(start.line, end.line - start.line + 1, merged);
}

// -------------------------------------------------------------------------------------------------
// op: set_field  (AST primary)
// -------------------------------------------------------------------------------------------------

async function applyAstSetField(
  op: Extract<MutateOp, { op: "set_field" }>,
  sourceBefore: string,
  sdk: unknown,
): Promise<MutateResult> {
  const parsed = parseDocument(sourceBefore, sdk);
  if (parsed.ok === false) return parsed.error;
  const { doc } = parsed;

  const componentParts = op.component.split(".");
  const head = componentParts[0];

  try {
    if (head === "config" || head === "system") {
      // Singular blocks. Set a top-level field via doc.mutate.
      doc.mutate((ast: Record<string, unknown>) => {
        const block = ast[head] as Record<string, unknown> | undefined;
        if (block) (block as Record<string, unknown>)[op.field] = op.value;
      });
    } else if (
      head === "topic" ||
      head === "subagent" ||
      head === "actions" ||
      head === "variables"
    ) {
      const entryName = componentParts[1];
      if (!entryName) {
        return {
          ok: false,
          reason: "bad_component",
          reason_detail: `Component '${op.component}' missing an entry name (e.g. 'topic.billing').`,
        };
      }
      doc.mutate((ast: Record<string, unknown>) => {
        const map = ast[head];
        if (!map || typeof (map as { get?: unknown }).get !== "function") return;
        const entry = (map as { get: (n: string) => Record<string, unknown> | undefined }).get(
          entryName,
        );
        if (entry) entry[op.field] = op.value;
      });
    } else {
      return {
        ok: false,
        reason: "unknown_component_kind",
        reason_detail: `Unknown component kind '${head}'. Supported: config, system, topic.<name>, subagent.<name>, actions.<name>, variables.<name>.`,
      };
    }

    if (!doc.isDirty) {
      return {
        ok: false,
        reason: "noop",
        reason_detail: `Component '${op.component}' or field '${op.field}' not found; nothing changed.`,
      };
    }
    const after = doc.emit();
    if (after === sourceBefore) {
      return { ok: false, reason: "noop", reason_detail: "Mutation did not change source." };
    }
    await fs.writeFile(op.path, after, "utf8");
    const recompile = await checkAgentScriptFile(op.path);
    return {
      ok: true,
      applied_via: "ast",
      diff_summary: `set ${op.component}.${op.field}`,
      bytes_changed: after.length - sourceBefore.length,
      diagnostics_after: recompile.ok ? recompile.diagnostics : [],
    };
  } catch (err) {
    return {
      ok: false,
      reason: "ast_mutation_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// -------------------------------------------------------------------------------------------------
// op: rename  (AST primary — currently topic→subagent only)
// -------------------------------------------------------------------------------------------------

async function applyAstRename(
  op: Extract<MutateOp, { op: "rename" }>,
  sourceBefore: string,
  sdk: unknown,
): Promise<MutateResult> {
  // Today: only topic.X → subagent.X. The deprecated-field quick-fix
  // already has the deeper @-reference rewrite logic; defer to it via
  // apply_quick_fix when possible.
  const fromMatch = /^topic\.([\w-]+)$/.exec(op.from);
  const toMatch = /^subagent\.([\w-]+)$/.exec(op.to);
  if (!fromMatch || !toMatch || fromMatch[1] !== toMatch[1]) {
    return {
      ok: false,
      reason: "rename_unsupported",
      reason_detail: `Only topic.X → subagent.X renames are AST-supported. Use apply_quick_fix on the deprecated-field diagnostic, or the generic edit tool.`,
    };
  }
  const entryName = fromMatch[1];

  const parsed = parseDocument(sourceBefore, sdk);
  if (parsed.ok === false) return parsed.error;
  const { doc } = parsed;

  try {
    // Move the entry from `topic` to `subagent`. The SDK's addEntry/removeEntry
    // handle the underlying NamedMap + __children sync.
    const ast = doc.ast as Record<string, unknown>;
    const topicMap = ast.topic as { get?: (n: string) => unknown } | undefined;
    const entry = topicMap?.get?.(entryName);
    if (!entry) {
      return {
        ok: false,
        reason: "entry_not_found",
        reason_detail: `Topic '${entryName}' not found.`,
      };
    }
    doc.removeEntry("topic", entryName);
    doc.addEntry("subagent", entryName, entry as never);

    const after = doc.emit();
    if (after === sourceBefore) {
      return { ok: false, reason: "noop", reason_detail: "Rename produced identical source." };
    }
    await fs.writeFile(op.path, after, "utf8");
    const recompile = await checkAgentScriptFile(op.path);

    return {
      ok: true,
      applied_via: "ast",
      diff_summary: `renamed topic.${entryName} → subagent.${entryName}`,
      bytes_changed: after.length - sourceBefore.length,
      diagnostics_after: recompile.ok ? recompile.diagnostics : [],
    };
  } catch (err) {
    return {
      ok: false,
      reason: "ast_mutation_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// -------------------------------------------------------------------------------------------------
// SDK helpers
// -------------------------------------------------------------------------------------------------

interface ParsedDoc {
  ast: Record<string, unknown>;
  isDirty: boolean;
  hasErrors: boolean;
  diagnostics: readonly unknown[];
  emit(): string;
  mutate(fn: (ast: Record<string, unknown>, helpers: unknown) => void): void;
  setField?: (k: string, v: unknown) => void;
  removeField?: (k: string) => void;
  addEntry: (k: string, name: string, value: unknown) => void;
  removeEntry: (k: string, name: string) => void;
}

function parseDocument(
  source: string,
  sdk: unknown,
): { ok: true; doc: ParsedDoc } | { ok: false; error: MutateResult } {
  const parse = (sdk as { parse: (s: string) => unknown }).parse;
  const doc = parse(source) as ParsedDoc;
  if (doc.hasErrors) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "has_parse_errors",
        reason_detail:
          "Refusing to mutate a file with existing parse errors. Run agentscript_compile and fix severity-1 issues first.",
      },
    };
  }
  return { ok: true, doc };
}
