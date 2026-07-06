/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rule-derived agent guidance for sf-guardrail.
 *
 * This renderer turns the effective config into the hidden `<sf_guardrail>`
 * message injected before the agent starts. It is intentionally deterministic
 * and compact so rule changes update agent guidance without maintaining a
 * second policy prompt by hand.
 */
import { OPERATOR_AUTO_APPROVE_ENV, OPERATOR_AUTO_APPROVE_VALUE } from "./hitl.ts";
import { labelForRuleBehavior, resolveRuleBehavior } from "./rule-behavior.ts";
import type { GuardrailConfig, OrgAwareRule, ShellAstMatch } from "./types.ts";

export function renderGuardrailGuidance(config: GuardrailConfig): string {
  const lines: string[] = [
    "<sf_guardrail>",
    "Active: a local safety layer is mediating your tool calls. You do not need to ask the",
    "user to turn it off; operate normally and it will only interrupt for configured risks.",
    "When it does, wait for the human's response.",
    "",
  ];

  lines.push("File protection:");
  const activePolicies = config.policies.rules.filter(
    (rule) => resolveRuleBehavior(rule) !== "off",
  );
  if (activePolicies.length === 0) {
    lines.push("- No active file-protection rules.");
  } else {
    for (const rule of activePolicies) {
      const access = rule.protection === "readOnly" ? "read-only" : rule.protection;
      const behavior = labelForRuleBehavior(resolveRuleBehavior(rule));
      lines.push(
        `- ${rule.description ?? rule.id}: ${behavior}; ${access}; patterns ${formatList(rule.patterns.map((p) => p.pattern))}`,
      );
      if (rule.allowedPatterns?.length) {
        lines.push(
          `  allowed carve-outs: ${formatList(rule.allowedPatterns.map((p) => p.pattern))}`,
        );
      }
    }
  }

  lines.push("", "Dangerous-command confirmation:");
  const activeCommands = config.commandGate.patterns.filter(
    (pattern) => resolveRuleBehavior(pattern) !== "off",
  );
  if (activeCommands.length === 0) {
    lines.push("- No active dangerous-command patterns.");
  } else {
    for (const pattern of activeCommands) {
      const behavior = labelForRuleBehavior(resolveRuleBehavior(pattern));
      lines.push(
        `- ${pattern.pattern}${pattern.description ? ` (${pattern.description})` : ""}: ${behavior}`,
      );
    }
  }

  lines.push("", "Org-aware confirmation:");
  const activeOrgRules = config.orgAwareGate.rules.filter(
    (rule) => resolveRuleBehavior(rule) !== "off",
  );
  if (activeOrgRules.length === 0) {
    lines.push("- No active org-aware rules.");
  } else {
    for (const rule of activeOrgRules) {
      lines.push(`- ${formatOrgAwareRule(rule)}`);
    }
  }

  lines.push(
    "",
    "Target-org resolution:",
    "- Parse -o <alias> / --target-org <alias> from the command.",
    "- Else use the default-org alias from <sf_environment>.",
    "- Explicit non-default aliases may be resolved with a bounded cached org lookup.",
    "- If unresolvable, the guardrail treats the org as production (fail-closed).",
    "",
    "Implications for how you should work:",
    "- Prefer `sf project deploy validate` and `--check-only` on production.",
    "- Prefer `Savepoint sp = Database.setSavepoint(); ... Database.rollback(sp);` for anonymous-apex DML rehearsals on production.",
    `- In headless / non-interactive mode, gated calls fail closed unless ${config.headlessEscapeHatchEnv}=1 is set.`,
    `- Operator auto-approve mode is env-only: ${OPERATOR_AUTO_APPROVE_ENV}=${OPERATOR_AUTO_APPROVE_VALUE}. It auto-approves confirm-class decisions but never hard blocks, and every pass is audited.`,
    "",
    "Override: `/sf-guardrail` shows active rules, recent decisions, and active approval state.",
    "Users may choose a scoped allow at the confirmation dialog; session approvals persist via pi's session entries and can be revoked with `/sf-guardrail forget`.",
    "</sf_guardrail>",
    "",
  );

  return lines.join("\n");
}

function formatOrgAwareRule(rule: OrgAwareRule): string {
  const orgTypes = rule.whenOrgType.join("|").toUpperCase();
  const behavior = labelForRuleBehavior(resolveRuleBehavior(rule));
  return `${formatShellAst(rule.match.ast)} when target org is ${orgTypes}${rule.description ? ` (${rule.description})` : ""}: ${behavior}`;
}

function formatShellAst(ast: ShellAstMatch): string {
  const parts = [
    ast.cmd,
    ...(ast.subCmd ?? []).map((part) => (Array.isArray(part) ? part.join("|") : part)),
  ];
  const flags = ast.flagIn
    ? Object.entries(ast.flagIn).map(([flag, values]) => `${flag} ${values.join("|")}`)
    : [];
  return [...parts, ...flags].join(" ");
}

function formatList(items: string[]): string {
  return items.map((item) => `\`${item}\``).join(", ");
}
