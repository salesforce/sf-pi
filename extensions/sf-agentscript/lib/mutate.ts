/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal structured mutation for `.agent` files.
 *
 * SF Pi structures only edits that clearly beat generic text editing:
 * targeted scalar field upserts, reference-safe symbol renames, and exact
 * diagnostic quick fixes. Broader source construction/deletion stays with the
 * normal edit tool followed by compile/check.
 *
 * Every write path re-compiles after writing so `diagnostics_after` gives the
 * LLM same-turn feedback. AST paths refuse to mutate files with parse errors —
 * emitting from a half-parsed AST can corrupt source.
 */

import fs from "node:fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { DocumentState } from "@sf-agentscript/lsp";
import type { AgentforceSourceAnalysisResult } from "./agentforce-document.ts";
import { loadAgentforceSDK, getSdkLoadError } from "./sdk.ts";
import { getAgentScriptAnalysis, invalidateAgentScriptAnalysis } from "./analysis-snapshot.ts";
import {
  convertTopicToSubagent,
  findAgentforceDefinitions,
  findAgentforceReferenceEdits,
  formatAgentforceSymbol,
  isDeclarableNavigationNamespace,
  parseAgentforceSymbol,
  renameAgentforceSymbol,
  type AgentforceSymbol,
} from "./agentforce-navigation.ts";
import {
  isNamedComponentKind,
  isSchemaScalarField,
  parseComponentAddress,
} from "./mutation-policy.ts";
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
  candidates?: Array<{ symbol: string; line: number; scope?: Record<string, string> }>;
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
    case "rename": {
      let snapshot = await getAgentScriptAnalysis(op.path);
      if (snapshot.source !== sourceBefore) {
        invalidateAgentScriptAnalysis(op.path);
        snapshot = await getAgentScriptAnalysis(op.path);
      }
      return applyAstRename(op, sourceBefore, await snapshot.getUpstream());
    }
    case "insert":
    case "delete":
      return guidanceForGenericEdit(op);
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
  const compile = await (await getAgentScriptAnalysis(op.path)).getCompile();
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
  const fixes = compile.quickFixes.filter(
    (fix) => fix.diagnosticCode === op.diagnostic_code && fix.diagnosticLine === lineZero,
  );
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
  invalidateAgentScriptAnalysis(op.path);
  const recompile = await (await getAgentScriptAnalysis(op.path)).getCompile();
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

interface MutationHelpers {
  setField(key: string, value: unknown): void;
}

function resolveMutableComponent(
  ast: Record<string, unknown>,
  component: string,
): { ok: true; component: Record<string, unknown> } | { ok: false; error: MutateResult } {
  const parsed = parseComponentAddress(component);
  if (parsed.ok === false) return parsed;
  const { kind, entryName } = parsed.address;

  if (!isNamedComponentKind(kind)) {
    const block = ast[kind];
    if (!block || typeof block !== "object") {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "block_not_found",
          reason_detail: `Block '${kind}' not present in document.`,
        },
      };
    }
    return { ok: true, component: block as Record<string, unknown> };
  }

  const map = ast[kind] as { get?: (n: string) => unknown } | undefined;
  if (!map || typeof map.get !== "function") {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "block_not_found",
        reason_detail: `Named-map block '${kind}' is missing or not iterable.`,
      },
    };
  }
  const entry = map.get(entryName ?? "");
  if (!entry || typeof entry !== "object") {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "entry_not_found",
        reason_detail: `Entry '${component}' not found in '${kind}' map.`,
      },
    };
  }
  return { ok: true, component: entry as Record<string, unknown> };
}

function guidanceForGenericEdit(op: Extract<MutateOp, { op: "insert" | "delete" }>): MutateResult {
  return {
    ok: false,
    reason: "use_generic_edit",
    reason_detail:
      `Structured ${op.op} is intentionally not implemented. Use the generic edit tool ` +
      `for broader source ${op.op === "insert" ? "construction" : "deletion"}, then run ` +
      `agentscript_authoring compile/check to verify the file.`,
  };
}

