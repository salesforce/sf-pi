/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Native tool risk gate.
 *
 * Converts Native Tool Safety Subjects into ordinary Guardrail Decisions so
 * native SF Pi mutations share the same approval, headless, and audit path as
 * file and shell risks.
 */
import {
  resolveOrgContextForTarget,
  resolveOrgContextForTargetWithLookup,
  type OrgContext,
} from "./org-context.ts";
import { resolveRuleBehavior } from "./rule-behavior.ts";
import type { ClassifiedDecision, GuardrailConfig, NativeToolSafetySubject } from "./types.ts";

export function evaluateNativeToolRisk(
  subject: NativeToolSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): ClassifiedDecision {
  const org = subject.usesSalesforceOrg
    ? subject.targetOrgUnverified
      ? unverifiedExternalOrg()
      : subject.targetOrgType
        ? knownSurfaceOrg(subject.targetOrgType, subject.targetOrgResolutionSource ?? "mcpConfig")
        : resolveOrgContextForTarget(subject.targetOrg, cwd, config.productionAliases)
    : undefined;
  return buildNativeToolDecision(subject, org, config);
}

export async function evaluateNativeToolRiskWithOrgLookup(
  subject: NativeToolSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): Promise<ClassifiedDecision> {
  const fast = evaluateNativeToolRisk(subject, cwd, config);
  if (!subject.usesSalesforceOrg || subject.targetOrgType || subject.targetOrgUnverified) {
    return fast;
  }

  const refinedOrg = await resolveOrgContextForTargetWithLookup(
    subject.targetOrg,
    cwd,
    config.productionAliases,
  );
  return buildNativeToolDecision(subject, refinedOrg, config);
}

function buildNativeToolDecision(
  subject: NativeToolSafetySubject,
  org: OrgContext | undefined,
  config: GuardrailConfig,
): ClassifiedDecision {
  const scope = nativeToolSafetyEnvelope(subject, org);
  const unknownTarget = org?.guessed === true || org?.type === "unknown";
  const productionTarget = org?.type === "production";
  // Reuse org-operation preferences; Off leaves the base native confirmation intact.
  const rule = config.orgAwareGate.rules.find(
    (candidate) =>
      candidate.match.tool !== "bash" &&
      candidate.match.tool === subject.toolName &&
      candidate.match.actions.includes(subject.action ?? "") &&
      candidate.whenOrgType.includes(unknownTarget ? "unknown" : (org?.type ?? "unknown")) &&
      resolveRuleBehavior(candidate) !== "off",
  );
  const hardBlock =
    (subject.blockProductionOrUnknown === true && (productionTarget || unknownTarget)) ||
    (rule !== undefined && resolveRuleBehavior(rule) === "block");
  const reason = hardBlock
    ? `${subject.reason}\n\nThis native lifecycle mutation refuses production or unknown target orgs.`
    : org?.guessed && subject.usesSalesforceOrg
      ? `${subject.reason}\n\nNote: sf-guardrail could not verify the target org type and is treating it as production.`
      : subject.reason;
  return {
    ruleId: rule?.id ?? subject.ruleId,
    feature: "nativeToolGate",
    action: hardBlock ? "block" : "confirm",
    reason,
    promptTitle: subject.promptTitle,
    fingerprint: scope.fingerprint,
    subject: subject.subject,
    approvalScope: scope,
    orgAlias: org?.alias,
    orgType: org?.type,
    orgId: org?.orgId,
    orgUsername: org?.username,
    orgResolutionGuessed: org?.guessed,
    orgResolutionSource: org?.source,
    orgTargetExplicit: org?.explicit,
  };
}

function knownSurfaceOrg(
  type: Exclude<ClassifiedDecision["orgType"], "unknown" | undefined>,
  source: "mcpConfig" | "url",
): OrgContext {
  return {
    alias: undefined,
    type,
    guessed: false,
    explicit: false,
    source,
  };
}

function unverifiedExternalOrg(): OrgContext {
  return {
    alias: undefined,
    type: "production",
    guessed: true,
    explicit: false,
    source: "guessed",
  };
}

function nativeToolSafetyEnvelope(subject: NativeToolSafetySubject, org: OrgContext | undefined) {
  const orgPart = org
    ? `org=${org.orgId ?? org.username ?? org.alias ?? "<unknown>"}|type=${org.type}|`
    : "";
  return {
    fingerprint: `${orgPart}family=${subject.operationFamily}|native=${subject.fingerprint}`,
    label: subject.approvalLabel,
    detail: subject.approvalDetail,
    riskTier: subject.riskTier,
    operationFamily: subject.operationFamily,
    allowSession: subject.allowSession !== false && org?.type !== "production" && !org?.guessed,
  };
}
