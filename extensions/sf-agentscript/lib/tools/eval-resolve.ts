/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval_resolve
 *
 * Resolve $active_bot_id / $active_bot_version_id / $active_planner_id from
 * the live org's Active BotVersion. Used by spec authors who want to bake
 * concrete ids into their specs (or by the LLM when debugging why a spec is
 * targeting a different version than expected).
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../../lib/common/exec-adapter.ts";
import { resolveActiveIds } from "../eval/orchestrator.ts";

export const EVAL_RESOLVE_TOOL_NAME = "agentscript_eval_resolve";

const Params = Type.Object({
  agent_api_name: Type.String({
    description: "Bot DeveloperName (e.g. 'My_Agent_v1').",
  }),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias. Defaults to active org." })),
});

interface Input {
  agent_api_name: string;
  target_org?: string;
}

export function registerEvalResolveTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: EVAL_RESOLVE_TOOL_NAME,
    label: "Agent Script eval — resolve active ids",
    description:
      "Look up the Active BotVersion id, BotDefinition id, and matching planner id for an Agent in the target org. Use this to bake $active_* values into a spec, or to verify which version a regression run is hitting.",
    promptSnippet:
      "Resolve Active BotVersion id + planner id for an agent (used to materialize $active_* placeholders).",
    promptGuidelines: [
      "Always returns the *Active* version (not the latest draft). If no Active version exists, errors with a setup hint.",
      "Pass target_org when the agent lives in a different org than the active sf-pi default.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const input = params as Input;
      const targetOrg = input.target_org ?? (await getDefaultOrg(exec));
      if (!targetOrg) {
        return errorResult(
          "No target org. Suggested fix: pass target_org explicitly or set a default with `sf config set target-org=<alias>`.",
        );
      }
      try {
        const ids = await resolveActiveIds(exec, input.agent_api_name, targetOrg);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agent_api_name: input.agent_api_name,
                  target_org: targetOrg,
                  bot_id: ids.bot_id,
                  bot_version_id: ids.bot_version_id,
                  version_number: ids.version_number,
                  planner_id: ids.planner_id,
                  $active_bot_id: ids.bot_id,
                  $active_bot_version_id: ids.bot_version_id,
                  $active_planner_id: ids.planner_id,
                },
                null,
                2,
              ),
            },
          ],
          details: { ok: true, ...ids },
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