// -------------------------------------------------------------------------------------------------
// op: set_field  (structured scalar upsert)
// -------------------------------------------------------------------------------------------------

async function applyAstSetField(
  op: Extract<MutateOp, { op: "set_field" }>,
  sourceBefore: string,
  sdk: unknown,
): Promise<MutateResult> {
  const parsed = parseDocument(sourceBefore, sdk);
  if (parsed.ok === false) return parsed.error;
  const { doc } = parsed;

  const target = resolveMutableComponent(
    doc.ast as unknown as Record<string, unknown>,
    op.component,
  );
  if (target.ok === false) return target.error;

  const beforeKeys = getTargetFieldKeys(
    doc.ast as unknown as Record<string, unknown>,
    op.component,
  );
  if (beforeKeys.ok === false) return beforeKeys.error;
  if (!isSchemaScalarField(op.component, op.field)) {
    return {
      ok: false,
      reason: "invalid_field",
      reason_detail:
        `set_field supports first-level scalar fields on existing Agentforce schema components. ` +
        `'${op.field}' is not a scalar field on '${op.component}'. Use the generic edit tool for ` +
        `broader source construction, then run agentscript_authoring compile/check.`,
    };
  }

  const wrappedValue = wrapScalarForAst(op.value, sdk);
  if (wrappedValue.ok === false) {
    return {
      ok: false,
      reason: "unsupported_value_type",
      reason_detail: wrappedValue.reason,
    };
  }

  const mutateComponent = (
    sdk as {
      mutateComponent?: (
        block: Record<string, unknown>,
        fn: (block: Record<string, unknown>, helpers: MutationHelpers) => void,
        options?: { strict?: boolean },
      ) => unknown;
    }
  ).mutateComponent;
  if (typeof mutateComponent !== "function") {
    return {
      ok: false,
      reason: "sdk_unavailable",
      reason_detail: "Official SDK package does not expose mutateComponent.",
    };
  }

  try {
    mutateComponent(
      target.component,
      (_block, helpers) => helpers.setField(op.field, wrappedValue.node),
      { strict: true },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_field",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }

  const after = doc.emit();
  if (after === sourceBefore) {
    return { ok: false, reason: "noop", reason_detail: "Mutation did not change source." };
  }

  const verify = await verifyFieldPresentAfterEmit(after, op.component, op.field, sdk);
  if (verify.ok === false) return verify.error;

  return await commitOrPreview(op, sourceBefore, after, "ast", `set ${op.component}.${op.field}`);
}

// -------------------------------------------------------------------------------------------------
// op: rename  (official semantic providers plus narrow conversion adapters)
// -------------------------------------------------------------------------------------------------

async function applyAstRename(
  op: Extract<MutateOp, { op: "rename" }>,
  sourceBefore: string,
  upstream: AgentforceSourceAnalysisResult,
): Promise<MutateResult> {
  const from = normalizeRenameSymbol(op.from);
  const to = normalizeRenameSymbol(op.to);
  if (from.ok === false) return from.error;
  if (to.ok === false) return to.error;

  if (!isDeclarableNavigationNamespace(from.symbol.namespace)) {
    return unsupportedRename(`Namespace '${from.symbol.namespace}' is not renameable.`);
  }
  if (!isDeclarableNavigationNamespace(to.symbol.namespace)) {
    return unsupportedRename(`Namespace '${to.symbol.namespace}' is not renameable.`);
  }

  if (
    from.symbol.namespace !== to.symbol.namespace &&
    !isTopicSubagentConversion(from.symbol, to.symbol)
  ) {
    return unsupportedRename(
      "Cross-namespace renames are only supported for topic.X ↔ subagent.X conversions.",
    );
  }

  if (upstream.ok === false) {
    return {
      ok: false,
      reason: upstream.failureKind,
      reason_detail: upstream.unavailableReason,
    };
  }
  const compilerDocument = upstream.analysis.compileResult.document;
  if (compilerDocument.hasErrors) {
    return {
      ok: false,
      reason: "has_parse_errors",
      reason_detail:
        "Refusing to mutate a file with existing parse errors. Run agentscript_authoring compile/check and fix severity-1 issues first.",
    };
  }
  const state = upstream.analysis.documentState;

  const after = await (from.symbol.namespace === to.symbol.namespace
    ? renameWithinNamespace(sourceBefore, from.symbol, to.symbol, state)
    : from.symbol.namespace === "topic"
      ? renameTopicToSubagent(sourceBefore, from.symbol, to.symbol, state)
      : renameSubagentToTopic(sourceBefore, from.symbol, to.symbol, state));

  if (after.ok === false) return after.error;
  if (after.source === sourceBefore) {
    return { ok: false, reason: "noop", reason_detail: "Rename produced identical source." };
  }

  return await commitOrPreview(
    op,
    sourceBefore,
    after.source,
    "ast",
    `renamed ${formatSymbol(from.symbol)} → ${formatSymbol(to.symbol)}`,
  );
}

// -------------------------------------------------------------------------------------------------
// Rename helpers
// -------------------------------------------------------------------------------------------------

type RenameSymbol = AgentforceSymbol;

function normalizeRenameSymbol(
  raw: string,
): { ok: true; symbol: RenameSymbol } | { ok: false; error: MutateResult } {
  const parsed = parseAgentforceSymbol(raw);
  if (parsed.ok) return parsed;
  return {
    ok: false,
    error: {
      ok: false,
      reason: "bad_symbol",
      reason_detail: `Rename values must be '@<namespace>.<name>' or '<namespace>.<name>', got '${raw}'.`,
    },
  };
}

const formatSymbol = formatAgentforceSymbol;

function unsupportedRename(reason: string): MutateResult {
  return {
    ok: false,
    reason: "rename_unsupported",
    reason_detail:
      `${reason} Supported structured renames: same-namespace declarable symbols ` +
      `(@subagent.X, @topic.X, @actions.X, @variables.X), plus topic.X ↔ subagent.X ` +
      `conversions with the same name. Use the generic edit tool for broader source rewrites, ` +
      `then run agentscript_authoring compile/check.`,
  };
}

function isTopicSubagentConversion(from: RenameSymbol, to: RenameSymbol): boolean {
  return (
    from.name === to.name &&
    ((from.namespace === "topic" && to.namespace === "subagent") ||
      (from.namespace === "subagent" && to.namespace === "topic"))
  );
}

async function renameWithinNamespace(
  source: string,
  from: RenameSymbol,
  to: RenameSymbol,
  state: DocumentState,
): Promise<{ ok: true; source: string } | { ok: false; error: MutateResult }> {
  if (from.name === to.name) return { ok: true, source };

  const resolved = await resolveSymbol(source, from, state);
  if (resolved.ok === false) return resolved;

  const collision = await findRenameCollision(source, to, resolved.scope, state);
  if (collision.ok === false) return collision;
  if (collision.exists) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "target_exists",
        reason_detail: `${formatSymbol(to)} is already declared in the source symbol's scope. Choose a unique target name.`,
      },
    };
  }

  try {
    const edits = await renameAgentforceSymbol(source, from, to.name, state);
    if (edits.length === 0) {
      return {
        ok: false,
        error: unsupportedRename(
          `The official rename provider returned no edits for ${formatSymbol(from)}.`,
        ),
      };
    }
    return { ok: true, source: applyTextEdits(source, edits) };
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "parse_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function renameTopicToSubagent(
  source: string,
  from: RenameSymbol,
  to: RenameSymbol,
  state: DocumentState,
): Promise<{ ok: true; source: string } | { ok: false; error: MutateResult }> {
  const resolved = await resolveSymbol(source, from, state);
  if (resolved.ok === false) return resolved;

  const collision = await findRenameCollision(source, to, resolved.scope, state);
  if (collision.ok === false) return collision;
  if (collision.exists) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "target_exists",
        reason_detail: `${formatSymbol(to)} is already declared. Remove it before converting the topic.`,
      },
    };
  }

  try {
    const edits = await convertTopicToSubagent(source, from, state);
    if (edits.length === 0) {
      return {
        ok: false,
        error: unsupportedRename(
          `The official topic-to-subagent code action returned no edits for ${formatSymbol(from)}.`,
        ),
      };
    }
    return { ok: true, source: applyTextEdits(source, edits) };
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "parse_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function renameSubagentToTopic(
  source: string,
  from: RenameSymbol,
  to: RenameSymbol,
  state: DocumentState,
): Promise<{ ok: true; source: string } | { ok: false; error: MutateResult }> {
  const resolved = await resolveSymbol(source, from, state);
  if (resolved.ok === false) return resolved;

  const collision = await findRenameCollision(source, to, resolved.scope, state);
  if (collision.ok === false) return collision;
  if (collision.exists) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "target_exists",
        reason_detail: `${formatSymbol(to)} is already declared. Remove it before converting the subagent.`,
      },
    };
  }

  const declarationEdit = declarationKeywordEdit(
    resolved.definitionRange,
    from.namespace,
    to.namespace,
  );
  if (!declarationEdit) {
    return {
      ok: false,
      error: unsupportedRename(
        `Could not locate '${from.namespace}' on the declaration line for ${formatSymbol(from)}.`,
      ),
    };
  }

  try {
    const referenceEdits = await findAgentforceReferenceEdits(
      source,
      from,
      formatSymbol(to),
      state,
    );
    return { ok: true, source: applyTextEdits(source, [declarationEdit, ...referenceEdits]) };
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "parse_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

interface ResolvedRenameSymbol {
  ok: true;
  definitionRange: AgentScriptRange;
  scope: Record<string, string>;
}

async function resolveSymbol(
  source: string,
  symbol: RenameSymbol,
  state: DocumentState,
): Promise<ResolvedRenameSymbol | { ok: false; error: MutateResult }> {
  try {
    const definitions = await findAgentforceDefinitions(source, symbol, state);
    if (definitions.length === 0) {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "entry_not_found",
          reason_detail: `${formatSymbol(symbol)} is not declared.`,
        },
      };
    }
    if (definitions.length > 1) {
      return {
        ok: false,
        error: {
          ok: false,
          reason: "ambiguous_symbol",
          reason_detail: `${formatSymbol(symbol)} has ${definitions.length} declarations. Pass a symbol that resolves uniquely before renaming.`,
          candidates: definitions.map((definition) => ({
            symbol: formatSymbol(symbol),
            line: definition.definitionRange.start.line + 1,
            ...(definition.scope && Object.keys(definition.scope).length > 0
              ? { scope: definition.scope }
              : {}),
          })),
        },
      };
    }
    const definition = definitions[0];
    return {
      ok: true,
      definitionRange: definition.definitionRange,
      scope: definition.scope ?? {},
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "parse_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function findRenameCollision(
  source: string,
  target: RenameSymbol,
  sourceScope: Record<string, string>,
  state: DocumentState,
): Promise<{ ok: true; exists: boolean } | { ok: false; error: MutateResult }> {
  try {
    const definitions = await findAgentforceDefinitions(source, target, state);
    return {
      ok: true,
      exists:
        Object.keys(sourceScope).length === 0
          ? definitions.length > 0
          : definitions.some((definition) => sameScope(definition.scope ?? {}, sourceScope)),
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "parse_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function sameScope(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function declarationKeywordEdit(
  definitionRange: AgentScriptRange,
  fromNamespace: string,
  toNamespace: string,
): AgentScriptQuickFix["edits"][number] | null {
  if (definitionRange.start.line !== definitionRange.end.line) return null;
  return {
    range: {
      start: definitionRange.start,
      end: {
        line: definitionRange.start.line,
        character: definitionRange.start.character + fromNamespace.length,
      },
    },
    newText: toNamespace,
  };
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
// Field-key snapshot + post-emit verification. These helpers ensure set_field
// refuses fields the SDK cannot serialize and catches a silent no-op if a
// future emitter changes how newly inserted scalar fields are represented.
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
  const resolved = resolveMutableComponent(ast, component);
  if (resolved.ok === false) return resolved;
  return { ok: true, keys: keysExcludingCst(resolved.component) };
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
