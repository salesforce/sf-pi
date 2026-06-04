/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate a syntactically valid Agentforce dialect `.agent` source from a
 * bundle name and an optional job spec. Centralizes our notion of "a
 * reasonable starting point" so the scaffold can evolve in one place.
 *
 * Fields the spec accepts:
 *   description, agent_user, topics: [{name, description?}], variables: [...]
 *
 * Output is always parse-clean against the official SDK package (we validate after
 * generation; if validation fails, that's a template bug).
 *
 * agent_type policy (Issue 1 — see docs/POSTMORTEM_E2E_DEMO.md):
 *   - When the caller supplies `job_spec.agent_user`, scaffold a Service
 *     Agent (the user is required for activation; the SDK lints will
 *     enforce that going forward).
 *   - Otherwise, scaffold an Employee Agent (no user required — a fresh
 *     dev/sandbox org can publish + activate with zero extra config).
 *   - Always emit `agent_type` explicitly, never rely on the server-side
 *     default. An implicit type also disables the SDK's
 *     `config-missing-default-agent-user` lint, which silently lets
 *     un-activatable bundles ship.
 */

import { chooseAgentTypeFromSpec } from "./agent-type.ts";
import type { AgentJobSpec } from "../create.ts";

export function generateAgentforceDefault(bundleName: string, jobSpec?: AgentJobSpec): string {
  const lines: string[] = [];
  const { agent_type, default_agent_user } = chooseAgentTypeFromSpec(jobSpec);

  // config block
  lines.push("config:");
  lines.push(`    agent_name: "${escapeString(bundleName)}"`);
  lines.push(`    agent_type: "${agent_type}"`);
  lines.push(
    `    description: "${escapeString(jobSpec?.description ?? `${bundleName} agent (scaffolded by sf-agentscript).`)}"`,
  );
  if (default_agent_user) {
    lines.push(`    default_agent_user: "${escapeString(default_agent_user)}"`);
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
  //
  // sf-pi note: every seeded variable gets a TODO comment immediately above
  // its declaration so the LLM (or human) sees that the scaffold left it
  // unwired. Without that hint, an `unused-variable` warning shows up on
  // the very next compile and there is no signal that the warning is
  // intentional scaffold state. The comment is preserved by the parser and
  // shows up at the right line number in compile diagnostics.
  const vars = jobSpec?.variables ?? [];
  if (vars.length > 0) {
    lines.push("variables:");
    for (const v of vars) {
      const modifier = v.mutable ? "mutable " : "";
      const defaultClause = v.default !== undefined ? ` = ${formatVariableDefault(v.default)}` : "";
      lines.push(
        `    # TODO(sf-pi scaffold): wire @variables.${v.name} into a topic / before_reasoning. Compile will warn 'unused-variable' until then.`,
      );
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
  // Escape `\` first, then `"`, so a literal backslash in user-supplied
  // bundle / topic / variable strings can't slip past the quote-escape pass
  // and break the surrounding agent-script string literal.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatVariableDefault(value: unknown): string {
  if (typeof value === "string") return `"${escapeString(value)}"`;
  if (typeof value === "boolean") return value ? "True" : "False";
  return JSON.stringify(value);
}
