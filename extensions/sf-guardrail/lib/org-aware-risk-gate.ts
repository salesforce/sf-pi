/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org-aware risk gate.
 *
 * Evaluates shell Safety Subjects against org-aware rules after the command
 * risk gate has had a chance to block, allow, or short-circuit.
 */
import { matches, tokenize, splitSimpleCommands } from "./bash-ast.ts";
import { evaluateOrgAware } from "./org-aware-gate.ts";
import { resolveOrgContext, resolveOrgContextWithLookup, type OrgContext } from "./org-context.ts";
import { behaviorToAction, resolveRuleBehavior } from "./rule-behavior.ts";
import { safetyEnvelopeForOrgAware } from "./safety-envelope.ts";
import type { ClassifiedDecision, GuardrailConfig, ShellCommandSafetySubject } from "./types.ts";

export function evaluateOrgAwareRisk(
  subject: ShellCommandSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): ClassifiedDecision | undefined {
  for (const orgCommand of splitSimpleCommands(subject.command)) {
    const org = resolveOrgContext(orgCommand, cwd, config.productionAliases);
    const decision = buildOrgAwareDecision(config, subject.command, orgCommand, org);
    if (decision) return decision;
  }

  return undefined;
}

export async function evaluateOrgAwareRiskWithOrgLookup(
  subject: ShellCommandSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): Promise<ClassifiedDecision | undefined> {
  for (const orgCommand of splitSimpleCommands(subject.command)) {
    const tokens = tokenize(orgCommand);
    if (
      !tokens ||
      !config.orgAwareGate.rules.some(
        (rule) =>
          rule.match.tool === "bash" &&
          rule.enabled !== false &&
          resolveRuleBehavior(rule) !== "off" &&
          matches(tokens, rule.match.ast),
      )
    )
      continue;
    // Check matching risky commands even when the cached default is non-production.
    const org = await resolveOrgContextWithLookup(orgCommand, cwd, config.productionAliases);
    const decision = buildOrgAwareDecision(config, subject.command, orgCommand, org);
    if (decision) return decision;
  }
  return undefined;
}

function buildOrgAwareDecision(
  config: GuardrailConfig,
  fullCommand: string,
  orgCommand: string,
  org: OrgContext,
): ClassifiedDecision | undefined {
  const outcome = evaluateOrgAware(orgCommand, config.orgAwareGate.rules, org);
  if (!outcome) return undefined;

  const behavior = resolveRuleBehavior(outcome.rule);
  const action = behaviorToAction(behavior);
  if (!action) return undefined;

  const message = renderBlockMessage(outcome.rule.confirmMessage, {
    command: fullCommand,
    orgAlias: org.alias ?? "<unknown>",
    orgType: org.type,
  });
  const scope = safetyEnvelopeForOrgAware(outcome.rule.id, orgCommand, org);
  return {
    ruleId: outcome.rule.id,
    feature: "orgAwareGate",
    action,
    reason: org.guessed
      ? `${message}\n\nNote: sf-guardrail could not verify the target org type and is treating it as production.`
      : message,
    promptTitle: orgAwareTitle(outcome.rule.description, org),
    fingerprint: scope.fingerprint,
    subject: fullCommand,
    approvalScope: scope,
    orgAlias: org.alias,
    orgType: org.type,
    orgId: org.orgId,
    orgUsername: org.username,
    orgResolutionGuessed: org.guessed,
    orgResolutionSource: org.source,
    orgTargetExplicit: org.explicit,
    orgCommand,
  };
}

function orgAwareTitle(description: string | undefined, org: OrgContext): string {
  const tag = org.type.toUpperCase();
  const who = org.alias ? ` (${org.alias})` : "";
  const guessed = org.guessed ? " guessed" : "";
  const d = description ?? "Org-aware gate";
  return `⚠ ${tag}${guessed}${who}: ${d}`;
}

function renderBlockMessage(template: string | undefined, vars: Record<string, string>): string {
  const fallback = `Blocked by sf-guardrail.`;
  const source = template ?? fallback;
  return source.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
