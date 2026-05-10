/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_mutate
 *
 * Multi-action structural edit on a `.agent` file with AST-primary,
 * coordinate-fallback semantics. Always re-compiles after writing so
 * `diagnostics_after` lets the LLM self-loop in the same turn.
 *
 * Schema is a typebox discriminated union — required fields per `op` are
 * enforced statically so the LLM gets clear validation.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyMutation, type MutateOp } from "./mutate.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { safeResolveToolPath, toolError, toolOk } from "./tool-types.ts";

export const MUTATE_TOOL_NAME = "agentscript_mutate";

// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-op required-field checks are enforced in
// execute() before delegating to applyMutation.
const Params = Type.Object({
  op: Type.Union(
    [
      Type.Literal("set_field"),
      Type.Literal("rename"),
      Type.Literal("insert"),
      Type.Literal("delete"),
      Type.Literal("apply_quick_fix"),
    ],
    {
      description:
        "set_field: set a singular block ('config'/'system') or a named entry's field. rename: AST-supported only for 'topic.X' → 'subagent.X'. insert / delete: return ast_unsupported today — use the `edit` tool. apply_quick_fix: apply a fix returned by agentscript_compile.",
    },
  ),
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
  // set_field
  component: Type.Optional(
    Type.String({
      description:
        "Required for op='set_field'. Component path. Singular: 'config' or 'system'. Named: 'topic.<name>', 'subagent.<name>', 'actions.<name>', 'variables.<name>'.",
    }),
  ),
  field: Type.Optional(
    Type.String({ description: "Required for op='set_field'. Field name on the component." }),
  ),
  value: Type.Optional(
    Type.Any({
      description: "Required for op='set_field'. The new value (string, number, boolean, etc.).",
    }),
  ),
  // rename
  from: Type.Optional(
    Type.String({
      description: "Required for op='rename'. Source component, e.g. 'topic.billing'.",
    }),
  ),
  to: Type.Optional(
    Type.String({
      description:
        "Required for op='rename'. Target component. Currently only 'topic.X' → 'subagent.X' is AST-supported.",
    }),
  ),
  // insert
  parent: Type.Optional(
    Type.String({ description: "Required for op='insert'. Parent component path." }),
  ),
  child: Type.Optional(
    Type.Any({ description: "Required for op='insert'. Child node to insert." }),
  ),
  // delete
  target: Type.Optional(
    Type.String({ description: "Required for op='delete'. Component path to remove." }),
  ),
  // apply_quick_fix
  diagnostic_code: Type.Optional(
    Type.String({
      description:
        "Required for op='apply_quick_fix'. Diagnostic code returned by agentscript_compile, e.g. 'deprecated-field'.",
    }),
  ),
  line: Type.Optional(
    Type.Number({
      description:
        "Required for op='apply_quick_fix'. 1-based line of the diagnostic (matches compile output).",
    }),
  ),
  fix_index: Type.Optional(
    Type.Number({
      description:
        "Optional for op='apply_quick_fix'. Pick a non-default fix when multiple are available. Default 0.",
    }),
  ),
  // common
  dry_run: Type.Optional(
    Type.Boolean({
      description:
        "When true, return a unified diff + the proposed source without writing to disk. Use to preview a change before committing.",
    }),
  ),
});

interface ParamsAny {
  op: "set_field" | "rename" | "insert" | "delete" | "apply_quick_fix";
  path: string;
  component?: string;
  field?: string;
  value?: unknown;
  from?: string;
  to?: string;
  parent?: string;
  child?: unknown;
  target?: string;
  diagnostic_code?: string;
  line?: number;
  fix_index?: number;
  dry_run?: boolean;
}

function toMutateOp(p: ParamsAny): MutateOp | { ok: false; missing: string[] } {
  const required: Record<ParamsAny["op"], string[]> = {
    set_field: ["component", "field", "value"],
    rename: ["from", "to"],
    insert: ["parent", "child"],
    delete: ["target"],
    apply_quick_fix: ["diagnostic_code", "line"],
  };
  const bag = p as unknown as Record<string, unknown>;
  const missing = required[p.op].filter((k) => bag[k] === undefined);
  if (missing.length > 0) return { ok: false, missing };
  // After the missing-fields check above, every required field is present;
  // cast through `as` to satisfy MutateOp's per-variant required types.
  switch (p.op) {
    case "set_field":
      return {
        op: "set_field",
        path: p.path,
        component: p.component as string,
        field: p.field as string,
        value: p.value,
        dry_run: p.dry_run,
      };
    case "rename":
      return {
        op: "rename",
        path: p.path,
        from: p.from as string,
        to: p.to as string,
        dry_run: p.dry_run,
      };
    case "insert":
      return {
        op: "insert",
        path: p.path,
        parent: p.parent as string,
        child: p.child,
        dry_run: p.dry_run,
      };
    case "delete":
      return {
        op: "delete",
        path: p.path,
        target: p.target as string,
        dry_run: p.dry_run,
      };
    case "apply_quick_fix":
      return {
        op: "apply_quick_fix",
        path: p.path,
        diagnostic_code: p.diagnostic_code as string,
        line: p.line as number,
        fix_index: p.fix_index,
        dry_run: p.dry_run,
      };
  }
}

