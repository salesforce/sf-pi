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
import { applyMutation, type MutateOp } from "../mutate.ts";
import { isAgentScriptFile, resolveToolPath } from "../file-classify.ts";
import { toolError, toolOk } from "../tool-types.ts";

export const MUTATE_TOOL_NAME = "agentscript_mutate";

// Discriminated-union parameter schema. Each variant pins the `op` literal and
// the fields that op needs.
const Params = Type.Union([
  Type.Object({
    op: Type.Literal("set_field"),
    path: Type.String(),
    component: Type.String({
      description:
        "Component path. Singular: 'config' or 'system'. Named: 'topic.<name>', 'subagent.<name>', 'actions.<name>', 'variables.<name>'.",
    }),
    field: Type.String(),
    value: Type.Any(),
  }),
  Type.Object({
    op: Type.Literal("rename"),
    path: Type.String(),
    from: Type.String({
      description: "Source component path, e.g. 'topic.billing'.",
    }),
    to: Type.String({
      description:
        "Target component path. Currently only 'topic.X' → 'subagent.X' is AST-supported.",
    }),
  }),
  Type.Object({
    op: Type.Literal("insert"),
    path: Type.String(),
    parent: Type.String(),
    child: Type.Any(),
  }),
  Type.Object({
    op: Type.Literal("delete"),
    path: Type.String(),
    target: Type.String(),
  }),
  Type.Object({
    op: Type.Literal("apply_quick_fix"),
    path: Type.String(),
    diagnostic_code: Type.String({
      description: "Diagnostic code returned by agentscript_compile, e.g. 'deprecated-field'.",
    }),
    line: Type.Number({
      description: "1-based line of the diagnostic (matches compile output).",
    }),
    fix_index: Type.Optional(
      Type.Number({
        description: "Pick a non-default fix when multiple are available. Default 0.",
      }),
    ),
  }),
]);

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
      const op = params as MutateOp;
      const absPath = resolveToolPath(op.path, ctx.cwd);
      if (!isAgentScriptFile(absPath)) {
        return toolError(`Not an Agent Script file: ${absPath}`, "Pass a path ending in `.agent`.");
      }
      const opAbs: MutateOp = { ...op, path: absPath };

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
  },
): string {
  const errors = (result.diagnostics_after ?? []).filter((d) => d.severity === 1).length;
  const warnings = (result.diagnostics_after ?? []).filter((d) => d.severity === 2).length;
  const status = errors === 0 ? "✓ clean" : `❌ ${errors} error(s)`;
  return [
    `🔧 ${result.diff_summary ?? "mutation"} (${result.applied_via})`,
    `${filePath}  Δ ${result.bytes_changed ?? 0} bytes`,
    `Post-compile: ${status}${warnings > 0 ? ` · ${warnings} warning(s)` : ""}`,
  ].join("\n");
}
