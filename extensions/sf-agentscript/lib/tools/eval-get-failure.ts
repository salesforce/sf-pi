/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval_get_failure
 *
 * Drill-in companion to agentscript_eval_run. When a run returned the summary
 * view (large run, failures > inline_threshold), the LLM uses this to pull
 * one failure record at a time without reloading the entire suite.
 *
 * If `test_id` is omitted, returns the full failures list for the run.
 */

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFailures, readMetadata } from "../eval/orchestrator.ts";

export const EVAL_GET_FAILURE_TOOL_NAME = "agentscript_eval_get_failure";

const Params = Type.Object({
  run_id: Type.String({
    description: "Run id returned by agentscript_eval_run. Looks like '20260509-181230-a1b2c3'.",
  }),
  test_id: Type.Optional(
    Type.String({
      description:
        "Test id to drill into. If omitted, returns the full failures list (all failed tests for this run).",
    }),
  ),
});

interface Input {
  run_id: string;
  test_id?: string;
}

export function registerEvalGetFailureTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EVAL_GET_FAILURE_TOOL_NAME,
    label: "Agent Script eval — get failure",
    description:
      "Fetch one (or all) failure records from a previously-completed agentscript_eval_run by run_id + test_id. Returns the LLM-shaped FailureRecord with utterance, agent response, topic, actions, llmEvents, executionHistory, plugins, state, and trace pointers.",
    promptSnippet:
      "Drill into a specific failed test from a previous eval run for self-recovery debugging.",
    promptGuidelines: [
      "Use after agentscript_eval_run when the run returned a summary (large run with failures_truncated=true).",
      "Pass test_id to fetch one failure; omit to fetch all failures for the run.",
      "The returned record's `trace_files` field contains absolute paths to per-turn planner traces — read them via the `read` tool for deeper context.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const input = params as Input;
      try {
        const all = await readFailures(ctx.cwd, input.run_id);
        const meta = await readMetadata(ctx.cwd, input.run_id);

        if (input.test_id) {
          const found = all.find((f) => f.test_id === input.test_id);
          if (!found) {
            return errorResult(
              `No failure with test_id='${input.test_id}' in run ${input.run_id}. ` +
                `Available test_ids: ${all.map((f) => f.test_id).join(", ") || "(none)"}.`,
            );
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { run_id: input.run_id, failure: found, run_metadata: meta },
                  null,
                  2,
                ),
              },
            ],
            details: { ok: true, run_id: input.run_id, test_id: input.test_id },
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  run_id: input.run_id,
                  total_failures: all.length,
                  failures: all,
                  run_metadata: meta,
                },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, run_id: input.run_id, total_failures: all.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(msg);
      }
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
