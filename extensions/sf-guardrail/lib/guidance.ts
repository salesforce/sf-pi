/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rule-derived agent guidance for sf-guardrail.
 *
 * This renderer turns the effective config into the hidden `<sf_guardrail>`
 * message injected before the agent starts. It is intentionally deterministic
 * and compact so rule changes update agent guidance without maintaining a
 * second policy prompt by hand.
 */
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
  if (!config.features.policies) {
    lines.push("- Disabled in the effective config.");
  } else {
    const active = config.policies.rules.filter((rule) => rule.enabled !== false);
    if (active.length === 0) {
      lines.push("- No active file-protection rules.");
    } else {
      for (const rule of active) {
        const access = rule.protection === "readOnly" ? "read-only" : rule.protection;
        lines.push(
          `- ${rule.description ?? rule.id}: ${access}; patterns ${formatList(rule.patterns.map((p) => p.pattern))}`,
        );
        if (rule.allowedPatterns?.length) {
          lines.push(
            `  allowed carve-outs: ${formatList(rule.allowedPatterns.map((p) => p.pattern))}`,
          );
        }
      }
    }
  }

  lines.push("", "Dangerous-command confirmation:");
  if (!config.features.commandGate) {
    lines.push("- Disabled in the effective config.");
  } else {
    const active = config.commandGate.patterns.filter((pattern) => pattern.enabled !== false);
    if (active.length === 0) {
      lines.push("- No active dangerous-command patterns.");
    } else {
      for (const pattern of active) {
        lines.push(`- ${pattern.pattern}${pattern.description ? ` (${pattern.description})` : ""}`);
      }
    }
  }

  lines.push("", "Org-aware confirmation:");
  if (!config.features.orgAwareGate) {
    lines.push("- Disabled in the effective config.");
  } else {
    const active = config.orgAwareGate.rules.filter((rule) => rule.enabled !== false);
    if (active.length === 0) {
      lines.push("- No active org-aware rules.");
    } else {
      for (const rule of active) {
        lines.push(`- ${formatOrgAwareRule(rule)}`);
      }
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
    "",
    "Override: `/sf-guardrail` shows active rules, recent decisions, and active approval grants.",
    "Users may choose a scoped allow at the confirmation dialog; session allows persist via pi's session entries, and selected low-risk grants may persist for a short project-scoped TTL.",
    "</sf_guardrail>",
    "",
  );

  return lines.join("\n");
}

function formatOrgAwareRule(rule: OrgAwareRule): string {
  const orgTypes = rule.whenOrgType.join("|").toUpperCase();
  return `${formatShellAst(rule.match.ast)} when target org is ${orgTypes}${rule.description ? ` (${rule.description})` : ""}`;
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
