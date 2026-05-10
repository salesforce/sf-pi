/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval_trace
 *
 * Ad-hoc planner-trace fetch for a single (session_id, plan_id). Returns the
 * full LLMExecutionStep / UpdateTopicStep / FunctionCallStep / ValidationPromptStep
 * sequence — strictly more detailed than the inline llmEvents the eval API
 * embeds.
 *
 * Two common use cases:
 *  - The run was successful but the LLM still wants to verify what the planner
 *    actually did (e.g. proving a topic was selected for the right reason).
 *  - You're debugging a session created outside of agentscript_eval_run (e.g.
 *    via `sf agent preview`) and want the same trace shape.
 */

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../../lib/common/exec-adapter.ts";
import { fetchTrace } from "../eval/trace-client.ts";

export const EVAL_TRACE_TOOL_NAME = "agentscript_eval_trace";

const Params = Type.Object({
  session_id: Type.String({ description: "Eval-API session_id." }),
  plan_id: Type.String({ description: "Per-turn planId from lastExecution.message.planId." }),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias. Defaults to active org." })),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Per-call timeout. Default 60_000.", minimum: 1000 }),
  ),
});

interface Input {
  session_id: string;
  plan_id: string;
  target_org?: string;
  timeout_ms?: number;
}

export function registerEvalTraceTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: EVAL_TRACE_TOOL_NAME,
    label: "Agent Script eval — trace",
    description:
      "Fetch the full planner trace for one (session_id, plan_id). Returns LLMExecutionStep, UpdateTopicStep, FunctionCallStep, ValidationPromptStep, EventStep, and UserInputStep entries with prompt content + responses + per-step latency.",
    promptSnippet: "Fetch a per-turn planner trace for deep .agent debugging.",
    promptGuidelines: [
      "Use to verify which prompts were sent and which responses came back when the inline llmEvents from an eval run isn't enough.",
      "session_id and plan_id come from the eval response's outputs[*].session_id and lastExecution.message.planId.",
      "404 responses are common for sessions that have been garbage-collected — they are non-fatal and the tool returns ok:false with a clear message.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, _ctx: ExtensionContext) {
      const input = params as Input;
      const targetOrg = input.target_org ?? (await getDefaultOrg(exec));
      if (!targetOrg) {
        return errorResult(
          "No target org. Suggested fix: pass target_org explicitly or set a default with `sf config set target-org=<alias>`.",
        );
      }

      try {
        const trace = await fetchTrace(exec, input.session_id, input.plan_id, targetOrg, {
          timeoutMs: input.timeout_ms ?? 60_000,
        });
        if (trace == null) {
          return errorResult(
            `Trace not found for session=${input.session_id} plan=${input.plan_id}. ` +
              `Suggested fix: confirm both ids and that the session is still resident on the planner.`,
          );
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { session_id: input.session_id, plan_id: input.plan_id, trace },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, session_id: input.session_id, plan_id: input.plan_id },
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

async function getDefaultOrg(exec: ReturnType<typeof buildExecFn>): Promise<string | undefined> {
  try {
    const r = await exec("sf", ["config", "get", "target-org", "--json"], { timeout: 10_000 });
    if (r.code !== 0) return undefined;
    const parsed = JSON.parse(r.stdout) as { result?: Array<{ name?: string; value?: string }> };
    return parsed.result?.find((x) => x.name === "target-org")?.value;
  } catch {
    return undefined;
  }
}
