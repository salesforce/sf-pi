/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command risk gate.
 *
 * Owns strict temp-cleanup auto-allow and dangerous-command matching for shell
 * Safety Subjects. Custom allowedPatterns intentionally short-circuit later
 * command/org-aware gates to preserve existing commandGate semantics.
 */
import { fingerprintCommand, fingerprintPath } from "./fingerprint.ts";
import { evaluateCommand } from "./command-gate.ts";
import { resolveOrgContext, resolveOrgContextWithLookup } from "./org-context.ts";
import { safetyEnvelopeForCommand } from "./safety-envelope.ts";
import { detectSafeTempCleanup } from "./temp-cleanup.ts";
import type { ClassifiedDecision, GuardrailConfig, ShellCommandSafetySubject } from "./types.ts";

export type CommandRiskResult =
  | { kind: "decision"; decision: ClassifiedDecision }
  | { kind: "allowListed" };

export function evaluateCommandRisk(
  subject: ShellCommandSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): CommandRiskResult | undefined {
  if (!config.enabled || !config.features.commandGate) return undefined;

  const safeCleanup = detectSafeTempCleanup(subject.command);
  if (safeCleanup) {
    return {
      kind: "decision",
      decision: {
        ruleId: "safe-temp-cleanup",
        feature: "commandGate",
        action: "allow",
        reason: `Strict OS temp cleanup auto-allowed: ${safeCleanup.path}`,
        promptTitle: "Strict OS temp cleanup",
        fingerprint: fingerprintPath(safeCleanup.realPath),
        subject: subject.command,
      },
    };
  }

  const outcome = evaluateCommand(subject.command, config.commandGate);
  if (!outcome) return undefined;
  if (outcome.action === "allow") return { kind: "allowListed" };

  if (outcome.action === "autodeny") {
    return {
      kind: "decision",
      decision: {
        ruleId: outcome.matched.id,
        feature: "commandGate",
        action: "block",
        reason: `Blocked: ${outcome.matched.description ?? outcome.matched.pattern}`,
        fingerprint: fingerprintCommand(subject.command),
        subject: subject.command,
      },
    };
  }

  const org =
    outcome.matched.id === "sf-org-delete"
      ? resolveOrgContext(subject.command, cwd, config.productionAliases)
      : undefined;
  const scope = safetyEnvelopeForCommand(outcome.matched.id, subject.command, org);
  return {
    kind: "decision",
    decision: {
      ruleId: outcome.matched.id,
      feature: "commandGate",
      action: "confirm",
      reason: `Dangerous command: ${outcome.matched.description ?? outcome.matched.pattern}`,
      promptTitle: `⚠ ${outcome.matched.description ?? outcome.matched.pattern}`,
      fingerprint: scope.fingerprint,
      subject: subject.command,
      approvalScope: scope,
      orgAlias: org?.alias,
      orgType: org?.type,
      orgId: org?.orgId,
      orgUsername: org?.username,
      orgResolutionGuessed: org?.guessed,
      orgResolutionSource: org?.source,
      orgTargetExplicit: org?.explicit,
      orgCommand: org ? subject.command : undefined,
    },
  };
}

export async function evaluateCommandRiskWithOrgLookup(
  subject: ShellCommandSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): Promise<CommandRiskResult | undefined> {
  const fast = evaluateCommandRisk(subject, cwd, config);
  if (fast?.kind !== "decision") return fast;

  const decision = fast.decision;
  if (
    decision.ruleId !== "sf-org-delete" ||
    !decision.orgResolutionGuessed ||
    !decision.orgTargetExplicit ||
    !decision.orgCommand
  ) {
    return fast;
  }

  const refinedOrg = await resolveOrgContextWithLookup(
    decision.orgCommand,
    cwd,
    config.productionAliases,
  );
  const scope = safetyEnvelopeForCommand(decision.ruleId, decision.orgCommand, refinedOrg);
  return {
    kind: "decision",
    decision: {
      ...decision,
      fingerprint: scope.fingerprint,
      approvalScope: scope,
      orgAlias: refinedOrg.alias,
      orgType: refinedOrg.type,
      orgId: refinedOrg.orgId,
      orgUsername: refinedOrg.username,
      orgResolutionGuessed: refinedOrg.guessed,
      orgResolutionSource: refinedOrg.source,
      orgTargetExplicit: refinedOrg.explicit,
    },
  };
}
