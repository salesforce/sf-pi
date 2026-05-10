/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_inspect
 *
 * Returns a navigable summary of a `.agent` file so the LLM can locate
 * topics / subagents / variables / actions without re-reading the file.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inspectFile } from "../inspect.ts";
import { isAgentScriptFile, resolveToolPath } from "../file-classify.ts";
import { toolError, toolOk } from "../tool-types.ts";

export const INSPECT_TOOL_NAME = "agentscript_inspect";

const Params = Type.Object({
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
});

interface Input {
  path: string;
}

export function registerInspectTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: INSPECT_TOOL_NAME,
    label: "Agent Script — inspect",
    description:
      "Walk a `.agent` file via the vendored Agentforce SDK and return a navigable JSON summary: dialect, config, system, topics, subagents, variables, actions, with line numbers and `@actions.*` / `@subagent.*` / `@variables.*` references.",
    promptSnippet:
      "Get a structured graph of a .agent file (topics / subagents / variables / actions) without reading the file.",
    promptGuidelines: [
      "Use this BEFORE re-reading a `.agent` file — it returns just the structure the agent loop needs (~200 tokens vs ~3000 tokens for a re-read).",
      'Each topic carries `action_refs`, `subagent_refs`, `variable_refs` so you can locate "the topic that calls @actions.X" with one tool call.',
      "Always returns line numbers (1-based) so you can cross-reference compile diagnostics directly.",
      "When `ok: false`, `reason: 'sdk_unavailable'` means the vendored Agentforce SDK failed to load — run `/sf-agentscript doctor`.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Input;
      const filePath = resolveToolPath(input.path, ctx.cwd);
      if (!isAgentScriptFile(filePath)) {
        return toolError(
          `Not an Agent Script file: ${filePath}`,
          "Pass a path ending in `.agent`.",
        );
      }

      const result = await inspectFile(filePath);
      if (!result.ok) {
        if (result.reason === "sdk_unavailable") {
          return toolError(
            `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
            "Run /sf-agentscript doctor to diagnose the vendored bundle.",
            { tool: "sf-agentscript", params: { action: "doctor" } },
          );
        }
        return toolError(`Inspect failed: ${result.reason ?? "unknown"}`, result.reason_detail);
      }

      const summaryText = renderSummary(filePath, result);
      return toolOk(
        {
          ok: true as const,
          path: filePath,
          dialect: result.dialect,
          components: result.components,
          stats: result.stats,
        },
        summaryText,
      );
    },
  });
}

function renderSummary(
  filePath: string,
  result: { dialect?: { name: string; version?: string }; stats?: Record<string, number> },
): string {
  const stats = result.stats ?? {};
  const dialect = result.dialect
    ? `${result.dialect.name}${result.dialect.version ? ` ${result.dialect.version}` : ""}`
    : "unknown";
  return [
    `📋 Inspected ${filePath}`,
    `Dialect: ${dialect}`,
    `Stats: ${stats.topics ?? 0} topics · ${stats.subagents ?? 0} subagents · ` +
      `${stats.variables ?? 0} variables · ${stats.actions ?? 0} actions`,
  ].join("\n");
}