export function registerMutateTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: MUTATE_TOOL_NAME,
    label: "Agent Script — mutate",
    description:
      "Apply a structural mutation to a `.agent` file. AST-safe via the vendored SDK's Document.mutate when supported (set_field, rename topic→subagent); coordinate fallback for apply_quick_fix; insert/delete return ast_unsupported. Always re-compiles after writing — `diagnostics_after` shows the result of the change in the same turn.",
    promptSnippet:
      "Edit a .agent file structurally with AST safety; auto-recompiles and returns post-mutation diagnostics.",
    promptGuidelines: [
      "Prefer this over the generic `edit` tool whenever the change matches one of the supported ops — it survives whitespace/comment drift and you get diagnostics back in the same turn.",
      "`apply_quick_fix` is the right choice when agentscript_compile returns a diagnostic with a fix; pass diagnostic_code + line as shown.",
      "`set_field` works for singular blocks (config, system) and named entries (topic.<name>, subagent.<name>, actions.<name>, variables.<name>).",
      "`rename` only handles topic.X → subagent.X today (the deprecation case). Other renames return ast_unsupported — fall back to the `edit` tool.",
      "Refuses to mutate a file with existing parse errors — run agentscript_compile and fix severity-1 issues first.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as ParamsAny;
      if (!p.op) return toolError("INVALID_PARAMS", "`op` is required.");
      const resolved = safeResolveToolPath(p.path, ctx.cwd);
      if ("absPath" in resolved === false) return resolved;
      const absPath = resolved.absPath;
      if (!isAgentScriptFile(absPath)) {
        return toolError(`Not an Agent Script file: ${absPath}`, "Pass a path ending in `.agent`.");
      }
      const built = toMutateOp({ ...p, path: absPath });
      if ("missing" in built) {
        return toolError("INVALID_PARAMS", `op='${p.op}' requires: ${built.missing.join(", ")}.`);
      }
      const opAbs = built;
      const op = opAbs;

      const result = await applyMutation(opAbs);
      if (!result.ok) {
        const recover =
          result.reason === "has_parse_errors"
            ? {
                tool: "agentscript_compile",
                params: { path: absPath },
              }
            : result.reason === "sdk_unavailable"
              ? {
                  tool: "sf-agentscript",
                  params: { action: "doctor" },
                }
              : undefined;
        return toolError(
          `Mutate failed (${result.reason ?? "unknown"})`,
          result.reason_detail ?? "See proposal/SKILL.md for supported ops.",
          recover,
        );
      }
      return toolOk(
        {
          ok: true as const,
          path: absPath,
          op: op.op,
          applied_via: result.applied_via,
          diff_summary: result.diff_summary,
          bytes_changed: result.bytes_changed,
          diagnostics_after: result.diagnostics_after,
          ...(result.was_dry_run
            ? {
                was_dry_run: true,
                diff: result.diff,
                preview_source: result.preview_source,
              }
            : {}),
        },
        renderSummary(absPath, result),
      );
    },
  });
}

function renderSummary(
  filePath: string,
  result: {
    applied_via?: string;
    diff_summary?: string;
    bytes_changed?: number;
    diagnostics_after?: { severity: number }[];
    was_dry_run?: boolean;
    diff?: string;
  },
): string {
  if (result.was_dry_run) {
    const truncated = (result.diff ?? "").split("\n").slice(0, 30).join("\n");
    return [
      `🔍 Dry-run: ${result.diff_summary ?? "mutation"} (${result.applied_via})`,
      `${filePath}  Δ ${result.bytes_changed ?? 0} bytes (NOT written)`,
      truncated,
    ].join("\n");
  }
  const errors = (result.diagnostics_after ?? []).filter((d) => d.severity === 1).length;
  const warnings = (result.diagnostics_after ?? []).filter((d) => d.severity === 2).length;
  const status = errors === 0 ? "✓ clean" : `❌ ${errors} error(s)`;
  return [
    `🔧 ${result.diff_summary ?? "mutation"} (${result.applied_via})`,
    `${filePath}  Δ ${result.bytes_changed ?? 0} bytes`,
    `Post-compile: ${status}${warnings > 0 ? ` · ${warnings} warning(s)` : ""}`,
  ].join("\n");
}
