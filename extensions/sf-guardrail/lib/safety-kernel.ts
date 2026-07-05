/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Kernel bridge for sf-guardrail.
 *
 * This is the new caller-facing seam for risky-action evaluation. In this
 * first slice it delegates to the existing classifier unchanged so runtime
 * behavior stays stable while tests and future refactors move to the kernel
 * vocabulary from extensions/sf-guardrail/CONTEXT.md.
 *
 * Keep this module pure: no Pi Runtime UI, session, notification, or
 * persistence side effects belong here.
 */
import { evaluateCommandRiskWithOrgLookup } from "./command-risk-gate.ts";
import { evaluateFilePolicy } from "./file-policy-gate.ts";
import { evaluateOrgAwareRiskWithOrgLookup } from "./org-aware-risk-gate.ts";
import { evaluateNativeToolRiskWithOrgLookup } from "./native-tool-risk-gate.ts";
import { normalizeSafetySubject } from "./safety-subject.ts";
import type { ClassifiedDecision, GuardrailConfig } from "./types.ts";

export interface SafetyKernelInput {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  config: GuardrailConfig;
}
export type GuardrailDecision = ClassifiedDecision;

export async function evaluateSafety(
  input: SafetyKernelInput,
): Promise<GuardrailDecision | undefined> {
  const subject = normalizeSafetySubject(input.toolName, input.input);
  if (!subject) return undefined;

  if (subject.kind === "file") {
    return evaluateFilePolicy(subject, input.cwd, input.config);
  }

  if (subject.kind === "nativeTool") {
    return evaluateNativeToolRiskWithOrgLookup(subject, input.cwd, input.config);
  }

  const commandRisk = await evaluateCommandRiskWithOrgLookup(subject, input.cwd, input.config);
  if (commandRisk?.kind === "allowListed") return undefined;
  if (commandRisk?.kind === "decision") return commandRisk.decision;

  return evaluateOrgAwareRiskWithOrgLookup(subject, input.cwd, input.config);
}
