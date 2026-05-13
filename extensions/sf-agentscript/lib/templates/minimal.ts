/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bare-minimum `.agent` scaffold — only system block. Useful when the LLM
 * wants to author the rest by hand.
 *
 * agent_type follows the same Issue 1 rule as agentforce-default: explicit
 * `AgentforceEmployeeAgent` by default, `AgentforceServiceAgent` + user
 * when `job_spec.agent_user` is supplied. See ./agent-type.ts.
 */

import { chooseAgentTypeFromSpec } from "./agent-type.ts";
import type { AgentJobSpec } from "../create.ts";

export function generateMinimal(bundleName: string, jobSpec?: AgentJobSpec): string {
  const description = jobSpec?.description ?? "You are a helpful agent.";
  const safeName = bundleName.replace(/"/g, '\\"');
  const topicName = bundleName.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "main";
  const { agent_type, default_agent_user } = chooseAgentTypeFromSpec(jobSpec);
  const lines = [
    "config:",
    `    agent_name: "${safeName}"`,
    `    agent_type: "${agent_type}"`,
    `    description: "Minimal scaffold for ${safeName}."`,
  ];
  if (default_agent_user) {
    const safeUser = default_agent_user.replace(/"/g, '\\"');
    lines.push(`    default_agent_user: "${safeUser}"`);
  }
  lines.push(
    "",
    "system:",
    "    instructions: |",
    `        ${description}`,
    "",
    `topic ${topicName}:`,
    '    description: "Primary topic."',
    "",
    "start_agent main:",
    `    description: "Entry point for ${safeName}."`,
    `    transition to @topic.${topicName}`,
    "",
  );
  return lines.join("\n");
}
