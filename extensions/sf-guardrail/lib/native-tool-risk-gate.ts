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
import type { ClassifiedDecision, GuardrailConfig, NativeToolSafetySubject } from "./types.ts";

export function evaluateNativeToolRisk(
  subject: NativeToolSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): ClassifiedDecision {
  const org = subject.usesSalesforceOrg
    ? resolveOrgContextForTarget(subject.targetOrg, cwd, config.productionAliases)
    : undefined;
  return buildNativeToolDecision(subject, org);
}

export async function evaluateNativeToolRiskWithOrgLookup(
  subject: NativeToolSafetySubject,
  cwd: string,
  config: GuardrailConfig,
): Promise<ClassifiedDecision> {
  const fast = evaluateNativeToolRisk(subject, cwd, config);
  if (!subject.usesSalesforceOrg || !fast.orgResolutionGuessed || !fast.orgTargetExplicit) {
    return fast;
  }

  const refinedOrg = await resolveOrgContextForTargetWithLookup(
    subject.targetOrg,
    cwd,
    config.productionAliases,
  );
  return buildNativeToolDecision(subject, refinedOrg);
}

function buildNativeToolDecision(
  subject: NativeToolSafetySubject,
  org: OrgContext | undefined,
): ClassifiedDecision {
  const scope = nativeToolSafetyEnvelope(subject, org);
  const reason =
    org?.guessed && subject.usesSalesforceOrg
      ? `${subject.reason}\n\nNote: sf-guardrail could not verify the target org type and is treating it as production.`
      : subject.reason;
  return {
    ruleId: subject.ruleId,
    feature: "nativeToolGate",
    action: "confirm",
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
  };
}
