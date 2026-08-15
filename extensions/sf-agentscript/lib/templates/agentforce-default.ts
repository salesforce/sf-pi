/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate a syntactically valid Agentforce dialect `.agent` source from a
 * bundle name and an optional job spec. Centralizes our notion of "a
 * reasonable starting point" so the scaffold can evolve in one place.
 *
 * Fields the spec accepts:
 *   description, agent_user, subagents: [{name, description?}], variables: [...]
 *   (`topics` remains a legacy alias for `subagents`.)
 *
 * Output is always parse-clean against the official SDK package (we validate after
 * generation; if validation fails, that's a template bug).
 *
 * agent_type policy:
 *   - When the caller supplies `job_spec.agent_user`, scaffold a Service
 *     Agent (the user is required for activation; the SDK lints will
 *     enforce that going forward).
 *   - Otherwise, scaffold an Employee Agent (no user required — a fresh
 *     dev/sandbox org can publish inactive, pass the release eval contract, and activate).
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
  lines.push("");

  // access block (Service Agents only)
  if (default_agent_user) {
    lines.push("access:");
    lines.push(`    default_agent_user: "${escapeString(default_agent_user)}"`);
    lines.push("");
  }

  // system block
  lines.push("system:");
  const instructions =
    jobSpec?.description ??
    "You are a helpful agent. Be concise, professional, and verify customer details before taking action.";
  lines.push("    instructions: |");
  for (const line of instructions.split("\n")) {
    lines.push(`        ${line}`);
  }
  lines.push("    messages:");
  lines.push(`        welcome: "Welcome to ${escapeString(bundleName)}. How can I help?"`);
  lines.push('        error: "I could not complete that request. Please try again."');
  lines.push("");

  // variables block (only when seeded)
  //
  // sf-pi note: every seeded variable gets a TODO comment immediately above
  // its declaration so the LLM (or human) sees that the scaffold left it
  // unwired. Without that hint, an actionable `unused-variable` info diagnostic
  // shows up on the very next compile and there is no signal that the cleanup is
  // intentional scaffold state. The comment is preserved by the parser and
  // shows up at the right line number in compile diagnostics.
  const vars = jobSpec?.variables ?? [];
  if (vars.length > 0) {
    lines.push("variables:");
    for (const v of vars) {
      const modifier = v.mutable ? "mutable " : "";
      const defaultClause = v.default !== undefined ? ` = ${formatVariableDefault(v.default)}` : "";
      lines.push(
        `    # TODO(sf-pi scaffold): wire @variables.${v.name} into a subagent / before_reasoning. Compile will report 'unused-variable' until then.`,
      );
      lines.push(`    ${v.name}: ${modifier}${v.type}${defaultClause}`);
      if (v.description) {
        lines.push(`        description: "${escapeString(v.description)}"`);
      }
    }
    lines.push("");
  }

  // Subagent blocks (one per requested responsibility, or one default).
  const requestedSubagents =
    jobSpec?.subagents && jobSpec.subagents.length > 0
      ? jobSpec.subagents
      : jobSpec?.topics && jobSpec.topics.length > 0
        ? jobSpec.topics
        : undefined;
  const subagents = requestedSubagents ?? [
    {
      name: defaultSubagentName(bundleName),
      description: "Primary responsibility for this agent.",
    },
  ];
  for (const subagent of subagents) {
    const responsibility =
      subagent.description?.trim() || `Handle requests assigned to ${subagent.name}.`;
    lines.push(`subagent ${subagent.name}:`);
    lines.push(`    description: "${escapeString(responsibility)}"`);
    lines.push("    reasoning:");
    lines.push("        instructions: ->");
    appendProcedureLines(lines, responsibility, 12);
    lines.push("");
  }

  // The start agent exposes one planner-selectable transition per subagent.
  lines.push("start_agent main:");
  lines.push(`    description: "Route requests for ${escapeString(bundleName)}."`);
  lines.push("    reasoning:");
  lines.push("        instructions: ->");
  lines.push(
    "            | Route the request to the most relevant subagent using exactly one transition action.",
  );
  lines.push("        actions:");
  for (const subagent of subagents) {
    const responsibility =
      subagent.description?.trim() || `Handle requests assigned to ${subagent.name}.`;
    lines.push(
      `            route_to_${subagent.name}: @utils.transition to @subagent.${subagent.name}`,
    );
    lines.push(`                description: "${escapeString(responsibility)}"`);
  }
  lines.push("");

  return lines.join("\n");
}

function defaultSubagentName(bundleName: string): string {
  return bundleName.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "main";
}

function appendProcedureLines(lines: string[], value: string, spaces: number): void {
  const indent = " ".repeat(spaces);
  for (const line of value.split("\n")) lines.push(`${indent}| ${line}`);
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
