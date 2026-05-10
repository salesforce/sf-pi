/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Spec normalization — light port of the alias passes from
 * @salesforce/agents src/evalNormalizer.ts.
 *
 * Hand-written specs sometimes drift to camelCase or older planner field
 * names (`plannerDefinitionId`, `planner_version_id`, …). The Evaluation API
 * 400s on unrecognized fields, so we apply a defensive alias remap immediately
 * before POSTing the batch.
 *
 * We intentionally do NOT strip unknown fields. The Vivint regression suite
 * relies on `context_variables` on `agent.send_message` (the workaround for
 * the 2026-04 mutable-seed regression), and the upstream SDK whitelist would
 * remove it. Permissive normalization keeps the workaround intact while still
 * fixing the common drift cases.
 */

import type { EvalSpec, EvalStep } from "./types.ts";

const AGENT_FIELD_ALIASES: Record<string, string> = {
  useAgentApi: "use_agent_api",
  plannerId: "planner_id",
  plannerDefinitionId: "planner_id",
  planner_definition_id: "planner_id",
  plannerVersionId: "planner_id",
  planner_version_id: "planner_id",
  agentId: "agent_id",
  agentVersionId: "agent_version_id",
  sessionId: "session_id",
};

function applyAliases(step: EvalStep, aliases: Record<string, string>): EvalStep {
  const out: Record<string, unknown> = { ...step };
  for (const [src, dst] of Object.entries(aliases)) {
    if (src in out) {
      if (!(dst in out)) out[dst] = out[src];
      delete out[src];
    }
  }
  return out as EvalStep;
}

export function normalizeSpec(spec: EvalSpec): EvalSpec {
  return {
    ...spec,
    tests: (spec.tests ?? []).map((t) => ({
      ...t,
      steps: (t.steps ?? []).map((step) => {
        if (typeof step?.type === "string" && step.type.startsWith("agent.")) {
          return applyAliases(step, AGENT_FIELD_ALIASES);
        }
        return step;
      }),
    })),
  };
}
