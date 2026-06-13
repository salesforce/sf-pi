/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Envelope builders.
 *
 * A Safety Envelope answers what a session-scoped approval covers. This module
 * is the domain-facing seam for the envelope-first redesign while the persisted
 * decision field is still named `approvalScope` for compatibility.
 */
import { approvalScopeForCommand, approvalScopeForOrgAware } from "./approval-scope.ts";
import type { OrgContext } from "./org-context.ts";
import type { SafetyEnvelope } from "./types.ts";

export function safetyEnvelopeForCommand(
  ruleId: string,
  command: string,
  org?: OrgContext,
): SafetyEnvelope {
  return approvalScopeForCommand(ruleId, command, org);
}

export function safetyEnvelopeForOrgAware(
  ruleId: string,
  command: string,
  org: OrgContext,
): SafetyEnvelope {
  return approvalScopeForOrgAware(ruleId, command, org);
}
