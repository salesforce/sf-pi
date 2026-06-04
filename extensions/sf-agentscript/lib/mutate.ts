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
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";
import { checkAgentScriptFile } from "./diagnostics.ts";
import { buildQuickFixes } from "./code-actions.ts";
import type { AgentScriptDiagnostic, AgentScriptQuickFix, AgentScriptRange } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/** Common fields every mutate op accepts. */
interface CommonMutateFields {
  /**
   * When true, compute the post-mutation source and return it as `diff` /
   * `preview_source` without writing to disk. Useful for the LLM to see what
   * a change would do before committing.
   */
  dry_run?: boolean;
}

export type MutateOp =
  | ({
      op: "set_field";
      path: string;
      component: string;
      field: string;
      value: unknown;
    } & CommonMutateFields)
  | ({ op: "rename"; path: string; from: string; to: string } & CommonMutateFields)
  | ({ op: "insert"; path: string; parent: string; child: unknown } & CommonMutateFields)
  | ({ op: "delete"; path: string; target: string } & CommonMutateFields)
  | ({
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index?: number;
    } & CommonMutateFields);

export interface MutateResult {
  ok: boolean;
  applied_via?: "ast" | "coord_fallback";
  diff_summary?: string;
  bytes_changed?: number;
  diagnostics_after?: AgentScriptDiagnostic[];
  reason?: string;
  reason_detail?: string;
  /** Set when dry_run=true. Unified-style diff of the proposed change. */
  diff?: string;
  /** Set when dry_run=true. The full source after the mutation. */
  preview_source?: string;
  /** Set when dry_run=true. The mutation was NOT written to disk. */
  was_dry_run?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export async function applyMutation(op: MutateOp): Promise<MutateResult> {
  return withFileMutationQueue(op.path, () => applyMutationQueued(op));
}

async function applyMutationQueued(op: MutateOp): Promise<MutateResult> {
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
      reason_detail: `No '${op.diagnostic_code}' diagnostic at line ${op.line}. Re-run agentscript_authoring compile/check to get current diagnostics.`,
    };
  }
  const fixes = await buildQuickFixes(sourceBefore, candidates);
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
  return await commitOrPreview(op, sourceBefore, after, "coord_fallback", fix.title);
}

/**
 * Either write `after` to disk and re-compile (default), or — when
 * op.dry_run=true — return a unified diff + the proposed source without
 * touching disk.
 */
async function commitOrPreview(
  op: MutateOp,
  sourceBefore: string,
  after: string,
  appliedVia: "ast" | "coord_fallback",
  diffSummary: string,
): Promise<MutateResult> {
  if (op.dry_run) {
    return {
      ok: true,
      applied_via: appliedVia,
      diff_summary: diffSummary,
      bytes_changed: after.length - sourceBefore.length,
      was_dry_run: true,
      preview_source: after,
      diff: makeUnifiedDiff(op.path, sourceBefore, after),
    };
  }
  // Defensive write: confirm the proposed source is a regression-free
  // rewrite of the original BEFORE clobbering the file on disk. The
  // official SDK package's CST/AST emit has shown rare edge cases where a deep
  // mutation causes emit() to duplicate a small tail of the source
  // (observed live: `set_field` on a deep `topic.escalation.description`
  // appended a partial copy of the file's last line). Pre-write
  // validation catches these without leaving a corrupt file in the
  // user's working tree.
  //
  // Rollback rule: if the proposed source introduces ANY new severity-1
  // diagnostic that wasn't present in the source we received, refuse
  // the write and surface what changed.
  const beforeCheck = await checkAgentScriptFileFromSource(sourceBefore);
  const afterCheck = await checkAgentScriptFileFromSource(after);
  const beforeSev1 = (beforeCheck?.diagnostics ?? [])
    .filter((d) => d.severity === 1)
    .map((d) => `${d.code ?? "(no-code)"}@L${(d.range.start.line ?? 0) + 1}`);
  const afterSev1 = (afterCheck?.diagnostics ?? [])
    .filter((d) => d.severity === 1)
    .map((d) => `${d.code ?? "(no-code)"}@L${(d.range.start.line ?? 0) + 1}`);
  const newSev1 = afterSev1.filter((s) => !beforeSev1.includes(s));
  if (newSev1.length > 0) {
    return {
      ok: false,
      reason: "emit_regression",
      reason_detail:
        `${appliedVia} mutation passed locally but the SDK emit() introduced ` +
        `${newSev1.length} new severity-1 diagnostic(s): ${newSev1.slice(0, 5).join(", ")}. ` +
        `Refusing to write the regression to disk. Run agentscript_authoring compile/check on the ` +
        `current file to confirm it is still clean, then either retry the same mutate ` +
        `(emit edge cases are non-deterministic across runs) or fall back to the ` +
        `generic edit tool for this change.`,
    };
  }

  await fs.writeFile(op.path, after, "utf8");
  const recompile = await checkAgentScriptFile(op.path);
  return {
    ok: true,
    applied_via: appliedVia,
    diff_summary: diffSummary,
    bytes_changed: after.length - sourceBefore.length,
    diagnostics_after: recompile.ok ? recompile.diagnostics : [],
  };
}

