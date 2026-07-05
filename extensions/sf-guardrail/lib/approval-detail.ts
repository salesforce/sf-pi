/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-facing approval detail formatter.
 *
 * The HIL dialog should show the Safety Envelope a user is approving, not only
 * a raw command or file path. This module stays pure so copy can be tested
 * without a Pi UI.
 */
import type { ClassifiedDecision } from "./types.ts";

export function renderApprovalDetail(decision: ClassifiedDecision): string {
  const lines: string[] = [decision.reason, "", "Risk gate:", `- ${riskGateLabel(decision)}`];

  lines.push("", "Subject:", `- ${decision.subject}`);

  const orgLines = renderOrgLines(decision);
  if (orgLines.length > 0) {
    lines.push("", "Target org:", ...orgLines);
  }

  const envelopeLines = renderEnvelopeLines(decision);
  if (envelopeLines.length > 0) {
    lines.push("", "Approval covers:", ...envelopeLines);
  }

  const guidance = advisoryGuidance(decision);
  if (guidance.length > 0) {
    lines.push("", "Safer workflow:", ...guidance.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

function riskGateLabel(decision: ClassifiedDecision): string {
  switch (decision.feature) {
    case "policies":
      return `File policy (${decision.ruleId})`;
    case "commandGate":
      return `Dangerous command (${decision.ruleId})`;
    case "orgAwareGate":
      return `Org-aware operation (${decision.ruleId})`;
    case "nativeToolGate":
      return `Native tool operation (${decision.ruleId})`;
  }
}

function renderOrgLines(decision: ClassifiedDecision): string[] {
  if (!decision.orgAlias && !decision.orgType && !decision.orgId && !decision.orgUsername) {
    return [];
  }

  const lines: string[] = [];
  if (decision.orgAlias) lines.push(`- Alias: ${decision.orgAlias}`);
  if (decision.orgType) {
    const guessed = decision.orgResolutionGuessed ? " (guessed fail-closed)" : "";
    const source = decision.orgResolutionSource ? ` via ${decision.orgResolutionSource}` : "";
    lines.push(`- Type: ${decision.orgType}${guessed}${source}`);
  }
  if (decision.orgId) lines.push(`- Org ID: ${decision.orgId}`);
  if (decision.orgUsername) lines.push(`- Username: ${decision.orgUsername}`);
  return lines;
}

function renderEnvelopeLines(decision: ClassifiedDecision): string[] {
  const envelope = decision.approvalScope;
  if (!envelope) {
    return [`- Exact subject fingerprint: ${decision.fingerprint}`];
  }

  const lines = [`- ${envelope.label}`, `- Fingerprint: ${envelope.fingerprint}`];
  if (envelope.detail) lines.push(`- Detail: ${envelope.detail}`);
  if (envelope.operationFamily) lines.push(`- Operation family: ${envelope.operationFamily}`);
  if (envelope.riskTier) lines.push(`- Risk tier: ${envelope.riskTier}`);
  lines.push("- Approval duration: current session");
  return lines;
}

function advisoryGuidance(decision: ClassifiedDecision): string[] {
  switch (decision.ruleId) {
    case "sf-deploy-prod":
      return ["Prefer `sf project deploy validate` or `--check-only` before production deploys."];
    case "sf-apex-run-prod":
      return [
        "For production Apex DML rehearsals, wrap work in `Savepoint sp = Database.setSavepoint(); ... Database.rollback(sp);`.",
      ];
    case "sf-data-mutate-prod":
      return [
        "Prefer a read-only query/export or sandbox rehearsal before production data mutations.",
      ];
    case "sf-org-api-destructive-prod":
      return [
        "Prefer GET/preview endpoints first; verify the exact REST path and method before approving.",
      ];
    case "sf-org-delete":
      return ["Verify the target alias and org type before deleting an org."];
    default:
      return [];
  }
}
