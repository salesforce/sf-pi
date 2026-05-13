/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared agent_type / default_agent_user resolver for the scaffold templates.
 *
 * One source of truth so `agentforce-default.ts` and `minimal.ts` agree on
 * "what does an empty job_spec mean?" — see docs/POSTMORTEM_E2E_DEMO.md
 * Issue 1 for the full rationale.
 *
 * Decision rule (intentionally binary, no third option):
 *   - job_spec.agent_user present → AgentforceServiceAgent + that user
 *   - job_spec.agent_user absent  → AgentforceEmployeeAgent (no user)
 *
 * Why default to Employee:
 *   - Activation works on a fresh dev/sandbox org with zero extra config.
 *   - First-call success is more important than matching production
 *     patterns; the LLM and the human can switch to Service in a single
 *     two-field edit when needed.
 *   - The vendored SDK's `config-missing-default-agent-user` lint only
 *     fires when `agent_type` is explicitly set; emitting it always means
 *     the lint catches every future divergence.
 */

import type { AgentJobSpec } from "../create.ts";

export type ScaffoldAgentType = "AgentforceEmployeeAgent" | "AgentforceServiceAgent";

export interface ScaffoldAgentTypeChoice {
  agent_type: ScaffoldAgentType;
  default_agent_user?: string;
}

export function chooseAgentTypeFromSpec(spec: AgentJobSpec | undefined): ScaffoldAgentTypeChoice {
  if (spec?.agent_user) {
    return {
      agent_type: "AgentforceServiceAgent",
      default_agent_user: spec.agent_user,
    };
  }
  return { agent_type: "AgentforceEmployeeAgent" };
}
