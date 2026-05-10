/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate a syntactically valid Agentforce dialect `.agent` source from a
 * bundle name and an optional job spec. Centralizes our notion of "a
 * reasonable starting point" so the scaffold can evolve in one place.
 *
 * Fields the spec accepts:
 *   description, agent_user, topics: [{name, description?}], variables: [...]
 *
 * Output is always parse-clean against the vendored SDK (we validate after
 * generation; if validation fails, that's a template bug).
 */

import type { AgentJobSpec } from "../create.ts";

export function generateAgentforceDefault(bundleName: string, jobSpec?: AgentJobSpec): string {
  const lines: string[] = [];

  // config block
  lines.push("config:");
  lines.push(`    agent_name: "${escapeString(bundleName)}"`);
  lines.push(
    `    description: "${escapeString(jobSpec?.description ?? `${bundleName} agent (scaffolded by sf-agentscript).`)}"`,
  );
  if (jobSpec?.agent_user) {
    lines.push(`    default_agent_user: "${escapeString(jobSpec.agent_user)}"`);
  }
  lines.push("");

  // system block
  lines.push("system:");
  const instructions =
    jobSpec?.description ??
    "You are a helpful agent. Be concise, professional, and verify customer details before taking action.";
  lines.push("    instructions: |");
  for (const line of instructions.split("\n")) {
    lines.push(`        ${line}`);
  }
  lines.push("");

  // variables block (only when seeded)
  const vars = jobSpec?.variables ?? [];
  if (vars.length > 0) {
    lines.push("variables:");
    for (const v of vars) {
      const modifier = v.mutable ? "mutable " : "";
      const defaultClause = v.default !== undefined ? ` = ${formatVariableDefault(v.default)}` : "";
      lines.push(`    ${v.name}: ${modifier}${v.type}${defaultClause}`);
      if (v.description) {
        lines.push(`        description: "${escapeString(v.description)}"`);
      }
    }
    lines.push("");
  }

  // topic blocks (one per spec entry, or one minimal default if none provided)
  const topics =
    jobSpec?.topics && jobSpec.topics.length > 0
      ? jobSpec.topics
      : [
          {
            name: defaultTopicName(bundleName),
            description: "Primary topic for this agent.",
          },
        ];
  for (const t of topics) {
    lines.push(`topic ${t.name}:`);
    lines.push(`    description: "${escapeString(t.description ?? "")}"`);
    lines.push("");
  }

  // start_agent block — required by the agentforce dialect to anchor execution.
  lines.push("start_agent main:");
  lines.push(`    description: "Entry point for ${escapeString(bundleName)}."`);
  lines.push(`    transition to @topic.${topics[0].name}`);
  lines.push("");

  return lines.join("\n");
}

function defaultTopicName(bundleName: string): string {
  return bundleName.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "main";
}

function escapeString(s: string): string {
  return s.replace(/"/g, '\\"');
}

function formatVariableDefault(value: unknown): string {
  if (typeof value === "string") return `"${escapeString(value)}"`;
  if (typeof value === "boolean") return value ? "True" : "False";
  return JSON.stringify(value);
}
