/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bare-minimum `.agent` scaffold — only system block. Useful when the LLM
 * wants to author the rest by hand.
 */

import type { AgentJobSpec } from "../create.ts";

export function generateMinimal(bundleName: string, jobSpec?: AgentJobSpec): string {
  const description = jobSpec?.description ?? "You are a helpful agent.";
  const safeName = bundleName.replace(/"/g, '\\"');
  const topicName = bundleName.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "main";
  return [
    "config:",
    `    agent_name: "${safeName}"`,
    `    description: "Minimal scaffold for ${safeName}."`,
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
  ].join("\n");
}
