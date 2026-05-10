/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_compile
 *
 * Exposes the existing in-process `.agent` compile (vendored agentforce SDK)
 * as a first-class LLM-callable tool. This is the same pipeline the
 * compile-on-save hook already runs after every successful write/edit; the
 * tool surface lets the LLM trigger it on demand (e.g. to re-check a file
 * after a manual edit, or to warm the SDK before a large refactor).
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkAgentScriptFile } from "../diagnostics.ts";
import { isAgentScriptFile, resolveToolPath } from "../file-classify.ts";

export const COMPILE_TOOL_NAME = "agentscript_compile";

const Params = Type.Object({
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
});

interface Input {
  path: string;
}

export function registerCompileTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: COMPILE_TOOL_NAME,
    label: "Agent Script — compile",
    description:
      "Run the in-process Agent Script parser + compiler against a `.agent` file using the vendored @agentscript/agentforce SDK. Returns severity-1 errors and actionable severity-2 warnings, plus deterministic quick-fix edits when available.",
    promptSnippet:
      "Parse and compile a .agent file in-process and return diagnostics + quick fixes.",
    promptGuidelines: [
      "Use to manually re-check a `.agent` file at any time. Same diagnostics as the automatic compile-on-save hook.",
      "Returns severity-1 errors always; severity-2 warnings are filtered to the actionable subset (those with a deterministic SDK fix).",
      "When the SDK can't load (rare — happens on first run with corrupted vendor bundle), `ok=false` and the error message includes a setup hint.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Input;
      const filePath = resolveToolPath(input.path, ctx.cwd);
      if (!isAgentScriptFile(filePath)) {
        return errorResult(`Not an Agent Script file: ${filePath}`);
      }
      const result = await checkAgentScriptFile(filePath);
      if (!result.ok) {
        return errorResult(
          `Agent Script SDK unavailable: ${result.unavailableReason ?? "unknown reason"}. ` +
            `Suggested fix: run \`/sf-agentscript doctor\` to diagnose.`,
        );
      }

      const summary = {
        ok: true,
        path: filePath,
        clean: result.diagnostics.length === 0,
        diagnostic_count: result.diagnostics.length,
        quick_fix_count: result.quickFixes.length,
        dialect: result.dialect ?? null,
      };

      if (result.diagnostics.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...summary, diagnostics: [], quick_fixes: [] }, null, 2),
            },
          ],
          details: summary,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ...summary,
                diagnostics: result.diagnostics,
                quick_fixes: result.quickFixes,
              },
              null,
              2,
            ),
          },
        ],
        details: summary,
      };
    },
  });
}

function errorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: `❌ ${message}` }],
    details: { ok: false, error: message },
  };
}