/**
 * Run the SDK compile on an in-memory string without touching the disk.
 * Used by `commitOrPreview` to compare the proposed `after` against the
 * `before` source, so we can refuse to write any AST emit that introduces
 * a severity-1 regression. Exported for tests.
 */
export async function checkAgentScriptFileFromSource(source: string): Promise<{
  ok: boolean;
  diagnostics: Array<{ severity?: number; code?: string; range: { start: { line?: number } } }>;
} | null> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) return null;
  try {
    const r = (sdk as { compileSource: (s: string) => { diagnostics?: unknown[] } }).compileSource(
      source,
    );
    const diagnostics = (r.diagnostics ?? []) as Array<{
      severity?: number;
      code?: string;
      range: { start: { line?: number } };
    }>;
    return { ok: true, diagnostics };
  } catch {
    return { ok: false, diagnostics: [] };
  }
}

/**
 * Tiny line-based diff renderer. Sufficient for the LLM's review needs;
 * not a full unified-diff implementation. We use the LCS-free naive form:
 * for each line, mark - if removed, + if added, surrounded by 2 lines of
 * context.
 */
function makeUnifiedDiff(filePath: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim common prefix + suffix.
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let endA = a.length;
  let endB = b.length;
  while (endA > i && endB > i && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ctxBefore = Math.max(0, i - 2);
  const ctxAfterA = Math.min(a.length, endA + 2);
  const ctxAfterB = Math.min(b.length, endB + 2);

  const lines: string[] = [];
  lines.push(`--- ${filePath}`);
  lines.push(`+++ ${filePath} (proposed)`);
  lines.push(
    `@@ -${ctxBefore + 1},${ctxAfterA - ctxBefore} +${ctxBefore + 1},${ctxAfterB - ctxBefore} @@`,
  );
  for (let k = ctxBefore; k < i; k++) lines.push(` ${a[k] ?? ""}`);
  for (let k = i; k < endA; k++) lines.push(`-${a[k] ?? ""}`);
  for (let k = i; k < endB; k++) lines.push(`+${b[k] ?? ""}`);
  for (let k = endA; k < ctxAfterA; k++) lines.push(` ${a[k] ?? ""}`);
  return lines.join("\n");
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

  // ---- Layer 1: refuse to add new fields ---------------------------------
  //
  // set_field UPDATES an existing field. Adding a new field via property
  // assignment on the AST node does NOT propagate to the SDK's emit() — the
  // CST __children list is the source of truth for serialization. Without
  // this guard, an `add` masquerades as a successful update: the tool
  // reports ok=true, the file is unchanged except for whitespace round-trip,
  // and the LLM ships a bundle silently missing the field. Refusing
  // up-front routes the LLM to the generic `edit` tool (which handles new
  // fields correctly) instead of letting it cascade into a broken publish.
  // See docs/POSTMORTEM_E2E_DEMO.md for the original repro.
  const beforeKeys = getTargetFieldKeys(
    doc.ast as unknown as Record<string, unknown>,
    op.component,
  );
  if (beforeKeys.ok === false) return beforeKeys.error;
  if (!beforeKeys.keys.includes(op.field)) {
    const known = beforeKeys.keys.length > 0 ? beforeKeys.keys.join(", ") : "<none>";
    return {
      ok: false,
      reason: "field_not_present",
      reason_detail:
        `set_field updates an existing field. '${op.field}' is not present on '${op.component}' ` +
        `(known fields: ${known}). To add a new field, use the generic edit tool — ` +
        `or scaffold the field via agentscript_authoring create with the appropriate job_spec.`,
    };
  }

  // The official SDK package wraps scalar field values in nodes (StringLiteral,
  // NumberLiteral, BooleanLiteral, etc.) that carry an `__emit()` method.
  // Assigning a raw JS string to `entry.description` corrupts emit() because
  // the value loses its node identity. Wrap the LLM-supplied scalar via
  // parseComponent('...', 'expression') so it lands as a real Literal node.
  const wrappedValue = wrapScalarForAst(op.value, sdk);
  if (wrappedValue.ok === false) {
    return {
      ok: false,
      reason: "unsupported_value_type",
      reason_detail: wrappedValue.reason,
    };
  }
  const valueNode = wrappedValue.node;

  const componentParts = op.component.split(".");
  const head = componentParts[0];

  try {
    if (head === "config" || head === "system") {
      // Singular blocks. Set a top-level field via doc.mutate.
      doc.mutate((ast: Record<string, unknown>) => {
        const block = ast[head] as Record<string, unknown> | undefined;
        if (block) (block as Record<string, unknown>)[op.field] = valueNode;
      });
    } else if (
      head === "topic" ||
      head === "subagent" ||
      head === "actions" ||
      head === "variables"
    ) {
      const entryName = componentParts[1];
      // Layer 1 validated entryName is non-empty and the entry exists.
      doc.mutate((ast: Record<string, unknown>) => {
        const map = ast[head];
        if (!map || typeof (map as { get?: unknown }).get !== "function") return;
        const entry = (map as { get: (n: string) => Record<string, unknown> | undefined }).get(
          entryName,
        );
        if (entry) entry[op.field] = valueNode;
      });
    }
    // No `else` branch: Layer 1's getTargetFieldKeys already returned
    // unknown_component_kind for any other head value.

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

    // ---- Layer 2: post-emit verification -------------------------------
    //
    // Catches any future regression in the SDK's mutate-then-emit path.
    // Re-parses the emitted source and confirms `op.field` is still
    // addressable on the target component. Costs one extra parse per
    // mutate (~1ms on a typical bundle); skipped neither for normal nor
    // for dry_run paths because a dry-run that lies is just as bad.
    const verify = await verifyFieldPresentAfterEmit(after, op.component, op.field, sdk);
    if (verify.ok === false) return verify.error;

    return await commitOrPreview(op, sourceBefore, after, "ast", `set ${op.component}.${op.field}`);
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
    return await commitOrPreview(
      op,
      sourceBefore,
      after,
      "ast",
      `renamed topic.${entryName} → subagent.${entryName}`,
    );
  } catch (err) {
    return {
      ok: false,
      reason: "ast_mutation_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Scalar value wrapping
// -------------------------------------------------------------------------------------------------

/**
 * Wrap a raw LLM-supplied value (string / number / boolean / null) into a
 * properly-shaped AST node so the SDK's emit() round-trips correctly.
 *
 * We avoid `new StringLiteral(...)` — that constructor stores the wrapper
 * object as `.value`, which double-wraps. Instead we use
 * `parseComponent(<source>, 'expression')` which produces a real Literal
 * with the right CST metadata + `__emit`.
 */
function wrapScalarForAst(
  value: unknown,
  sdk: unknown,
): { ok: true; node: unknown } | { ok: false; reason: string } {
  const sdkParseComponent = (sdk as { parseComponent?: (s: string, kind: "expression") => unknown })
    .parseComponent;
  if (typeof sdkParseComponent !== "function") {
    return { ok: false, reason: "SDK does not expose parseComponent" };
  }

  let exprSource: string;
  if (value === null) {
    exprSource = "None";
  } else if (typeof value === "string") {
    // Literal-quote the string. Multi-line strings (with newlines) use the
    // pipe-block form so the SDK round-trips them via their canonical shape.
    exprSource = value.includes("\n")
      ? `|\n${indentLines(value, "    ")}`
      : `"${escapeStringForLiteral(value)}"`;
  } else if (typeof value === "boolean") {
    exprSource = value ? "True" : "False";
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: `Number value ${value} is not finite.` };
    }
    exprSource = String(value);
  } else if (Array.isArray(value)) {
    return {
      ok: false,
      reason:
        "List values are not yet supported by op=set_field. Use the generic edit tool, or open a follow-up to add list-literal wrapping.",
    };
  } else if (value && typeof value === "object") {
    return {
      ok: false,
      reason:
        "Object/dict values are not yet supported by op=set_field. Use the generic edit tool, or open a follow-up to add dict-literal wrapping.",
    };
  } else {
    return { ok: false, reason: `Unsupported value type: ${typeof value}` };
  }

  let node: unknown;
  try {
    node = sdkParseComponent(exprSource, "expression");
  } catch (err) {
    return {
      ok: false,
      reason: `parseComponent failed for '${exprSource.slice(0, 60)}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!node) {
    return {
      ok: false,
      reason: `parseComponent returned no node for '${exprSource.slice(0, 60)}'`,
    };
  }
  return { ok: true, node };
}

function escapeStringForLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indentLines(source: string, indent: string): string {
  return source
    .split("\n")
    .map((l) => `${indent}${l}`)
    .join("\n");
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
          "Refusing to mutate a file with existing parse errors. Run agentscript_authoring compile/check and fix severity-1 issues first.",
      },
    };
  }
  return { ok: true, doc };
}

// -------------------------------------------------------------------------------------------------
// Field-key snapshot + post-emit verification (Issue 3 hotfix — see
// docs/POSTMORTEM_E2E_DEMO.md). These two helpers exist so set_field can
// (a) refuse to add fields it can't actually serialize, and (b) catch the
// silent-no-op class of bug if it ever resurfaces from the SDK side.
// -------------------------------------------------------------------------------------------------

/**
 * Resolve a `component` reference (e.g. 'config', 'system', 'topic.faq')
 * to the list of field keys present on that block/entry in the AST.
 *
 * CST internals (keys starting with `__`) are filtered out — only real,
 * serializable field names are returned. Used for both the pre-mutation
 * sanity check and the post-emit verification.
 */
export function getTargetFieldKeys(
  ast: Record<string, unknown>,
  component: string,
): { ok: true; keys: string[] } | { ok: false; error: MutateResult } {
  const parts = component.split(".");
  const head = parts[0];
  if (head === "config" || head === "system") {
    const block = ast[head];
    if (!block || typeof block !== "object") {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "block_not_found",
          reason_detail: `Block '${head}' not present in document.`,
        },
      };
    }
    return { ok: true, keys: keysExcludingCst(block as Record<string, unknown>) };
  }
  if (head === "topic" || head === "subagent" || head === "actions" || head === "variables") {
    const entryName = parts[1];
    if (!entryName) {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "bad_component",
          reason_detail: `Component '${component}' missing an entry name (e.g. 'topic.billing').`,
        },
      };
    }
    const map = ast[head] as { get?: (n: string) => unknown } | undefined;
    if (!map || typeof map.get !== "function") {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "block_not_found",
          reason_detail: `Named-map block '${head}' is missing or not iterable.`,
        },
      };
    }
    const entry = map.get(entryName);
    if (!entry || typeof entry !== "object") {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "entry_not_found",
          reason_detail: `Entry '${component}' not found in '${head}' map.`,
        },
      };
    }
    return { ok: true, keys: keysExcludingCst(entry as Record<string, unknown>) };
  }
  return {
    ok: false,
    error: {
      ok: false,
      reason: "unknown_component_kind",
      reason_detail:
        `Unknown component kind '${head}'. Supported: config, system, ` +
        `topic.<name>, subagent.<name>, actions.<name>, variables.<name>.`,
    },
  };
}

function keysExcludingCst(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => !k.startsWith("__"));
}

/**
 * Re-parse the emitted source and confirm the target field is still
 * addressable. Catches the class of SDK regression where mutate-then-emit
 * silently drops a field. We refuse to write rather than corrupt the
 * caller's file with a half-applied mutation.
 */
async function verifyFieldPresentAfterEmit(
  emittedSource: string,
  component: string,
  field: string,
  sdk: unknown,
): Promise<{ ok: true } | { ok: false; error: MutateResult }> {
  const parsed = parseDocument(emittedSource, sdk);
  if (parsed.ok === false) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "emit_unparseable",
        reason_detail:
          `AST mutation produced source that no longer parses. This is an SDK bug. ` +
          `Refusing to write — the on-disk file is unchanged.`,
      },
    };
  }
  const keys = getTargetFieldKeys(parsed.doc.ast as unknown as Record<string, unknown>, component);
  if (keys.ok === false) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "emit_verify_failed",
        reason_detail:
          `After mutation, component '${component}' is no longer addressable. ` +
          `This is an SDK bug — refusing to write.`,
      },
    };
  }
  if (!keys.keys.includes(field)) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "emit_verify_failed",
        reason_detail:
          `AST mutation reported success but emit() did not include '${component}.${field}'. ` +
          `This is an SDK bug — refusing to write the silently-empty mutation.`,
      },
    };
  }
  return { ok: true };
}
